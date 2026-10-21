/**
 * @file 构建看板数据（P0-14）：`dist/stats.json` + `data/history.json`。
 *
 * 约定 §5：`stats.json` 严格按 `BuildStats`，`version: 1`，网页只读不写。
 */

import { GROUP_ORDER, HISTORY_KEEP, PATHS } from '../config';
import type { BuildStats, GroupKey, HistoryFile } from '../types';
import { readJsonOr, writeJsonFile } from '../util/fsx';

/**
 * 生成一份空的统计骨架（字段齐全，避免网页读到 undefined）。
 *
 * @param updatedAt ISO +08:00 的更新时间
 * @return BuildStats
 */
export function createEmptyStats(updatedAt: string): BuildStats {
  const groups = {} as Record<GroupKey, number>;
  for (const group of GROUP_ORDER) {
    groups[group] = 0;
  }
  return {
    version: 1,
    updated_at: updatedAt,
    channel_count: 0,
    source_count: 0,
    groups,
    upstream: [],
    fetch_fail_rate: 0,
    probe: { total: 0, alive: 0, dead: 0, timeout: 0, skipped: 0, duration_ms: 0 },
    epg: { ok: false, programmes: 0 },
    build_duration_ms: 0,
    stale: false,
  };
}

/**
 * 读取上一次构建的统计（缺失或损坏返回 null）。
 *
 * @param filePath 路径，默认 `dist/stats.json`
 * @return 上次 stats 或 null
 */
export async function readPrevStats(filePath: string = PATHS.stats): Promise<BuildStats | null> {
  const raw = await readJsonOr<unknown>(filePath, null);
  if (raw === null || typeof raw !== 'object') {
    return null;
  }
  const candidate = raw as Partial<BuildStats>;
  if (candidate.version !== 1 || typeof candidate.channel_count !== 'number') {
    return null;
  }
  return candidate as BuildStats;
}

/**
 * 写 `dist/stats.json`。
 *
 * @param stats 统计数据
 * @param filePath 目标路径
 */
export async function emitStats(stats: BuildStats, filePath: string = PATHS.stats): Promise<void> {
  await writeJsonFile(filePath, stats);
}

/**
 * 追加一条历史记录并落盘（只保留最近 `HISTORY_KEEP` 条）。
 *
 * 降级构建同样要留痕（`stale: true` + 原因），否则首页「最近几次构建」永远看不到降级。
 *
 * @param stats 本次构建统计
 * @param filePath 目标路径，默认 `data/history.json`
 * @return 写入后的历史文件内容
 */
export async function emitHistory(stats: BuildStats, filePath: string = PATHS.history): Promise<HistoryFile> {
  const existing = await readJsonOr<HistoryFile>(filePath, { version: 1, items: [] });
  const items = Array.isArray(existing.items) ? existing.items : [];
  const entry: HistoryFile['items'][number] = {
    updated_at: stats.updated_at,
    channel_count: stats.channel_count,
    source_count: stats.source_count,
    stale: stats.stale,
  };
  if (stats.stale && stats.stale_reason !== undefined) {
    entry.stale_reason = stats.stale_reason;
  }
  const next: HistoryFile = {
    version: 1,
    items: [...items, entry].slice(-HISTORY_KEEP),
  };
  await writeJsonFile(filePath, next);
  return next;
}
