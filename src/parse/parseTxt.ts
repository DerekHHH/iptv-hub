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
 * 分组头本身不产出 Stream —— 分组由频道名归一规则判定（保证与 M3U 口径一致），
 * 上游自己写的分组名只当注释忽略。
 *
 * @param text 原始文本
 * @param origin 来源标识
 * @return 未归一的 Stream 列表
 */
export function parseTxt(text: string, origin: string): Stream[] {
  const lines = toCleanLines(text);
  const streams: Stream[] = [];

  for (const line of lines) {
    if (line.includes(GENRE_MARKER)) {
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
          streams.push(makeStream(url, '', origin));
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
      streams.push(makeStream(url, rawName, origin));
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
