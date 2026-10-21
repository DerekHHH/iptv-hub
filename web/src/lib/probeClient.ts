/**
 * @file 浏览器端测活（三级阶梯，零服务器）。
 *
 * 现实约束：绝大多数 IPTV 源不返回 `Access-Control-Allow-Origin`，
 * 普通 `fetch` 读不到状态码与内容。因此分三级，并在 UI 上如实标注置信度：
 *
 *   L1  `fetch(url, {headers:{Range:'bytes=0-2047'}})`
 *       CORS 放行 → 能拿到 HTTP 状态 + content-type；正文是 `#EXTM3U` 时
 *       解析 `#EXT-X-STREAM-INF` 的 `RESOLUTION/BANDWIDTH` 取最高变体，
 *       再补拉首片 → 判定 `alive`（高置信度）
 *   L2  L1 抛 TypeError（被 CORS 拦）→ `fetch(url, {mode:'no-cors'})` + 时间戳去缓存，
 *       只要不抛异常就说明 TCP/TLS/HTTP 已到达 → 判定 `reachable`（低置信度，
 *       opaque 响应**无法区分 200 与 404/403**）
 *   L3  两级都失败 → 超时记 `timeout`，其余记 `dead`
 *
 * 明确不做：**不用 `<video>` 元素探测**。非 Safari 浏览器没有原生 HLS，
 * `loadedmetadata` 永远不触发，会把所有可用源误判成挂掉。
 */

/** 浏览器端结论。 */
export type BrowserVerdict = 'alive' | 'reachable' | 'dead' | 'timeout';

/** 待检测条目。 */
export interface ProbeEntry {
  /** 频道名（可空，纯地址时为空串） */
  rawName: string;
  /** 播放地址 */
  url: string;
}

/** 单条检测结果。 */
export interface BrowserProbeResult {
  url: string;
  rawName: string;
  verdict: BrowserVerdict;
  httpStatus: number | null;
  latencyMs: number | null;
  contentType: string | null;
  resolution: string | null;
  bandwidth: number | null;
  /** 给用户看的补充说明（含局限声明） */
  note: string;
  /** 命中哪一级 */
  tier: 'L1' | 'L2' | 'L3';
}

/** 检测选项。 */
export interface ProbeOptions {
  /** 单源超时（ms） */
  timeoutMs?: number;
  /** 可选的自定义前缀（极少数自建代理场景，默认空） */
  urlPrefix?: string;
  /** 上层取消信号 */
  signal?: AbortSignal;
}

/** 默认并发：浏览器对同一 host 只开 6 个连接，8 已经够快且不互相排队。 */
export const DEFAULT_CONCURRENCY = 8;
/** 并发上限。 */
export const MAX_CONCURRENCY = 16;
/** 默认超时。 */
export const DEFAULT_TIMEOUT_MS = 8000;

/** L1 探测的 Range 字节数。 */
const L1_RANGE_BYTES = 2048;
/** 首片探测 Range 字节数。 */
const SEGMENT_RANGE_BYTES = 1024;

/** master playlist 里解析出的变体。 */
interface VariantInfo {
  uri: string;
  bandwidth: number;
  resolution: string | null;
}

/**
 * 判断异常是否为"我们主动超时"。
 *
 * @param error 异常
 * @return true 表示超时
 */
function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

/**
 * 把相对地址解析成绝对地址。
 *
 * @param base 基准地址
 * @param uri 相对地址
 * @return 绝对地址或空串
 */
function resolveUrl(base: string, uri: string): string {
  try {
    return new URL(uri, base).toString();
  } catch {
    return '';
  }
}

/**
 * 解析 master playlist，返回按分辨率降序的变体列表。
 *
 * @param text m3u8 正文
 * @param base 基准地址
 * @return 变体列表
 */
export function parseVariants(text: string, base: string): VariantInfo[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n').map((line) => line.trim());
  const variants: VariantInfo[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (!line.startsWith('#EXT-X-STREAM-INF:')) {
      continue;
    }
    const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/i);
    const resolutionMatch = line.match(/RESOLUTION=(\d+x\d+)/i);
    let uri = '';
    for (let next = index + 1; next < lines.length; next += 1) {
      const candidate = lines[next] ?? '';
      if (candidate.length === 0 || candidate.startsWith('#')) {
        continue;
      }
      uri = resolveUrl(base, candidate);
      break;
    }
    if (uri.length === 0) {
      continue;
    }
    variants.push({
      uri,
      bandwidth: bandwidthMatch === null ? 0 : Number(bandwidthMatch[1]),
      resolution: resolutionMatch === null ? null : (resolutionMatch[1] ?? null),
    });
  }

  variants.sort((left, right) => right.bandwidth - left.bandwidth);
  return variants;
}

/** 一次带超时的 fetch 结果。 */
interface FetchOutcome {
  ok: boolean;
  status: number;
  contentType: string;
  text: string;
  timedOut: boolean;
  failed: boolean;
  error?: unknown;
}

