/**
 * @file Node 端测活（L4）：`probeOne` 单源 + `probeAll` 并发池 + 全局 deadline。
 *
 * 存活判定（设计 §3「存活判定标准」）：
 *   1. `GET` + `Range` + `redirect:'follow'`，首跳超时 8s
 *   2. 非 http/https → `skipped`
 *   3. 非 2xx/3xx → `dead`
 *   4. HLS → 解析 master 取最高变体 → 再拉首片；拿到真实字节才算活
 *   5. 非 HLS → 2xx 且拿到 ≥188 字节或 video 类 content-type 才算活
 *   6. 超时 → `timeout`；其它异常 → `dead` + error 文案
 *   7. 到全局 deadline 仍未开始的源 → `skipped`（不输出）
 *
 * 全部触网路径走 `deps.fetchImpl` 注入，单测可完全离线。
 */

import { PROBE } from '../config';
import type { ProbeDeps, ProbeResult, ProbeStatus, ProbeTarget, StreamKind } from '../types';
import { createTimeoutSignal, describeError, isAbortError } from '../util/http';
import { runPool } from '../util/pool';
import { isSupportedUrl, toProbeUrl, toUrlKey } from '../util/slug';
import { formatIsoCst } from '../util/time';
import {
  firstSegmentUri,
  isHlsContentType,
  isMasterPlaylist,
  looksLikeM3U8,
  parseVariantStreams,
} from './hls';

/** `probeOne` 的可选项。 */
export interface ProbeOneOptions {
  /** 首跳超时（ms），默认走 config */
  timeoutMs?: number;
  /** 子请求超时（ms），默认走 config */
  subTimeoutMs?: number;
  /** 上层取消信号 */
  signal?: AbortSignal;
}

/** `probeAll` 的可选项。 */
export interface ProbeAllOptions {
  /** 并发池大小 */
  concurrency: number;
  /** 首跳超时 */
  timeoutMs: number;
  /** 全局 deadline（毫秒时间戳），到达后剩余源记 skipped */
  deadline: number;
  /** 每完成一项回调 */
  onProgress?: (done: number, total: number) => void;
}

/** 读取正文的最大字节数，防止上游无视 Range 导致无限下载。 */
interface LimitedBody {
  bytes: Uint8Array;
  text: string;
  truncated: boolean;
}

/**
 * 按上限读取响应体（超限主动中断）。
 *
 * @param response fetch 响应
 * @param limitBytes 最大读取字节数
 * @return 字节与解码文本
 */
async function readBodyUpTo(response: Response, limitBytes: number): Promise<LimitedBody> {
  const body = response.body;
  if (body === null || body === undefined) {
    return { bytes: new Uint8Array(0), text: '', truncated: false };
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value === undefined) {
        continue;
      }
      chunks.push(value);
      total += value.byteLength;
      if (total >= limitBytes) {
        truncated = true;
        break;
      }
    }
  } catch {
    // 读到一半被上游断开：已拿到的字节仍然有效
  } finally {
    try {
      await reader.cancel();
    } catch {
      // 关闭失败无关紧要
    }
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder('utf-8', { fatal: false }).decode(merged);
  return { bytes: merged, text, truncated };
}

/**
 * 嗅探流的封装类型。
 *
 * @param contentType 响应头
 * @param text 正文开头
 * @param url 地址（看后缀兜底）
 * @return 封装类型
 */
export function detectStreamKind(contentType: string, text: string, url: string): StreamKind {
  const ct = contentType.toLowerCase();
  if (isHlsContentType(ct) || looksLikeM3U8(text)) {
    return 'hls';
  }
  if (ct.includes('flv') || /\.flv(\?|$)/i.test(url)) {
    return 'flv';
  }
  if (ct.includes('mp2t') || /\.ts(\?|$)/i.test(url)) {
    return 'ts';
  }
  if (ct.includes('mp4') || /\.mp4(\?|$)/i.test(url)) {
    return 'mp4';
  }
  return 'other';
}

/**
 * 判断 content-type 是否属于"有真实流数据"的视频类。
 *
 * @param contentType 响应头
 * @return true 表示视频类
 */
function isVideoContentType(contentType: string): boolean {
  const ct = contentType.toLowerCase();
  return ct.includes('video') || ct.includes('octet-stream') || ct.includes('mp2t') || ct.includes('mp2s');
}

/** 一次子请求的结果。 */
interface SubFetchResult {
  ok: boolean;
  status: number;
  contentType: string;
  body: LimitedBody;
  timedOut: boolean;
  error?: string;
}

/**
 * 发一次带超时的 GET，并把正文读到上限。
 *
 * @param target 地址
 * @param doFetch 注入的 fetch
 * @param timeoutMs 超时
 * @param rangeBytes Range 字节数
 * @param parentSignal 上层信号
 * @return 子请求结果
 */
