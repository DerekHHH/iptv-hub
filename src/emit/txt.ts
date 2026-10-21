/**
 * @file TXT 产物生成（P0-5）。
 *
 * 格式（约定 §3，DIYP / 影视仓 / TVBox 通用）：
 * ```
 * 港澳台,#genre#
 * 翡翠台,http://a#http://b
 *
 * 广东,#genre#
 * 广州综合,http://c
 * ```
 * 硬约束：UTF-8 无 BOM、`\n` 换行、组间空行、文件末尾单个换行。
 */

import { GROUP_ORDER } from '../config';
import { PATHS } from '../config';
import { sortChannels } from '../data/groups';
import type { Channel, GroupKey } from '../types';
import { writeTextFile } from '../util/fsx';

/** 产物过滤条件（P2-2 `lite.txt` 预留，本期不启用）。 */
export interface TxtFilter {
  /** 只输出这些分组，缺省 = 全部 */
  groups?: readonly GroupKey[];
  /** 只输出这些频道 slug，缺省 = 全部 */
  channelIds?: readonly string[];
}

/** TXT 分组头标记。 */
const GENRE_MARKER = '#genre#';

/** 组间分隔空行数。 */
const GROUP_SEPARATOR_BLANK_LINES = 1;

/**
 * 生成 TXT 文本（纯函数，便于单测）。
 *
 * @param channels 优选后的频道
 * @param filter 可选过滤条件（预留 lite.txt 用）
 * @return TXT 文本（以单个 `\n` 结尾）
 */
export function renderTxt(channels: readonly Channel[], filter?: TxtFilter): string {
  const allowedGroups = filter?.groups;
  const allowedIds = filter?.channelIds;
  const idSet = allowedIds === undefined ? null : new Set(allowedIds);

  const ordered = sortChannels(channels).filter((channel) => {
    if (allowedGroups !== undefined && !allowedGroups.includes(channel.group)) {
      return false;
    }
    if (idSet !== null && !idSet.has(channel.id)) {
      return false;
    }
    return channel.streams.length > 0;
  });

  const lines: string[] = [];
  let isFirstGroup = true;

  for (const group of GROUP_ORDER) {
    const groupChannels = ordered.filter((channel) => channel.group === group);
    if (groupChannels.length === 0) {
      continue;
    }
    if (!isFirstGroup) {
      for (let index = 0; index < GROUP_SEPARATOR_BLANK_LINES; index += 1) {
        lines.push('');
      }
    }
    isFirstGroup = false;

    lines.push(`${group},${GENRE_MARKER}`);
    for (const channel of groupChannels) {
      const urls = channel.streams.map((stream) => stream.url).join('#');
      lines.push(`${channel.name},${urls}`);
    }
  }

  if (lines.length === 0) {
    return '';
  }
  return `${lines.join('\n')}\n`;
}

/**
 * 写 TXT 产物（UTF-8、无 BOM、LF）。
 *
 * @param channels 优选后的频道
 * @param filePath 目标路径，默认 `dist/txt/all.txt`
 * @param filter 可选过滤条件
 */
export async function emitTxt(
  channels: readonly Channel[],
  filePath: string = PATHS.txt,
  filter?: TxtFilter,
): Promise<void> {
  const text = renderTxt(channels, filter);
  await writeTextFile(filePath, text);
}
