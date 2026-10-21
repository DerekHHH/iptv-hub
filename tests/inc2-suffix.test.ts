/**
 * @file 增量回归（需求 1）：上游「元信息括号 / 裸画质后缀」不得破坏归一。
 *
 * 根因：`翡翠台 (1080p)` 去标点后变成 `翡翠台1080P`，旧 `QUALITY_SUFFIX_PATTERN`
 * 不认 `1080P`，规则表 `翡翠台` 匹配失败 → 落到哈希 slug，同一台被拆成多条、
 * 分类只能靠关键词兜底。
 */

import { describe, expect, it } from 'vitest';

import { renderM3u } from '../src/emit/m3u';
import { renderTxt } from '../src/emit/txt';
import { buildChannels, identifyChannel, normalizeAliasKey, stripMetaSegments } from '../src/normalize/channelName';
import { makeStream } from '../src/parse/common';

describe('画质 / 状态标记剥离（需求 1）', () => {
  it('翡翠台 的四种写法归一到同一个 tvb-jade', () => {
    const names = ['翡翠台 (1080p)', '翡翠台(1080P)', '翡翠台[Geo-blocked]', '翡翠台'];
    const ids = names.map((name) => identifyChannel(name)?.id);
    expect(new Set(ids)).toEqual(new Set(['tvb-jade']));
  });

  it('iptv-org 香港源的真实写法 Jade (1080p) → tvb-jade', () => {
    expect(identifyChannel('Jade (1080p)')?.id).toBe('tvb-jade');
    expect(identifyChannel('Jade')?.id).toBe('tvb-jade');
    expect(identifyChannel('TVB Jade')?.id).toBe('tvb-jade');
  });

  it('RTHK TV 31 (港台電視31) (1080p) [Geo-blocked] → rthk-31', () => {
    expect(identifyChannel('RTHK TV 31 (港台電視31) (1080p) [Geo-blocked]')?.id).toBe('rthk-31');
    expect(identifyChannel('RTHK TV 32 (港台電視32) (720p) [Not 24/7]')?.id).toBe('rthk-32');
    expect(identifyChannel('RTHK TV 36 (港台電視36) (576i)')?.id).toBe('rthk-36');
  });

  it('裸画质后缀 1080P / 720P / 576I / 1080P50 都会被剥掉', () => {
    expect(normalizeAliasKey('翡翠台1080P')).toBe('翡翠台');
    expect(normalizeAliasKey('翡翠台720P')).toBe('翡翠台');
    expect(normalizeAliasKey('翡翠台576I')).toBe('翡翠台');
    expect(normalizeAliasKey('翡翠台1080P50')).toBe('翡翠台');
  });

  it('括号内有实际含义时不能被剥掉（否则丢信息）', () => {
    // `(体育赛事)` 不是纯元信息 → 保留 → 仍靠 CCTV5+ 正则命中
    expect(identifyChannel('CCTV-5+ (体育赛事)')?.id).toBe('cctv5plus');
    // `(中文台)` 不是纯元信息 → 保留 → 命中凤凰中文台
    expect(identifyChannel('凤凰卫视(中文台)')?.id).toBe('phoenix-chinese');
    expect(stripMetaSegments('凤凰卫视(中文台)')).toBe('凤凰卫视(中文台)');
    expect(identifyChannel('凤凰卫视 (1080p)')?.id).toBe('phoenix-chinese');
  });

  it('纯元信息括号才会被整段删除', () => {
    expect(stripMetaSegments('翡翠台 (1080p)')).toBe('翡翠台');
    expect(stripMetaSegments('翡翠台（720P）')).toBe('翡翠台');
    expect(stripMetaSegments('翡翠台[576i]')).toBe('翡翠台');
    expect(stripMetaSegments('翡翠台[无插件]')).toBe('翡翠台');
    expect(stripMetaSegments('翡翠台 (4K)')).toBe('翡翠台');
    expect(stripMetaSegments('翡翠台 (H.265)')).toBe('翡翠台');
    expect(stripMetaSegments('CCTV-5+ (体育赛事)')).toBe('CCTV-5+ (体育赛事)');
  });

  it('展示名不带噪声（不会出现「翡翠台 (1080p)」）', () => {
    // 未命中规则的频道才用上游原名做展示名，这里用未知台验证清洗逻辑
    expect(identifyChannel('某某地方台 (1080p)')?.name).toBe('某某地方台');
    expect(identifyChannel('某某地方台[Geo-blocked]')?.name).toBe('某某地方台');
    // 命中规则的用规则表规范名，本身就不带噪声
    expect(identifyChannel('翡翠台 (1080p)')?.name).toBe('翡翠台');
  });

  it('同一台的不同画质写法在 buildChannels 里合并成一个频道', () => {
    const streams = [
      makeStream('http://a.local/1.m3u8', '翡翠台 (1080p)', 'u1'),
      makeStream('http://a.local/2.m3u8', '翡翠台(720P)', 'u2'),
      makeStream('http://a.local/3.m3u8', 'Jade (1080p)', 'u3'),
    ];
    const channels = buildChannels(streams);
    const jade = channels.filter((channel) => channel.id === 'tvb-jade');
    expect(jade).toHaveLength(1);
    expect(jade[0]?.streams).toHaveLength(3);
  });
});

describe('回归红线（不能被本次改动带坏）', () => {
  it('CCTV5 与 CCTV5+ 仍是两个台', () => {
    expect(identifyChannel('CCTV5')?.id).toBe('cctv5');
    expect(identifyChannel('CCTV5+')?.id).toBe('cctv5plus');
    expect(identifyChannel('CCTV5')?.id).not.toBe(identifyChannel('CCTV5+')?.id);
  });

  it('CCTV4 与 CCTV4K 仍是两个台', () => {
    expect(identifyChannel('CCTV4')?.id).toBe('cctv4');
    expect(identifyChannel('CCTV4K')?.id).toBe('cctv4k');
    expect(identifyChannel('CCTV4')?.id).not.toBe(identifyChannel('CCTV4K')?.id);
  });

  it('产物 UTF-8 无 BOM、只用 LF', () => {
    const channels = buildChannels([
      makeStream('http://a.local/jade.m3u8', '翡翠台 (1080p)', 'u'),
      makeStream('http://a.local/cctv1.m3u8', 'CCTV1', 'u'),
      makeStream('http://a.local/foshan.m3u8', '佛山综合', 'u'),
    ]);
    for (const text of [renderTxt(channels), renderM3u(channels)]) {
      expect(text.startsWith('\uFEFF')).toBe(false);
      expect(text.includes('\uFEFF')).toBe(false);
      expect(text.includes('\r')).toBe(false);
      expect(text.endsWith('\n')).toBe(true);
    }
  });
});