async function subFetch(
  target: string,
  doFetch: typeof fetch,
  timeoutMs: number,
  rangeBytes: number,
  parentSignal?: AbortSignal,
): Promise<SubFetchResult> {
  const timeout = createTimeoutSignal(timeoutMs, parentSignal);
  try {
    const response = await doFetch(target, {
      method: 'GET',
      redirect: 'follow',
      signal: timeout.signal,
      headers: {
        Range: `bytes=0-${rangeBytes - 1}`,
        'User-Agent': 'IPTVHub/1.0',
        Accept: '*/*',
      },
    });
    const contentType = response.headers.get('content-type') ?? '';
    const body = await readBodyUpTo(response, rangeBytes);
    return { ok: response.ok, status: response.status, contentType, body, timedOut: false };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      contentType: '',
      body: { bytes: new Uint8Array(0), text: '', truncated: false },
      timedOut: timeout.isTimedOut() || isAbortError(error),
      error: describeError(error),
    };
  } finally {
    timeout.cancel();
  }
}

/**
 * 判断一次子请求是否"拿到了真实流数据"。
 *
 * @param result 子请求结果
 * @return true 表示有数据
 */
function hasRealData(result: SubFetchResult): boolean {
  if (!result.ok) {
    return false;
  }
  if (result.body.bytes.byteLength >= PROBE.tsPacketBytes) {
    return true;
  }
  return result.body.bytes.byteLength > 0 && isVideoContentType(result.contentType);
}

/** HLS 链路探测的返回值。 */
interface HlsOutcome {
  alive: boolean;
  width?: number;
  height?: number;
  resolution?: string;
  bandwidth?: number;
  error?: string;
}

/**
 * HLS 二跳/三跳探测：master → 最高变体 → 首片。
 *
 * @param playlistUrl playlist 地址
 * @param playlistText playlist 正文
 * @param doFetch 注入的 fetch
 * @param subTimeoutMs 子请求超时
 * @param parentSignal 上层信号
 * @return 探测结论
 */
async function probeHlsChain(
  playlistUrl: string,
  playlistText: string,
  doFetch: typeof fetch,
  subTimeoutMs: number,
  parentSignal?: AbortSignal,
): Promise<HlsOutcome> {
  if (isMasterPlaylist(playlistText)) {
    const variants = parseVariantStreams(playlistText, playlistUrl);
    if (variants.length === 0) {
      return { alive: false, error: 'master playlist 无可解析变体' };
    }
    for (const variant of variants.slice(0, 3)) {
      const variantFetch = await subFetch(
        variant.uri,
        doFetch,
        subTimeoutMs,
        PROBE.subRangeBytes,
        parentSignal,
      );
      if (!variantFetch.ok || variantFetch.body.text.length === 0) {
        continue;
      }
      const segment = firstSegmentUri(variantFetch.body.text, variant.uri);
      if (segment.length === 0) {
        continue;
      }
      const segmentFetch = await subFetch(segment, doFetch, subTimeoutMs, PROBE.subRangeBytes, parentSignal);
      if (!hasRealData(segmentFetch)) {
        continue;
      }
      const outcome: HlsOutcome = { alive: true };
      if (variant.width !== undefined) {
        outcome.width = variant.width;
      }
      if (variant.height !== undefined) {
        outcome.height = variant.height;
      }
      if (variant.resolution !== undefined) {
        outcome.resolution = variant.resolution;
      }
      if (variant.bandwidth > 0) {
        outcome.bandwidth = variant.bandwidth;
      }
      return outcome;
    }
    return { alive: false, error: 'master playlist 的所有变体均无有效分片' };
  }

  const segment = firstSegmentUri(playlistText, playlistUrl);
  if (segment.length === 0) {
    return { alive: false, error: 'media playlist 中未找到分片地址' };
  }
  const segmentFetch = await subFetch(segment, doFetch, subTimeoutMs, PROBE.subRangeBytes, parentSignal);
  if (!hasRealData(segmentFetch)) {
    return { alive: false, error: `首片无有效数据（HTTP ${segmentFetch.status}）` };
  }
  return { alive: true };
}

/** 构造一个结论对象，统一补齐必填字段。 */
function makeResult(
  urlKey: string,
  status: ProbeStatus,
  checkedAt: string,
  extra: Partial<ProbeResult> = {},
): ProbeResult {
  const result: ProbeResult = {
    urlKey,
    status,
    alive: status === 'alive',
    checkedAt,
  };
  return { ...result, ...extra, alive: status === 'alive' };
}

/**
 * 探测单条源。
 *
 * @param url 原始地址（可带 `|Header` 后缀，探测时自动剥离）
 * @param options 超时与取消
 * @param deps 注入的 fetch / now（单测离线关键）
 * @return 探测结果
 */
