/**
 * @file 优选排序（P0-4）：分辨率降序 → 延迟升序，每频道最多 3 个源。
 *
 * 硬规则：**不以死链凑数** —— 存活源不足 3 个就保留实际数量；0 个的频道整条消失。
 */

import { SELECT } from '../config';
import { sortChannels } from '../data/groups';
import type { Channel, ProbeResult, Stream } from '../types';

/**
 * 源比较器：分辨率（宽高）降序 → 延迟升序 → urlKey 升序（保证稳定输出）。
 *
 * @param left 结果 A
 * @param right 结果 B
 * @return 比较值
 */
export function compareProbeResult(left: ProbeResult, right: ProbeResult): number {
  const leftWidth = left.width ?? 0;
  const rightWidth = right.width ?? 0;
  if (rightWidth !== leftWidth) {
    return rightWidth - leftWidth;
  }
  const leftHeight = left.height ?? 0;
  const rightHeight = right.height ?? 0;
  if (rightHeight !== leftHeight) {
    return rightHeight - leftHeight;
  }
  const leftLatency = left.latencyMs ?? Number.MAX_SAFE_INTEGER;
  const rightLatency = right.latencyMs ?? Number.MAX_SAFE_INTEGER;
  if (leftLatency !== rightLatency) {
    return leftLatency - rightLatency;
  }
  if (left.urlKey === right.urlKey) {
    return 0;
  }
  return left.urlKey < right.urlKey ? -1 : 1;
}

/**
 * 把探测结果编成 map（后写覆盖先写，同一 urlKey 只保留一条）。
 *
 * @param results 探测结果列表
 * @return urlKey → 结果
 */
export function indexResults(results: readonly ProbeResult[]): Map<string, ProbeResult> {
  const map = new Map<string, ProbeResult>();
  for (const result of results) {
    map.set(result.urlKey, result);
  }
  return map;
}

/**
 * 对单个频道做优选。
 *
 * @param channel 频道
 * @param resultIndex urlKey → 结果
 * @return 优选后的频道；无存活源时返回 null
 */
export function rankChannel(channel: Channel, resultIndex: Map<string, ProbeResult>): Channel | null {
  const alive: Array<{ stream: Stream; result: ProbeResult }> = [];
  const seen = new Set<string>();

  for (const stream of channel.streams) {
    if (seen.has(stream.urlKey)) {
      continue;
    }
    const result = resultIndex.get(stream.urlKey);
    if (result === undefined || !result.alive) {
      continue;
    }
    seen.add(stream.urlKey);
    alive.push({ stream, result });
  }

  if (alive.length < SELECT.minAlivePerChannel) {
    return null;
  }

  alive.sort((left, right) => compareProbeResult(left.result, right.result));
  const picked = alive.slice(0, SELECT.maxPerChannel).map((item) => item.stream);

  return { ...channel, streams: picked };
}

/**
 * 批量优选，剔除 0 存活源的频道，返回有序结果。
 *
 * @param channels 归一后的频道
 * @param results 探测结果
 * @return 优选后的频道（已按分组与 channelId 排序）
 */
export function rankChannels(channels: readonly Channel[], results: readonly ProbeResult[]): Channel[] {
  const resultIndex = indexResults(results);
  const ranked: Channel[] = [];
  for (const channel of channels) {
    const picked = rankChannel(channel, resultIndex);
    if (picked !== null) {
      ranked.push(picked);
    }
  }
  return sortChannels(ranked);
}

/**
 * 统计输出源总数。
 *
 * @param channels 优选后的频道
 * @return 源条数
 */
export function countSources(channels: readonly Channel[]): number {
  let total = 0;
  for (const channel of channels) {
    total += channel.streams.length;
  }
  return total;
}