/**
 * 带超时地发一次请求（浏览器侧）。
 *
 * @param url 地址
 * @param init 选项
 * @param timeoutMs 超时
 * @param parentSignal 上层信号
 * @return 结果
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  parentSignal?: AbortSignal,
): Promise<FetchOutcome> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const onParentAbort = (): void => controller.abort();
  if (parentSignal !== undefined) {
    if (parentSignal.aborted) {
      controller.abort();
    } else {
      parentSignal.addEventListener('abort', onParentAbort, { once: true });
    }
  }

  try {
    const response = await fetch(url, { ...init, signal: controller.signal, cache: 'no-store' });
    let text = '';
    try {
      text = await response.text();
    } catch {
      text = '';
    }
    return {
      ok: response.ok,
      status: response.status,
      contentType: response.headers.get('content-type') ?? '',
      text,
      timedOut: false,
      failed: false,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      contentType: '',
      text: '',
      timedOut: timedOut || isTimeoutError(error),
      failed: true,
      error,
    };
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', onParentAbort);
  }
}

/**
 * L2：`no-cors` 可达性探测 + Resource Timing 取延迟。
 *
 * @param url 地址
 * @param timeoutMs 超时
 * @param signal 上层信号
 * @return 结论
 */
async function tierNoCors(
  url: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<BrowserProbeResult> {
  const cacheBustUrl = `${url}${url.includes('?') ? '&' : '?'}__t=${Date.now()}`;
  const outcome = await fetchWithTimeout(cacheBustUrl, { mode: 'no-cors', redirect: 'follow' }, timeoutMs, signal);

  if (outcome.failed) {
    return {
      url,
      rawName: '',
      verdict: outcome.timedOut ? 'timeout' : 'dead',
      httpStatus: null,
      latencyMs: null,
      contentType: null,
      resolution: null,
      bandwidth: null,
      note: outcome.timedOut
        ? `超过 ${Math.round(timeoutMs / 1000)} 秒没有响应`
        : '连不上：域名解析失败或连接被拒绝',
      tier: 'L3',
    };
  }

  // 用 Resource Timing 估延迟（拿不到就留空）
  let latencyMs: number | null = null;
  try {
    const entries = performance.getEntriesByName(cacheBustUrl);
    const entry = entries[entries.length - 1] as PerformanceResourceTiming | undefined;
    if (entry !== undefined) {
      latencyMs = Math.round(entry.responseStart > 0 ? entry.responseStart : entry.duration);
      if (!Number.isFinite(latencyMs) || latencyMs <= 0) {
        latencyMs = null;
      }
    }
  } catch {
    latencyMs = null;
  }

  return {
    url,
    rawName: '',
    verdict: 'reachable',
    httpStatus: null,
    latencyMs,
    contentType: null,
    resolution: null,
    bandwidth: null,
    note: '服务器有响应，但浏览器不允许读取跨域内容（无法区分 200 与 404/403）',
    tier: 'L2',
  };
}

/**
 * L1：CORS 放行的精确探测。
 *
 * @param url 地址
 * @param timeoutMs 超时
 * @param signal 上层信号
 * @return 结论
 */
async function tierCors(url: string, timeoutMs: number, signal?: AbortSignal): Promise<BrowserProbeResult> {
  const startedAt = performance.now();
  const outcome = await fetchWithTimeout(
    url,
    { headers: { Range: `bytes=0-${L1_RANGE_BYTES - 1}` }, redirect: 'follow' },
    timeoutMs,
    signal,
  );
  const elapsed = Math.round(performance.now() - startedAt);

  if (outcome.failed) {
    if (outcome.timedOut) {
      return {
        url,
        rawName: '',
        verdict: 'timeout',
        httpStatus: null,
        latencyMs: null,
        contentType: null,
        resolution: null,
        bandwidth: null,
        note: `超过 ${Math.round(timeoutMs / 1000)} 秒没有响应`,
        tier: 'L3',
      };
    }
    // 交给 L2 判断可达性（由调用方决定）
    throw outcome.error instanceof Error ? outcome.error : new Error('CORS 拦截');
  }

  if (!outcome.ok) {
    return {
      url,
      rawName: '',
      verdict: 'dead',
      httpStatus: outcome.status,
      latencyMs: elapsed,
      contentType: outcome.contentType,
      resolution: null,
      bandwidth: null,
      note: `服务器返回 HTTP ${outcome.status}`,
      tier: 'L1',
    };
  }

  const isHls = outcome.text.includes('#EXTM3U') || /mpegurl/i.test(outcome.contentType);
  if (!isHls) {
    return {
      url,
      rawName: '',
      verdict: 'alive',
      httpStatus: outcome.status,
      latencyMs: elapsed,
      contentType: outcome.contentType || null,
      resolution: null,
      bandwidth: null,
      note: outcome.contentType.length > 0 ? `可访问（${outcome.contentType}）` : '可访问',
      tier: 'L1',
    };
  }

  const variants = parseVariants(outcome.text, url);
  if (variants.length === 0) {
    return {
      url,
      rawName: '',
      verdict: 'alive',
      httpStatus: outcome.status,
      latencyMs: elapsed,
      contentType: outcome.contentType || null,
      resolution: null,
      bandwidth: null,
      note: '是播放列表（单码率）',
      tier: 'L1',
    };
  }

  const best = variants[0] as VariantInfo;
  const segment = await fetchWithTimeout(
    best.uri,
    { headers: { Range: `bytes=0-${SEGMENT_RANGE_BYTES - 1}` }, redirect: 'follow' },
    timeoutMs,
    signal,
  );

  return {
    url,
    rawName: '',
    verdict: 'alive',
    httpStatus: outcome.status,
    latencyMs: elapsed,
    contentType: outcome.contentType || null,
    resolution: best.resolution,
    bandwidth: best.bandwidth > 0 ? best.bandwidth : null,
    note: segment.failed || !segment.ok ? '播放列表可读，但分片读取被拦（仍可能可播）' : '播放列表与分片均可读',
    tier: 'L1',
  };
}

/**
 * 探测单条源（三级阶梯）。
 *
 * @param entry 待检测条目
 * @param options 超时与前缀
 * @return 检测结果
 */
export async function probeOneBrowser(entry: ProbeEntry, options: ProbeOptions = {}): Promise<BrowserProbeResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const prefix = options.urlPrefix ?? '';
  const target = `${prefix}${entry.url}`;

  /**
   * 统一补齐频道名后再返回。
   *
   * @param result 结果
   * @return 结果
   */
  const withName = (result: BrowserProbeResult): BrowserProbeResult => ({ ...result, rawName: entry.rawName, url: entry.url });

  try {
    const l1 = await tierCors(target, timeoutMs, options.signal);
    return withName(l1);
  } catch (error) {
    if (isTimeoutError(error)) {
      return withName({
        url: entry.url,
        rawName: entry.rawName,
        verdict: 'timeout',
        httpStatus: null,
        latencyMs: null,
        contentType: null,
        resolution: null,
        bandwidth: null,
        note: `超过 ${Math.round(timeoutMs / 1000)} 秒没有响应`,
        tier: 'L3',
      });
    }
    const l2 = await tierNoCors(target, timeoutMs, options.signal);
    return withName(l2);
  }
}

