/**
 * @file QA 独立补充测试 —— 优选排序（对应验收任务 C3）。
 *
 * 对应 P0-4：分辨率降序 → 延迟升序；不足 3 个就保留实际数量；0 存活整条剔除。
 */

import { describe, expect, it } from 'vitest';

import { SELECT } from '../../src/config';
import { makeStream } from '../../src/parse/common';
import { countSources, rankChannel, rankChannels } from '../../src/select/rank';
import type { Channel, ProbeResult } from '../../src/types';
import { toUrlKey } from '../../src/util/slug';

/**
 * 造一条探测结果。
 *
 * @param url 地址
 * @param extra 覆盖字段
 * @return ProbeResult
 */
function probe(url: string, extra: Partial<ProbeResult> = {}): ProbeResult {
  const status = extra.status ?? 'alive';
  return {
    urlKey: toUrlKey(url),
    status,
    checkedAt: '2025-01-01T12:00:00+08:00',
    ...extra,
    alive: status === 'alive',
  };
}

/**
 * 造一个频道（源顺序即候选顺序）。
 *
 * @param urls 地址列表
 * @param name 频道名
 * @param group 分组
 * @return Channel
 */
function channel(urls: readonly string[], name = 'CCTV-1 综合', group: Channel['group'] = '央视'): Channel {
  return {
    id: 'cctv1',
    name,
    aliases: [name],
    group,
    streams: urls.map((url) => makeStream(url, name, 'qa')),
  };
}

describe('rankChannels：分辨率降序 → 延迟升序', () => {
  it('5 个源（1080/720/720/480/未知）排序严格正确', () => {
    const urls = ['u-1080', 'u-720-fast', 'u-720-slow', 'u-480', 'u-unknown'].map((name) => `http://a.com/${name}.m3u8`);
    const results = [
      // 1080 的延迟最差，但分辨率最高，必须排第一
      probe(urls[0] as string, { width: 1920, height: 1080, latencyMs: 900, resolution: '1920x1080' }),
      probe(urls[1] as string, { width: 1280, height: 720, latencyMs: 100, resolution: '1280x720' }),
      probe(urls[2] as string, { width: 1280, height: 720, latencyMs: 300, resolution: '1280x720' }),
      probe(urls[3] as string, { width: 854, height: 480, latencyMs: 50, resolution: '854x480' }),
      probe(urls[4] as string, { latencyMs: 10 }),
    ];

    const ranked = rankChannels([channel(urls)], results);

    expect(ranked).toHaveLength(1);
    // 上限提到 5 后 5 个全保留；前 3 的顺序仍必须是 1080 → 720(快) → 720(慢)
    expect(ranked[0]?.streams.map((item) => item.url).slice(0, 3)).toEqual([urls[0], urls[1], urls[2]]);
  });

  it('同分辨率时延迟低者优先（延迟 50 < 200 < 800）', () => {
    const urls = ['y', 'x', 'z'].map((name) => `http://a.com/${name}.m3u8`);
    const results = [
      probe(urls[0] as string, { width: 1280, height: 720, latencyMs: 800 }),
      probe(urls[1] as string, { width: 1280, height: 720, latencyMs: 50 }),
      probe(urls[2] as string, { width: 1280, height: 720, latencyMs: 200 }),
    ];

    const ranked = rankChannels([channel(urls)], results);

    expect(ranked[0]?.streams.map((item) => item.url)).toEqual([urls[1], urls[2], urls[0]]);
  });

  it('分辨率未知但延迟极低的源，不能挤掉 1080(高延迟) 的源', () => {
    const low = 'http://a.com/low.m3u8';
    const hd = 'http://a.com/hd.m3u8';
    const ranked = rankChannels(
      [channel([low, hd])],
      [probe(low, { latencyMs: 1 }), probe(hd, { width: 1920, height: 1080, latencyMs: 5000 })],
    );

    expect(ranked[0]?.streams[0]?.url).toBe(hd);
  });
});

