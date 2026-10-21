/**
 * @file M3U 产物生成（P0-6）。
 *
 * 格式（约定 §1）：
 * ```
 * #EXTM3U
 * #EXTINF:-1 tvg-id="cctv1" tvg-name="CCTV-1 综合" tvg-logo="" group-title="央视",CCTV-1 综合
 * http://example.com/cctv1.m3u8
 * ```
 * 同一频道 3 个源 → 3 条 `#EXTINF` 记录（播放器按条目列表展示，重复台名更兼容）。
 */

import { PATHS } from '../config';
import { sortChannels } from '../data/groups';
import type { Channel, GroupKey } from '../types';
import { writeTextFile } from '../util/fsx';

/** M3U 头部。 */
const HEADER = '#EXTM3U';

/**
 * 转义属性值里的双引号与换行（避免破坏 EXTINF 语法）。
 *
 * @param value 原始值
 * @return 安全值
 */
function safeAttribute(value: string): string {
  return value.replace(/"/g, "'").replace(/[\r\n]+/g, ' ').trim();
}

/**
 * 生成一条 `#EXTINF` 行。
 *
 * @param channel 频道
 * @param logo 台标（可为空串）
 * @return EXTINF 行
 */
export function renderExtInf(channel: Channel, logo: string): string {
  const attributes = [
    `tvg-id="${safeAttribute(channel.id)}"`,
    `tvg-name="${safeAttribute(channel.name)}"`,
    `tvg-logo="${safeAttribute(logo)}"`,
    `group-title="${safeAttribute(channel.group)}"`,
  ].join(' ');
  return `#EXTINF:-1 ${attributes},${safeAttribute(channel.name)}`;
}

/**
 * 生成 M3U 文本（纯函数）。
 *
 * @param channels 优选后的频道
 * @param filterGroups 可选：只输出这些分组
 * @return M3U 文本（以单个 `\n` 结尾）
 */
export function renderM3u(channels: readonly Channel[], filterGroups?: readonly GroupKey[]): string {
  const ordered = sortChannels(channels).filter((channel) => {
    if (channel.streams.length === 0) {
      return false;
    }
    if (filterGroups !== undefined && !filterGroups.includes(channel.group)) {
      return false;
    }
    return true;
  });

  const lines: string[] = [HEADER];
  for (const channel of ordered) {
    const logo = channel.logo ?? '';
    for (const stream of channel.streams) {
      lines.push(renderExtInf(channel, logo));
      lines.push(stream.url);
    }
  }
  return `${lines.join('\n')}\n`;
}

/**
 * 写 M3U 产物（UTF-8、无 BOM、LF）。
 *
 * @param channels 优选后的频道
 * @param filePath 目标路径，默认 `dist/m3u/all.m3u`
 * @param filterGroups 可选：只输出这些分组
 */
export async function emitM3u(
  channels: readonly Channel[],
  filePath: string = PATHS.m3u,
  filterGroups?: readonly GroupKey[],
): Promise<void> {
  await writeTextFile(filePath, renderM3u(channels, filterGroups));
}