/**
 * 批量探测（自研并发池，默认并发 8）。
 *
 * 页面切到后台时暂停派发新任务，回到前台继续（避免电视盒子/手机后台被限速）。
 *
 * @param entries 待检测条目
 * @param options 并发、超时、进度回调、取消信号
 * @return 与输入顺序一致的结果数组
 */
export async function probeAllBrowser(
  entries: readonly ProbeEntry[],
  options: {
    concurrency?: number;
    timeoutMs?: number;
    urlPrefix?: string;
    onProgress?: (done: number, total: number, alive: number) => void;
    signal?: AbortSignal;
  } = {},
): Promise<BrowserProbeResult[]> {
  const total = entries.length;
  const results = new Array<BrowserProbeResult>(total);
  if (total === 0) {
    return results;
  }

  const concurrency = Math.max(1, Math.min(options.concurrency ?? DEFAULT_CONCURRENCY, MAX_CONCURRENCY));
  let cursor = 0;
  let done = 0;
  let aliveCount = 0;

  /**
   * 等待页面重新可见。
   *
   * @return 可见后 resolve
   */
  const waitForVisible = async (): Promise<void> => {
    if (typeof document === 'undefined' || !document.hidden) {
      return;
    }
    await new Promise<void>((resolve) => {
      const handler = (): void => {
        document.removeEventListener('visibilitychange', handler);
        resolve();
      };
      document.addEventListener('visibilitychange', handler);
    });
  };

  const worker = async (): Promise<void> => {
    for (;;) {
      if (options.signal?.aborted === true) {
        return;
      }
      const index = cursor;
      cursor += 1;
      if (index >= total) {
        return;
      }
      await waitForVisible();
      const entry = entries[index] as ProbeEntry;
      const result = await probeOneBrowser(entry, {
        timeoutMs: options.timeoutMs,
        urlPrefix: options.urlPrefix,
        signal: options.signal,
      });
      results[index] = result;
      done += 1;
      if (result.verdict === 'alive' || result.verdict === 'reachable') {
        aliveCount += 1;
      }
      options.onProgress?.(done, total, aliveCount);
    }
  };

  const workers: Array<Promise<void>> = [];
  for (let index = 0; index < Math.min(concurrency, total); index += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

/**
 * 生成可直接粘进电视播放器的 TXT 文本（UTF-8、LF、无 BOM）。
 *
 * @param results 检测结果（只输出可用/可达的）
 * @return TXT 文本
 */
export function buildExportTxt(results: readonly BrowserProbeResult[]): string {
  const usable = results.filter((item) => item.verdict === 'alive' || item.verdict === 'reachable');
  if (usable.length === 0) {
    return '';
  }
  const lines: string[] = ['检测结果,#genre#'];
  for (const item of usable) {
    const name = item.rawName.trim().length > 0 ? item.rawName.trim() : '未命名频道';
    lines.push(`${name},${item.url}`);
  }
  return `${lines.join('\n')}\n`;
}
