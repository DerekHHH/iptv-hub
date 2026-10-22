/**
 * @file 网页端频道目录：`dist/channels.json`（阶段 3 新增产物）。
 *
 * 为什么网页不直接解析 `all.txt`：txt 只有「频道名,url」两列，台标、别名、
 * 分组计数全丢了，而频道浏览页要按分组展示卡片、要按别名搜索、播放页要按
 * 优选顺序逐个回退试播。所以单独产出一份结构化目录给前端。
 *
 * 与 `emitNba` 一致：调用方负责「失败只告警、不影响主产物」。
 */

import { GROUP_ORDER, PATHS } from '../config';
import type { Channel, GroupKey } from '../types';
import { writeJsonFile } from '../util/fsx';

/** 目录里的一个分组（只列非空分组，顺序与 `GROUP_ORDER` 一致）。 */
export interface ChannelsJsonGroup {
  name: GroupKey;
  count: number;
}

/** 目录里的一个频道。 */
export interface ChannelsJsonEntry {
  /** Channel.id，即路由 `#/play/<id>` 里的 id */
  id: string;
  name: string;
  group: GroupKey;
  /** 命中过的其它写法（去重、剔除与 name 相同的），供搜索用 */
  aliases?: string[];
  logo?: string;
  epg_id?: string;
  /** 存活源地址，按优选顺序排列（网页端从头开始逐个回退） */
  streams: string[];
}

/** `dist/channels.json` 的结构。 */
export interface ChannelsJsonFile {
  version: 1;
  updated_at: string;
  groups: ChannelsJsonGroup[];
  channels: ChannelsJsonEntry[];
}

/**
 * 由优选后的频道列表构造目录对象（纯函数，便于单测）。
 *
 * @param channels 优选后的频道
 * @param updatedAt 构建时间（ISO +08:00）
 * @return 目录对象
 */
export function buildChannelsJson(
  channels: readonly Channel[],
  updatedAt: string,
): ChannelsJsonFile {
  const counts = new Map<GroupKey, number>();
  for (const channel of channels) {
    counts.set(channel.group, (counts.get(channel.group) ?? 0) + 1);
  }

  // 已知分组按 GROUP_ORDER 排；人工覆盖出来的新分组（不在顺序表里）追加到末尾，
  // 既不丢数据，也不打乱既有顺序。
  const ordered: GroupKey[] = [...GROUP_ORDER];
  for (const group of counts.keys()) {
    if (!ordered.includes(group)) {
      ordered.push(group);
    }
  }
  const groups: ChannelsJsonGroup[] = [];
  for (const group of ordered) {
    const count = counts.get(group) ?? 0;
    if (count > 0) {
      groups.push({ name: group, count });
    }
  }

  const entries: ChannelsJsonEntry[] = channels.map((channel) => {
    const entry: ChannelsJsonEntry = {
      id: channel.id,
      name: channel.name,
      group: channel.group,
      streams: channel.streams.map((stream) => stream.url),
    };
    const aliases = channel.aliases.filter(
      (alias) => alias.length > 0 && alias !== channel.name,
    );
    if (aliases.length > 0) {
      entry.aliases = aliases;
    }
    if (channel.logo !== undefined && channel.logo.length > 0) {
      entry.logo = channel.logo;
    }
    if (channel.epgId !== undefined && channel.epgId.length > 0) {
      entry.epg_id = channel.epgId;
    }
    return entry;
  });

  return { version: 1, updated_at: updatedAt, groups, channels: entries };
}

/**
 * 写 `dist/channels.json`。
 *
 * @param channels 优选后的频道
 * @param updatedAt 构建时间（ISO +08:00）
 * @param filePath 目标路径，默认 `PATHS.channelsJson`
 * @return 写出的目录对象
 */
export async function emitChannelsJson(
  channels: readonly Channel[],
  updatedAt: string,
  filePath: string = PATHS.channelsJson,
): Promise<ChannelsJsonFile> {
  const file = buildChannelsJson(channels, updatedAt);
  await writeJsonFile(filePath, file);
  return file;
}
