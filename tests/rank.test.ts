/**
 * @file L5 优选排序单测（离线）。
 */

import { describe, expect, it } from 'vitest';

import { compareProbeResult, countSources, rankChannel, rankChannels, indexResults } from '../src/select/rank';
import { makeChannel, makeResult } from './helpers';

describe('compareProbeResult', () => {
  it('分辨率降序优先于延迟', () => {
    const uhd = makeResult('http://a/uhd.m3u8', { width: 1920, height: 1080, latencyMs: 900 });
    const hd = makeResult('http://a/hd.m3u8', { width: 1280, height: 720, latencyMs: 20 });
    expect(compareProbeResult(uhd, hd)).toBeLessThan(0);
  });

  it('同分辨率时延迟升序', () => {
    const fast = makeResult('http://a/fast.m3u8', { width: 1280, height: 720, latencyMs: 30 });
    const slow = makeResult('http://a/slow.m3u8', { width: 1280, height: 720, latencyMs: 800 });
    expect(compareProbeResult(fast, slow)).toBeLessThan(0);
  });
});

describe('rankChannel', () => {
  it('每频道最多保留 SELECT.maxPerChannel 个源，且按分辨率降序 → 延迟升序', () => {
    const channel = makeChannel('cctv1', 'CCTV-1 综合', '央视', [
      'http://a/1.m3u8',
      'http://a/2.m3u8',
      'http://a/3.m3u8',
      'http://a/4.m3u8',
    ]);
    const results = [
      makeResult('http://a/1.m3u8', { width: 854, height: 480, latencyMs: 10 }),
      makeResult('http://a/2.m3u8', { width: 1920, height: 1080, latencyMs: 500 }),
      makeResult('http://a/3.m3u8', { width: 1280, height: 720, latencyMs: 100 }),
      makeResult('http://a/4.m3u8', { width: 1280, height: 720, latencyMs: 50 }),
    ];
    const ranked = rankChannel(channel, indexResults(results));
    expect(ranked).not.toBeNull();
    // 上限已从 3 提到 5，4 个存活源全部保留，且顺序仍严格正确
    expect(ranked?.streams.map((item) => item.url)).toEqual([
      'http://a/2.m3u8',
      'http://a/4.m3u8',
      'http://a/3.m3u8',
      'http://a/1.m3u8',
    ]);
  });

  it('存活源不足 3 个时保留实际数量，不拿死链凑数', () => {
    const channel = makeChannel('cctv2', 'CCTV-2 财经', '央视', ['http://a/1.m3u8', 'http://a/2.m3u8']);
    const results = [
      makeResult('http://a/1.m3u8', { status: 'alive', width: 1280, height: 720, latencyMs: 40 }),
      makeResult('http://a/2.m3u8', { status: 'dead', error: 'HTTP 404' }),
    ];
    const ranked = rankChannel(channel, indexResults(results));
    expect(ranked?.streams).toHaveLength(1);
    expect(ranked?.streams[0]?.url).toBe('http://a/1.m3u8');
  });

  it('0 个存活源的频道被整条剔除', () => {
    const channel = makeChannel('cctv3', 'CCTV-3 综艺', '央视', ['http://a/1.m3u8']);
    const ranked = rankChannel(channel, indexResults([makeResult('http://a/1.m3u8', { status: 'timeout' })]));
    expect(ranked).toBeNull();
  });

  it('按 urlKey 去重（同一地址不同写法只留一条）', () => {
    const channel = makeChannel('cctv4', 'CCTV-4 中文国际', '央视', [
      'http://a/1.m3u8',
      'http://a/1.m3u8',
      'http://A/1.m3u8',
    ]);
    const ranked = rankChannel(channel, indexResults([makeResult('http://a/1.m3u8', { width: 1280 })]));
    expect(ranked?.streams).toHaveLength(1);
  });
});

describe('rankChannels', () => {
  it('整体输出按分组顺序 + 频道 slug 升序', () => {
    const channels = [
      makeChannel('satellite-hunan', '湖南卫视', '卫视', ['http://a/hunan.m3u8']),
      makeChannel('cctv1', 'CCTV-1 综合', '央视', ['http://a/cctv1.m3u8']),
      makeChannel('tvb-jade', '翡翠台', '港澳台', ['http://a/jade.m3u8']),
      makeChannel('gd-zhujiang', '广东珠江', '广东', ['http://a/zj.m3u8']),
    ];
    const results = [
      makeResult('http://a/hunan.m3u8'),
      makeResult('http://a/cctv1.m3u8'),
      makeResult('http://a/jade.m3u8'),
      makeResult('http://a/zj.m3u8'),
    ];
    const ranked = rankChannels(channels, results);
    expect(ranked.map((channel) => channel.id)).toEqual(['tvb-jade', 'gd-zhujiang', 'cctv1', 'satellite-hunan']);
    expect(countSources(ranked)).toBe(4);
  });
});
