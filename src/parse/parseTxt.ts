/**
 * @file DIYP / 影视仓 / TVBox 通用 TXT 播放列表解析。
 *
 * 支持的形态：
 *   - 分组头：`分组名,#genre#`（单独一行）
 *   - 频道行：`频道名,http://a#http://b#http://c`
 *   - 纯地址行：`http://a`（无频道名，后续丢弃）
 *   - BOM + CRLF 输入
 */

import type { Stream } from '../types';
import { looksLikeUrl, makeStream, splitUrlField, toCleanLines } from './common';
import { isM3U, parseM3U } from './parseM3U';

/** TXT 的分组头标记。 */
export const GENRE_MARKER = '#genre#';

/**
 * 解析 TXT 文本。
 *
 * 分组头本身不产出 Stream —— 它只会作为 `Stream.upstreamGroup` 透传给下方频道行，
 * 供归一阶段当**分类提示**使用（规则表命中时以规则表为准，见 `normalize/group.ts`）。
 * 也就是说分组头的最终话语权仍小于规则表，不会出现「上游乱分组把 CCTV 塞进港澳台」。
 *
 * @param text 原始文本
 * @param origin 来源标识
 * @return 未归一的 Stream 列表
 */
export function parseTxt(text: string, origin: string): Stream[] {
  const lines = toCleanLines(text);
  const streams: Stream[] = [];
  /** 当前分组头的名字（`分组名,#genre#` 里逗号前的部分）。 */
  let currentGroup = '';

  for (const line of lines) {
    const genreIndex = line.indexOf(GENRE_MARKER);
    if (genreIndex >= 0) {
      // `分组名,#genre#` 或 `#genre#`（无组名）：前者记录分组名，后者清空
      currentGroup = line.slice(0, genreIndex).replace(/,\s*$/, '').trim();
      continue;
    }
    if (line.startsWith('#')) {
      continue;
    }

    const commaIndex = line.indexOf(',');
    if (commaIndex < 0) {
      if (looksLikeUrl(line)) {
        for (const url of splitUrlField(line)) {
          // 纯 URL 无频道名 → rawName 为空，归一阶段直接丢弃（约定 §8-4）
          streams.push(makeStream(url, '', origin, { upstreamGroup: currentGroup }));
        }
      }
      continue;
    }

    const rawName = line.slice(0, commaIndex).trim();
    const urlField = line.slice(commaIndex + 1).trim();
    if (urlField.length === 0) {
      continue;
    }

    const candidates = splitUrlField(urlField).filter((url) => looksLikeUrl(url));
    for (const url of candidates) {
      streams.push(makeStream(url, rawName, origin, { upstreamGroup: currentGroup }));
    }
  }

  return streams;
}

/**
 * 按内容自动选择解析器（M3U 头优先，否则按 TXT 处理）。
 *
 * @param text 原始文本
 * @param origin 来源标识
 * @return 未归一的 Stream 列表
 */
export function parseAuto(text: string, origin: string): Stream[] {
  if (isM3U(text)) {
    return parseM3U(text, origin);
  }
  return parseTxt(text, origin);
}
