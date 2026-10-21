/**
 * @file 解析层公共工具（清洗文本、拆 URL、构造未归一 Stream）。
 */

import type { Stream } from '../types';
import { toUrlKey } from '../util/slug';

/**
 * 清洗文档：去 BOM、CRLF → LF、去掉行尾空白。
 *
 * @param text 原始文本
 * @return 行数组（已去除首尾空白与空行）
 */
export function toCleanLines(text: string): string[] {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * 判断文本是否像一条播放地址（而非频道名、注释）。
 *
 * @param value 待判定文本
 * @return true 表示像 URL
 */
export function looksLikeUrl(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return false;
  }
  return /^(https?|rtmp|rtsp|rtp|udp|p3p|p2p|mms):\/\//i.test(trimmed);
}

/**
 * 拆分 `url1#url2#url3` 形式的多源字段。
 *
 * @param raw 原始字段
 * @return 地址数组（已去空、去重、保持顺序）
 */
export function splitUrlField(raw: string): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const piece of raw.split('#')) {
    const url = piece.trim();
    if (url.length === 0) {
      continue;
    }
    const key = toUrlKey(url);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    urls.push(url);
  }
  return urls;
}

/**
 * 构造一条未归一的 Stream（channelId / group 由归一化阶段填充）。
 *
 * @param url 播放地址
 * @param rawName 上游原始频道名，纯 URL 行为空串
 * @param origin 来源标识
 * @param options 可选：台标、是否用户自填、上游分组名
 * @return Stream
 */
export function makeStream(
  url: string,
  rawName: string,
  origin: string,
  options: { logo?: string; userAdded?: boolean; upstreamGroup?: string } = {},
): Stream {
  const stream: Stream = {
    url: url.trim(),
    urlKey: toUrlKey(url),
    rawName: rawName.trim(),
    channelId: '',
    group: '其他',
    origin,
  };
  if (options.logo !== undefined && options.logo.length > 0) {
    stream.logo = options.logo;
  }
  if (options.userAdded === true) {
    stream.userAdded = true;
  }
  // 上游分组名只透传非空值：空串与"没有分组信息"语义一致，避免下游判断出现三态
  if (options.upstreamGroup !== undefined) {
    const upstreamGroup = options.upstreamGroup.trim();
    if (upstreamGroup.length > 0) {
      stream.upstreamGroup = upstreamGroup;
    }
  }
  return stream;
}
