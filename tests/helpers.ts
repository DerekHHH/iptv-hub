/**
 * @file 测试用构造器（避免每个测试文件重复写对象字面量）。
 */

import { makeStream } from '../src/parse/common';
import type { Channel, GroupKey, ProbeResult, Stream } from '../src/types';
import { toUrlKey } from '../src/util/slug';

/**
 * 造一个频道。
 *
 * @param id slug
 * @param name 中文名
 * @param group 分组
 * @param urls 源地址列表
 * @return Channel
 */
export function makeChannel(id: string, name: string, group: GroupKey, urls: readonly string[]): Channel {
  const streams: Stream[] = urls.map((url) => makeStream(url, name, 'test'));
  for (const stream of streams) {
    stream.channelId = id;
    stream.group = group;
  }
  return { id, name, aliases: [name], group, streams };
}

/**
 * 造一个探测结果。
 *
 * @param url 源地址（自动算 urlKey）
 * @param extra 额外字段
 * @return ProbeResult
 */
export function makeResult(url: string, extra: Partial<ProbeResult> = {}): ProbeResult {
  const status = extra.status ?? 'alive';
  const base: ProbeResult = {
    urlKey: toUrlKey(url),
    status,
    alive: status === 'alive',
    checkedAt: '2025-01-01T12:00:00+08:00',
  };
  return { ...base, ...extra, alive: (extra.status ?? 'alive') === 'alive' };
}
