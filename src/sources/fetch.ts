/**
 * @file L1 抓取层：多上游并发抓取，raw → jsDelivr 双通道兜底。
 *
 * 容错原则（约定 §7 / 设计 §1.3）：
 *   - 单个上游异常绝不外抛，只记 `ok:false` + error
 *   - raw 失败自动切 jsDelivr
 *   - `MOCK_MODE=1` 时读 `tests/fixtures/`，完全不触网
 */

import { FETCH, PATHS, UPSTREAMS, isMockMode, type UpstreamSource } from '../config';
import { readTextFileOrNull } from '../util/fsx';
import { fetchText } from '../util/http';
import { log } from '../util/logger';
import type { RawDoc } from '../types';
import { parseAuto } from '../parse/parseTxt';

/** `fetchAllDocs` 的可选项（全部可注入，便于离线测试）。 */
export interface FetchAllOptions {
  /** 注入的 fetch */
  fetchImpl?: typeof fetch;
  /** 覆盖上游列表（测试用） */
  upstreams?: readonly UpstreamSource[];
  /** 覆盖 fixture 目录 */
  fixturesDir?: string;
  /** 是否强制 mock 模式（缺省读环境变量） */
  mockMode?: boolean;
  /** 覆盖 custom/sources.txt 路径 */
  customPath?: string;
  /** 直接给自定义源文本（测试用，给值时不再读文件） */
  customText?: string;
}

/**
 * 读取用户自填源文件（不存在返回空串）。
 *
 * @param filePath 路径，默认 `custom/sources.txt`
 * @return 文本（已去 BOM）
 */
export async function loadCustomSources(filePath: string = PATHS.custom): Promise<string> {
  const text = await readTextFileOrNull(filePath);
  if (text === null) {
    return '';
  }
  return text.replace(/^\uFEFF/, '');
}

/**
 * 统计一个文档能解析出的条目数（顺带验证解析器不抛错）。
 *
 * @param text 文档内容
 * @param origin 来源名
 * @return 条目数
 */
function countItems(text: string, origin: string): number {
  try {
    return parseAuto(text, origin).length;
  } catch {
    return 0;
  }
}

/**
 * 读取 mock fixture。
 *
 * @param fixturesDir fixture 目录
 * @param fileName 文件名
 * @return 文本或 null
 */
async function readMockFixture(fixturesDir: string, fileName: string): Promise<string | null> {
  return readTextFileOrNull(`${fixturesDir}/${fileName}`);
}

/**
 * 抓取单个上游：先 raw 后 jsDelivr。
 *
 * @param upstream 上游定义
 * @param options 注入选项
 * @return RawDoc（永不抛错）
 */
async function fetchOne(upstream: UpstreamSource, options: FetchAllOptions): Promise<RawDoc> {
  const mockMode = options.mockMode ?? isMockMode();
  const fixturesDir = options.fixturesDir ?? PATHS.fixturesDir;

  if (mockMode) {
    const text = await readMockFixture(fixturesDir, upstream.fixture);
    if (text === null) {
      log.warn('fetch', `mock fixture 缺失：${upstream.fixture}`, { upstream: upstream.name });
      return {
        origin: upstream.name,
        format: upstream.format,
        text: '',
        ok: false,
        items: 0,
        channel: 'raw',
        error: `fixture 缺失：${upstream.fixture}`,
      };
    }
    const doc: RawDoc = {
      origin: upstream.name,
      format: upstream.format,
      text,
      ok: true,
      items: countItems(text, upstream.name),
      channel: 'raw',
    };
    log.info('fetch', `mock 命中 ${upstream.name}，${doc.items} 条`);
    return doc;
  }

  const attempts: Array<{ url: string; channel: 'raw' | 'jsdelivr' }> = [
    { url: upstream.rawUrl, channel: 'raw' },
    { url: upstream.jsdelivrUrl, channel: 'jsdelivr' },
  ];

  const errors: string[] = [];
  for (const attempt of attempts) {
    try {
      const response = await fetchText(attempt.url, {
        timeoutMs: FETCH.timeoutMs,
        retries: FETCH.retries,
        fetchImpl: options.fetchImpl,
        userAgent: FETCH.userAgent,
      });
      if (!response.ok) {
        errors.push(`${attempt.channel} HTTP ${response.status}`);
        continue;
      }
      if (response.text.trim().length === 0) {
        errors.push(`${attempt.channel} 空响应`);
        continue;
      }
      const items = countItems(response.text, upstream.name);
      if (items === 0) {
        errors.push(`${attempt.channel} 解析出 0 条`);
        continue;
      }
      log.info('fetch', `${upstream.name} 通过 ${attempt.channel} 抓到 ${items} 条`);
      return {
        origin: upstream.name,
        format: upstream.format,
        text: response.text,
        ok: true,
        items,
        channel: attempt.channel,
      };
    } catch (error) {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      errors.push(`${attempt.channel} ${message}`);
    }
  }

  log.warn('fetch', `${upstream.name} 两个通道均失败`, { errors });
  return {
    origin: upstream.name,
    format: upstream.format,
    text: '',
    ok: false,
    items: 0,
    channel: 'jsdelivr',
    error: errors.join(' / '),
  };
}

/**
 * 抓取全部上游 + 用户自填源。
 *
 * @param options 注入选项
 * @return RawDoc 列表（顺序 = 上游顺序，最后一条是 custom）
 */
export async function fetchAllDocs(options: FetchAllOptions = {}): Promise<RawDoc[]> {
  const upstreams = options.upstreams ?? UPSTREAMS;
  const docs = await Promise.all(upstreams.map((upstream) => fetchOne(upstream, options)));

  const customText = options.customText ?? (await loadCustomSources(options.customPath));
  const usableCustom = customText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

  if (usableCustom.length === 0) {
    return docs;
  }

  const text = usableCustom.join('\n');
  const items = countItems(text, 'custom');
  log.info('fetch', `用户自填源 ${items} 条`);
  docs.push({
    origin: 'custom',
    format: 'txt',
    text,
    ok: true,
    items,
    channel: 'custom',
  });
  return docs;
}

/**
 * 计算上游失败率（0~1）。没有上游时返回 1（视为失败，走降级）。
 *
 * @param docs 抓取结果
 * @return 失败率
 */
export function computeFetchFailRate(docs: readonly RawDoc[]): number {
  if (docs.length === 0) {
    return 1;
  }
  const failed = docs.filter((doc) => !doc.ok).length;
  return failed / docs.length;
}
