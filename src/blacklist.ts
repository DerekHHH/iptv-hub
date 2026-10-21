/**
 * @file 失效源黑名单（P1-3）。
 *
 * 规则：
 *   - 连续失败 2 次 → `fail_count >= 2`，进入「延后复测」队列（本轮不测，节省预算）
 *   - 复测成功 → 直接删条目（自动恢复）
 *   - 条目过期（超过 ttlDays 未检查）→ 清理，避免文件无限膨胀
 *   - 文件缺失/损坏 → 返回空黑名单，绝不抛错
 */

import { BLACKLIST, PATHS } from './config';
import type { BlacklistEntry, BlacklistFile, ProbeResult } from './types';
import { readJsonOr, writeJsonFile } from './util/fsx';

/** 分批结果：立刻测 vs 延后（黑名单命中）复测。 */
export interface PartitionResult {
  /** 本轮立即探测的 urlKey */
  probeFirst: string[];
  /** 黑名单命中，仅在有剩余预算时复测 */
  retryLater: string[];
}

/** 空黑名单文件。 */
function emptyFile(): BlacklistFile {
  return { version: 1, entries: {} };
}

/** 校验读到的 JSON 是否是合法黑名单结构。 */
function isValidFile(value: unknown): value is BlacklistFile {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<BlacklistFile>;
  if (candidate.version !== 1) {
    return false;
  }
  if (candidate.entries === null || typeof candidate.entries !== 'object') {
    return false;
  }
  for (const entry of Object.values(candidate.entries)) {
    if (entry === null || typeof entry !== 'object') {
      return false;
    }
    const item = entry as Partial<BlacklistEntry>;
    if (typeof item.fail_count !== 'number' || typeof item.last_checked !== 'string') {
      return false;
    }
  }
  return true;
}

/**
 * 黑名单存储（内存态 + 显式保存）。
 */
export class Blacklist {
  private entries: Record<string, BlacklistEntry>;

  /**
   * @param entries 初始条目
   */
  constructor(entries: Record<string, BlacklistEntry> = {}) {
    this.entries = entries;
  }

  /**
   * 从磁盘加载；文件缺失或损坏时返回空实例。
   *
   * @param filePath 黑名单路径，默认走 config
   * @return Blacklist 实例
   */
  static async load(filePath: string = PATHS.blacklist): Promise<Blacklist> {
    const raw = await readJsonOr<unknown>(filePath, null);
    if (!isValidFile(raw)) {
      return new Blacklist();
    }
    return new Blacklist({ ...raw.entries });
  }

  /** 当前条目数。 */
  size(): number {
    return Object.keys(this.entries).length;
  }

  /**
   * 分批：命中黑名单的延后复测，其余立即探测。
   *
   * @param urlKeys 待探测的全部 urlKey（保持输入顺序）
   * @return 分批结果
   */
  partition(urlKeys: readonly string[]): PartitionResult {
    const probeFirst: string[] = [];
    const retryLater: string[] = [];
    for (const urlKey of urlKeys) {
      const entry = this.entries[urlKey];
      if (entry !== undefined && entry.fail_count >= BLACKLIST.maxFailBeforeDelay) {
        retryLater.push(urlKey);
      } else {
        probeFirst.push(urlKey);
      }
    }
    return { probeFirst, retryLater };
  }

  /**
   * 用本轮探测结果更新黑名单。
   *
   * @param results 探测结果
   * @param nowIso 当前时间（ISO +08:00，由调用方注入保证可测）
   */
  update(results: readonly ProbeResult[], nowIso: string): void {
    for (const result of results) {
      if (result.status === 'alive') {
        delete this.entries[result.urlKey];
        continue;
      }
      if (result.status === 'dead' || result.status === 'timeout') {
        const previous = this.entries[result.urlKey];
        this.entries[result.urlKey] = {
          fail_count: (previous?.fail_count ?? 0) + 1,
          last_checked: nowIso,
        };
      }
      // skipped / unknown：预算不足未测，不计失败，避免误伤
    }
  }

  /**
   * 清理过期条目。
   *
   * @param nowMs 当前毫秒时间戳
   */
  prune(nowMs: number): void {
    const ttlMs = BLACKLIST.ttlDays * 24 * 60 * 60 * 1000;
    for (const [urlKey, entry] of Object.entries(this.entries)) {
      const checkedMs = Date.parse(entry.last_checked);
      if (!Number.isFinite(checkedMs) || nowMs - checkedMs > ttlMs) {
        delete this.entries[urlKey];
      }
    }
  }

  /** 导出为可落盘的结构。 */
  toFile(): BlacklistFile {
    const file = emptyFile();
    const sortedKeys = Object.keys(this.entries).sort();
    for (const key of sortedKeys) {
      const entry = this.entries[key];
      if (entry !== undefined) {
        file.entries[key] = { fail_count: entry.fail_count, last_checked: entry.last_checked };
      }
    }
    return file;
  }

  /**
   * 保存到磁盘（键按字典序，保证 diff 稳定）。
   *
   * @param filePath 目标路径，默认走 config
   */
  async save(filePath: string = PATHS.blacklist): Promise<void> {
    await writeJsonFile(filePath, this.toFile());
  }
}
