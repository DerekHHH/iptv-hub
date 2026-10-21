/**
 * @file L3 归一 + 分组单测（离线）。
 */

import { describe, expect, it } from 'vitest';

import { MIN_RULE_COUNT } from '../src/data/channel-rules';
import { GROUP_ORDER } from '../src/data/groups';
import { buildChannels, identifyChannel, normalizeAliasKey, RULE_COUNT } from '../src/normalize/channelName';
import { inferGroup } from '../src/normalize/group';
import { makeStream } from '../src/parse/common';

describe('CCTV 归一', () => {
  it('CCTV1 / CCTV-1 / 中央1台 / 央视一套 归一到同一个 slug', () => {
    const ids = ['CCTV1', 'CCTV-1', '中央1台', '央视一套', 'CCTV1高清', '中央一台'].map(
      (name) => identifyChannel(name)?.id,
    );
    expect(new Set(ids)).toEqual(new Set(['cctv1']));
  });

  it('CCTV5+ 与 CCTV-5 不是同一个频道', () => {
    expect(identifyChannel('CCTV5+')?.id).toBe('cctv5plus');
    expect(identifyChannel('CCTV-5')?.id).toBe('cctv5');
    expect(identifyChannel('CCTV-5+ 体育赛事')?.id).toBe('cctv5plus');
  });

  it('CCTV-17 / CCTV4K 有正确 slug 与分组', () => {
    expect(identifyChannel('CCTV-17')?.id).toBe('cctv17');
    expect(identifyChannel('CCTV4K')?.id).toBe('cctv4k');
    expect(identifyChannel('CCTV-13')?.group).toBe('央视');
  });

  it('超出编号范围不会误命中', () => {
    expect(identifyChannel('CCTV99')?.id).not.toBe('cctv99');
  });
});

describe('港澳台 / 广东 识别', () => {
  it('翡翠台 / TVB翡翠 都是港澳台', () => {
    expect(identifyChannel('翡翠台')?.group).toBe('港澳台');
    expect(identifyChannel('TVB翡翠')?.group).toBe('港澳台');
    expect(identifyChannel('翡翠台')?.id).toBe('tvb-jade');
    expect(identifyChannel('TVB翡翠')?.id).toBe('tvb-jade');
  });

  it('广东珠江 / 珠江频道 都是广东同一个 slug', () => {
    expect(identifyChannel('广东珠江')?.group).toBe('广东');
    expect(identifyChannel('珠江频道')?.group).toBe('广东');
    expect(identifyChannel('广东珠江')?.id).toBe(identifyChannel('珠江频道')?.id);
    expect(identifyChannel('广东珠江')?.id).toBe('gd-zhujiang');
  });

  it('凤凰卫视 / 台视 / 东森新闻 归港澳台', () => {
    expect(identifyChannel('凤凰卫视')?.group).toBe('港澳台');
    expect(identifyChannel('台视')?.group).toBe('港澳台');
    expect(identifyChannel('东森新闻')?.group).toBe('港澳台');
  });

  it('广东卫视属于卫视组而不是广东组', () => {
    expect(identifyChannel('广东卫视')?.group).toBe('卫视');
    expect(identifyChannel('深圳卫视')?.group).toBe('卫视');
  });
});

describe('未知名兜底', () => {
  it('未知频道归「其他」且 slug 是 ASCII', () => {
    const identity = identifyChannel('某个不存在的地方台');
    expect(identity).not.toBeNull();
    expect(identity?.group).toBe('其他');
    expect(identity?.id).toMatch(/^ch-[a-z0-9]+$/);
  });

  it('同一个未知写法稳定映射到同一个 slug', () => {
    const a = identifyChannel('未知测试台');
    const b = identifyChannel('未知测试台');
    expect(a?.id).toBe(b?.id);
  });

  it('空名返回 null（约定 §8-4）', () => {
    expect(identifyChannel('')).toBeNull();
    expect(identifyChannel('   ')).toBeNull();
  });

  it('关键词推断分组', () => {
    expect(inferGroup('某某香港台')).toBe('港澳台');
    expect(inferGroup('珠海综合')).toBe('广东');
    expect(inferGroup('某某卫视')).toBe('卫视');
    expect(inferGroup('纯粹随便')).toBe('其他');
  });
});

describe('归一工具', () => {
  it('normalizeAliasKey 去空格、标点、画质后缀', () => {
    expect(normalizeAliasKey('CCTV-1 高清')).toBe('CCTV1');
    expect(normalizeAliasKey('cctv 5＋')).toBe('CCTV5+');
    expect(normalizeAliasKey('湖南卫视 HD')).toBe('湖南卫视');
  });

  it('规则表规模不低于设计下限', () => {
    expect(RULE_COUNT).toBeGreaterThanOrEqual(MIN_RULE_COUNT);
  });
});

describe('buildChannels', () => {
  it('同频道多写法合并，按 urlKey 去重，aliases 记录原写法', () => {
    const streams = [
      makeStream('http://example.com/a.m3u8', 'CCTV1', 'u1'),
      makeStream('http://example.com/a.m3u8', 'CCTV-1', 'u2'),
      makeStream('http://example.com/b.m3u8', '中央1台', 'u3'),
      makeStream('http://example.com/c.m3u8', '翡翠台', 'u4'),
      makeStream('http://example.com/d.m3u8', '', 'u5'),
    ];
    const channels = buildChannels(streams);

    const cctv1 = channels.find((channel) => channel.id === 'cctv1');
    expect(cctv1).toBeDefined();
    expect(cctv1?.streams).toHaveLength(2);
    expect(cctv1?.aliases).toEqual(expect.arrayContaining(['CCTV1', 'CCTV-1', '中央1台']));
    // 无频道名的源被丢弃
    expect(channels.some((channel) => channel.streams.some((item) => item.url.includes('/d.m3u8')))).toBe(false);
  });

  it('输出按分组权重排序（港澳台在最前）', () => {
    const streams = [
      makeStream('http://example.com/cctv1.m3u8', 'CCTV1', 'u'),
      makeStream('http://example.com/jade.m3u8', '翡翠台', 'u'),
      makeStream('http://example.com/hunan.m3u8', '湖南卫视', 'u'),
    ];
    const channels = buildChannels(streams);
    expect(channels[0]?.group).toBe('港澳台');
    expect(channels[1]?.group).toBe('央视');
    expect(channels[2]?.group).toBe('卫视');
    expect(GROUP_ORDER).toEqual(['港澳台', '广东', '央视', '卫视', '其他']);
  });

  it('用户自填源排在同频道最前面', () => {
    const auto = makeStream('http://example.com/auto.m3u8', 'CCTV1', 'iptv-org');
    const custom = makeStream('http://example.com/custom.m3u8', 'CCTV1', 'custom', { userAdded: true });
    const channels = buildChannels([auto, custom]);
    expect(channels[0]?.streams[0]?.url).toBe('http://example.com/custom.m3u8');
  });
});
