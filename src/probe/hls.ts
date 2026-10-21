/**
 * @file HLS（m3u8）解析：master → 变体 → 首个分片。
 *
 * 只做测活需要的最小解析：拿分辨率、码率、以及"真的有流数据"的那个分片地址。
 */

import { isSupportedUrl } from '../util/slug';

/** 一个 master playlist 里的变体流。 */
export interface HlsVariant {
  /** 变体地址（已解析为绝对地址） */
  uri: string;
  /** 码率 bps，缺失为 0 */
  bandwidth: number;
  /** 宽（来自 RESOLUTION） */
  width?: number;
  /** 高（来自 RESOLUTION） */
  height?: number;
  /** '1920x1080' */
  resolution?: string;
}

const STREAM_INF_PREFIX = '#EXT-X-STREAM-INF:';
const ATTR_PATTERN = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;

/**
 * 判断 content-type 是否 HLS。
 *
 * @param contentType 响应头
 * @return true 表示 m3u8
 */
export function isHlsContentType(contentType: string): boolean {
  return /mpegurl|m3u8?/i.test(contentType);
}

/**
 * 判断正文是否是 m3u8（用前 64 字节嗅探）。
 *
 * @param body 已解码的正文开头
 * @return true 表示 m3u8
 */
export function looksLikeM3U8(body: string): boolean {
  return body.replace(/^\uFEFF/, '').trimStart().startsWith('#EXTM3U');
}

/**
 * 判断是否 master playlist（含 `#EXT-X-STREAM-INF`）。
 *
 * @param text m3u8 文本
 * @return true 表示 master
 */
export function isMasterPlaylist(text: string): boolean {
  return text.includes(STREAM_INF_PREFIX);
}

/**
 * 把相对地址解析成绝对地址。
 *
 * @param base 基准地址
 * @param uri 相对或绝对地址
 * @return 绝对地址；无法解析时返回空串
 */
export function resolveUri(base: string, uri: string): string {
  const trimmed = uri.trim();
  if (trimmed.length === 0) {
    return '';
  }
  if (isSupportedUrl(trimmed)) {
    return trimmed;
  }
  try {
    const resolved = new URL(trimmed, base).toString();
    return isSupportedUrl(resolved) ? resolved : '';
  } catch {
    return '';
  }
}

/** 解析一条 `#EXT-X-STREAM-INF` 的属性串。 */
function parseStreamInfAttributes(line: string): { bandwidth: number; width?: number; height?: number } {
  const result: { bandwidth: number; width?: number; height?: number } = { bandwidth: 0 };
  const head = line.slice(STREAM_INF_PREFIX.length);
  ATTR_PATTERN.lastIndex = 0;
  let match = ATTR_PATTERN.exec(head);
  while (match !== null) {
    const key = (match[1] ?? '').toUpperCase();
    const rawValue = (match[2] ?? '').trim().replace(/^"|"$/g, '');
    if (key === 'BANDWIDTH') {
      const parsed = Number(rawValue);
      if (Number.isFinite(parsed) && parsed > 0) {
        result.bandwidth = parsed;
      }
    } else if (key === 'RESOLUTION') {
      const resolutionMatch = rawValue.match(/^(\d+)\s*[x*]\s*(\d+)$/i);
      if (resolutionMatch !== null) {
        const width = Number(resolutionMatch[1]);
        const height = Number(resolutionMatch[2]);
        if (width > 0 && height > 0) {
          result.width = width;
          result.height = height;
        }
      }
    }
    match = ATTR_PATTERN.exec(head);
  }
  return result;
}

/**
 * 解析 master playlist 的全部变体。
 *
 * @param text m3u8 文本
 * @param base 基准地址（用于相对路径）
 * @return 变体列表（按码率降序）
 */
export function parseVariantStreams(text: string, base: string): HlsVariant[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n').map((line) => line.trim());
  const variants: HlsVariant[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (!line.startsWith(STREAM_INF_PREFIX)) {
      continue;
    }
    const attributes = parseStreamInfAttributes(line);
    let uri = '';
    for (let next = index + 1; next < lines.length; next += 1) {
      const candidate = lines[next] ?? '';
      if (candidate.length === 0) {
        continue;
      }
      if (candidate.startsWith('#')) {
        continue;
      }
      uri = resolveUri(base, candidate);
      break;
    }
    if (uri.length === 0) {
      continue;
    }
    const variant: HlsVariant = { uri, bandwidth: attributes.bandwidth };
    if (attributes.width !== undefined && attributes.height !== undefined) {
      variant.width = attributes.width;
      variant.height = attributes.height;
      variant.resolution = `${attributes.width}x${attributes.height}`;
    }
    variants.push(variant);
  }

  variants.sort((left, right) => {
    const leftArea = (left.width ?? 0) * (left.height ?? 1);
    const rightArea = (right.width ?? 0) * (right.height ?? 1);
    if (rightArea !== leftArea) {
      return rightArea - leftArea;
    }
    return right.bandwidth - left.bandwidth;
  });
  return variants;
}

/**
 * 取 media playlist 里的第一个分片地址。
 *
 * @param text m3u8 文本
 * @param base 基准地址
 * @return 绝对地址；找不到返回空串
 */
export function firstSegmentUri(text: string, base: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n').map((line) => line.trim());
  for (const line of lines) {
    if (line.length === 0 || line.startsWith('#')) {
      continue;
    }
    const resolved = resolveUri(base, line);
    if (resolved.length > 0) {
      return resolved;
    }
  }
  return '';
}