export async function probeOne(
  url: string,
  options: ProbeOneOptions = {},
  deps: ProbeDeps = {},
): Promise<ProbeResult> {
  const now = deps.now ?? Date.now;
  const doFetch = deps.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? PROBE.timeoutMs;
  const subTimeoutMs = options.subTimeoutMs ?? PROBE.subTimeoutMs;
  const urlKey = toUrlKey(url);
  const checkedAt = formatIsoCst(now());
  const probeUrl = toProbeUrl(url);

  if (!isSupportedUrl(probeUrl)) {
    return makeResult(urlKey, 'skipped', checkedAt, { error: '不支持的协议（rtmp/rtsp/udp 等不作探测）' });
  }

  const startedAt = now();
  const timeout = createTimeoutSignal(timeoutMs, options.signal);
  let response: Response;
  try {
    response = await doFetch(probeUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: timeout.signal,
      headers: {
        Range: `bytes=0-${PROBE.firstRangeBytes - 1}`,
        'User-Agent': 'IPTVHub/1.0',
        Accept: '*/*',
      },
    });
  } catch (error) {
    const timedOut = timeout.isTimedOut() || isAbortError(error);
    timeout.cancel();
    if (timedOut) {
      return makeResult(urlKey, 'timeout', checkedAt, {
        error: `首跳超时（${timeoutMs}ms）`,
        latencyMs: now() - startedAt,
      });
    }
    return makeResult(urlKey, 'dead', checkedAt, {
      error: describeError(error),
      latencyMs: now() - startedAt,
    });
  }

  const latencyMs = now() - startedAt;
  const httpStatus = response.status;
  const contentType = response.headers.get('content-type') ?? '';

  if (httpStatus < 200 || httpStatus >= 400) {
    timeout.cancel();
    return makeResult(urlKey, 'dead', checkedAt, {
      httpStatus,
      contentType,
      latencyMs,
      error: `HTTP ${httpStatus}`,
    });
  }

  let body: LimitedBody;
  try {
    body = await readBodyUpTo(response, PROBE.firstRangeBytes);
  } catch (error) {
    timeout.cancel();
    return makeResult(urlKey, 'dead', checkedAt, {
      httpStatus,
      contentType,
      latencyMs,
      error: describeError(error),
    });
  }
  timeout.cancel();

  const kind = detectStreamKind(contentType, body.text, probeUrl);
  const baseExtra: Partial<ProbeResult> = { httpStatus, contentType, latencyMs, kind };

  if (kind === 'hls') {
    const outcome = await probeHlsChain(probeUrl, body.text, doFetch, subTimeoutMs, options.signal);
    if (!outcome.alive) {
      return makeResult(urlKey, 'dead', checkedAt, { ...baseExtra, error: outcome.error ?? 'HLS 无有效分片' });
    }
    const aliveExtra: Partial<ProbeResult> = { ...baseExtra };
    if (outcome.width !== undefined) {
      aliveExtra.width = outcome.width;
    }
    if (outcome.height !== undefined) {
      aliveExtra.height = outcome.height;
    }
    if (outcome.resolution !== undefined) {
      aliveExtra.resolution = outcome.resolution;
    }
    if (outcome.bandwidth !== undefined) {
      aliveExtra.bandwidth = outcome.bandwidth;
    }
    return makeResult(urlKey, 'alive', checkedAt, aliveExtra);
  }

  if (hasRealData({ ok: true, status: httpStatus, contentType, body, timedOut: false })) {
    return makeResult(urlKey, 'alive', checkedAt, baseExtra);
  }

  return makeResult(urlKey, 'dead', checkedAt, {
    ...baseExtra,
    error: body.bytes.byteLength === 0 ? '响应为空' : `无有效流数据（${body.bytes.byteLength} 字节）`,
  });
}

/**
 * 并发探测一批源；到达全局 deadline 后剩余源记 `skipped`（不阻塞出产物）。
 *
 * @param targets 目标列表
 * @param options 并发、超时、deadline、进度回调
 * @param deps 注入的 fetch / now
 * @return 与输入顺序一致的结果数组
 */
export async function probeAll(
  targets: readonly ProbeTarget[],
  options: ProbeAllOptions,
  deps: ProbeDeps = {},
): Promise<ProbeResult[]> {
  const now = deps.now ?? Date.now;
  const checkedAt = formatIsoCst(now());

  return runPool(
    targets,
    async (target) => {
      if (now() >= options.deadline) {
        return makeResult(target.urlKey, 'skipped', checkedAt, {
          error: '超出全局时间预算，本轮未测活',
        });
      }
      try {
        return await probeOne(target.url, { timeoutMs: options.timeoutMs }, deps);
      } catch (error) {
        return makeResult(target.urlKey, 'dead', checkedAt, { error: describeError(error) });
      }
    },
    options.concurrency,
    options.onProgress,
  );
}

/**
 * 优选打分（仅 rank 内部用，不落盘）：
 * `分辨率档位 * 1e6 + (10000 - min(延迟, 10000))`。
 *
 * @param result 探测结果
 * @return 分数，越大越好
 */
export function scoreResult(result: ProbeResult): number {
  const width = result.width ?? 0;
  const tier = width >= 1920 ? 3 : width >= 1280 ? 2 : width >= 854 ? 1 : 0;
  const latency = Math.min(result.latencyMs ?? 10000, 10000);
  return tier * 1_000_000 + (10_000 - latency);
}
