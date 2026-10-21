/**
 * @file P2-4 回归：候选截断必须让 custom/sources.txt 的自填源优先（永不被砍）。
 */

import { describe, expect, it } from 'vitest';

import { selectCandidates } from '../src/main';
import { makeChannel } from './helpers';

/**
 * 造一批自动抓取源。
 *
 * @param host 域名标识
 * @param count 数量
 * @return 地址列表
 */
function autoUrls(host: string, count: number): string[] {
  return Array.from({ length: count }, (_unused, index) => `http://${host}.local/live/${index}.m3u8`);
}

describe('selectCandidates 的 userAdded 优先级', () => {
  it('4000 个自动源 + 5 个「其他」组的自填源 → 5 个自填源全部保留', () => {
    const customUrls = Array.from({ length: 5 }, (_unused, index) => `http://custom.local/my-${index}.m3u8`);

    const otherChannel = makeChannel('ch-custom', '自填频道', '其他', customUrls);
    for (const stream of otherChannel.streams) {
      stream.userAdded = true;
    }
    const cctvChannel = makeChannel('cctv1', 'CCTV-1 综合', '央视', autoUrls('auto', 4000));

    const targets = selectCandidates([otherChannel, cctvChannel], 3000);
    const keptCustom = targets.filter((target) => target.url.includes('custom.local'));

    expect(targets).toHaveLength(3000);
    expect(keptCustom).toHaveLength(5);
    // 自填源必须排在最前面（先测活，预算不够也不会漏掉）
    expect(targets.slice(0, 5).map((target) => target.url)).toEqual(customUrls);
  });

  it('自填源优先于分组权重：港澳台的自动源也要排在其后', () => {
    const customChannel = makeChannel('ch-x', '自填台', '其他', ['http://custom.local/x.m3u8']);
    for (const stream of customChannel.streams) {
      stream.userAdded = true;
    }
    const hmtChannel = makeChannel('tvb-jade', '翡翠台', '港澳台', ['http://auto.local/jade.m3u8']);

    const targets = selectCandidates([hmtChannel, customChannel], 10);
    expect(targets[0]?.url).toBe('http://custom.local/x.m3u8');
    expect(targets[1]?.url).toBe('http://auto.local/jade.m3u8');
  });

  it('没有自填源时仍按分组权重排序（不破坏原行为）', () => {
    const channels = [
      makeChannel('satellite-hunan', '湖南卫视', '卫视', ['http://a.local/hunan.m3u8']),
      makeChannel('cctv1', 'CCTV-1 综合', '央视', ['http://a.local/cctv1.m3u8']),
      makeChannel('tvb-jade', '翡翠台', '港澳台', ['http://a.local/jade.m3u8']),
      makeChannel('gd-zhujiang', '广东珠江', '广东', ['http://a.local/zj.m3u8']),
    ];
    const targets = selectCandidates(channels, 100);

    expect(targets.map((target) => target.url)).toEqual([
      'http://a.local/jade.m3u8',
      'http://a.local/zj.m3u8',
      'http://a.local/cctv1.m3u8',
      'http://a.local/hunan.m3u8',
    ]);
  });

  it('仍然按 urlKey 全局去重', () => {
    const channelA = makeChannel('cctv1', 'CCTV-1 综合', '央视', ['http://a.local/dup.m3u8']);
    const channelB = makeChannel('cctv2', 'CCTV-2 财经', '央视', ['http://A.local/dup.m3u8', 'http://a.local/b.m3u8']);

    const targets = selectCandidates([channelA, channelB], 100);
    expect(targets).toHaveLength(2);
  });
});