describe('rankChannels：存活数与数量上限', () => {
  it('0 个存活源的频道被整体剔除（不留死链行）', () => {
    const urls = ['http://a.com/1.m3u8', 'http://a.com/2.m3u8'];
    const ranked = rankChannels(
      [channel(urls)],
      [probe(urls[0] as string, { status: 'dead' }), probe(urls[1] as string, { status: 'timeout' })],
    );

    expect(ranked).toHaveLength(0);
    expect(countSources(ranked)).toBe(0);
  });

  it('只有 1 个存活时保留实际 1 个，不用死链凑到 3 个', () => {
    const urls = ['http://a.com/1.m3u8', 'http://a.com/2.m3u8', 'http://a.com/3.m3u8'];
    const ranked = rankChannels(
      [channel(urls)],
      [
        probe(urls[0] as string, { width: 1920, height: 1080 }),
        probe(urls[1] as string, { status: 'dead' }),
        probe(urls[2] as string, { status: 'dead' }),
      ],
    );

    expect(ranked[0]?.streams).toHaveLength(1);
    expect(ranked[0]?.streams[0]?.url).toBe(urls[0]);
  });

  it('存活 5 个时最多输出 5 个（SELECT.maxPerChannel）', () => {
    const urls = Array.from({ length: 8 }, (_unused, index) => `http://a.com/${index}.m3u8`);
    const ranked = rankChannels(
      [channel(urls)],
      urls.map((url, index) => probe(url, { width: 1280, height: 720, latencyMs: index * 10 })),
    );

    expect(ranked[0]?.streams).toHaveLength(SELECT.maxPerChannel);
    expect(SELECT.maxPerChannel).toBe(5);
  });

  it('重点频道放宽到 priorityMaxPerChannel（广东体育保留更多备用源）', () => {
    const urls = Array.from({ length: 12 }, (_unused, index) => `http://a.com/${index}.m3u8`);
    const ranked = rankChannels(
      [{ ...channel(urls), id: 'gd-sports' }],
      urls.map((url, index) => probe(url, { width: 1280, height: 720, latencyMs: index * 10 })),
    );

    expect(SELECT.priorityMaxPerChannel).toBe(10);
    expect(ranked[0]?.streams).toHaveLength(10);
  });

  it('没有探测结果（未测到）的源不算存活，不参与排序', () => {
    const urls = ['http://a.com/1.m3u8', 'http://a.com/2.m3u8'];
    const ranked = rankChannels([channel(urls)], [probe(urls[0] as string)]);

    expect(ranked[0]?.streams.map((item) => item.url)).toEqual([urls[0]]);
  });
});

describe('rankChannels：去重与排序稳定性', () => {
  it('频道内重复 URL 只输出一次', () => {
    const url = 'http://a.com/same.m3u8';
    const unit = channel([url, url]);
    const ranked = rankChannel(unit, new Map([[toUrlKey(url), probe(url)]]));

    expect(ranked?.streams).toHaveLength(1);
  });

  it('同一 urlKey 大小写 host 不同的重复源也只保留一次', () => {
    const upper = 'http://A.com/same.m3u8';
    const lower = 'http://a.com/same.m3u8';
    const ranked = rankChannel(channel([upper, lower]), new Map([[toUrlKey(upper), probe(upper)]]));

    expect(ranked?.streams).toHaveLength(1);
  });

  it('完全同分（同分辨率同延迟）时输出顺序稳定（按 urlKey 升序）', () => {
    const urls = ['http://a.com/b.m3u8', 'http://a.com/a.m3u8'];
    const results = urls.map((url) => probe(url, { width: 1280, height: 720, latencyMs: 100 }));

    const first = rankChannels([channel(urls)], results);
    const second = rankChannels([channel(urls)], results);

    expect(first[0]?.streams.map((item) => item.url)).toEqual(second[0]?.streams.map((item) => item.url));
    expect(first[0]?.streams.map((item) => item.url)).toEqual(['http://a.com/a.m3u8', 'http://a.com/b.m3u8']);
  });

  it('多频道时输出顺序仍是「分组权重 → slug」', () => {
    const channels: Channel[] = [
      { ...channel(['http://a.com/1.m3u8'], '湖南卫视', '卫视'), id: 'satellite-hunan' },
      { ...channel(['http://a.com/2.m3u8'], 'CCTV-1 综合', '央视'), id: 'cctv1' },
      { ...channel(['http://a.com/3.m3u8'], '翡翠台', '港澳台'), id: 'tvb-jade' },
    ];
    const results = ['http://a.com/1.m3u8', 'http://a.com/2.m3u8', 'http://a.com/3.m3u8'].map((url) => probe(url));

    const ranked = rankChannels(channels, results);

    expect(ranked.map((item) => item.id)).toEqual(['tvb-jade', 'cctv1', 'satellite-hunan']);
  });
});
