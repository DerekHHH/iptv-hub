/**
 * @file QA 独立补充测试 —— 频道归一与分组（对应验收任务 C2）。
 *
 * 重点验证两个高危点：
 *   1. CCTV5 与 CCTV5+ 绝不能合并（合并会让体育赛事频道顶掉体育频道）
 *   2. 港澳台 / 广东的常见别名必须落在同一 slug 上
 */

import { describe, expect, it } from 'vitest';

import { GROUP_ORDER, GROUP_WEIGHT } from '../../src/config';
import { buildChannels, identifyChannel, normalizeAliasKey } from '../../src/normalize/channelName';
import { makeStream } from '../../src/parse/common';

/** 取 slug 的小工具，识别失败直接让测试失败。 */
function slugOf(name: string): string {
  const identity = identifyChannel(name);
  expect(identity, `频道名「${name}」应能被识别`).not.toBeNull();
  return identity?.id ?? '';
}

describe('央视：同一频道多种写法必须收敛到同一 slug', () => {
  const ALL_CCTV1 = ['CCTV1', 'CCTV-1', 'CCTV 1', '中央1台', 'cctv-1 综合', '央视一套', '中央一台', 'CCTV-1 高清'];

  it.each(ALL_CCTV1)('「%s」归一到 cctv1', (name) => {
    expect(slugOf(name)).toBe('cctv1');
  });

  it('CCTV5+ 与 CCTV5 必须是两个不同频道（高危：不能合并）', () => {
    expect(slugOf('CCTV5')).toBe('cctv5');
    expect(slugOf('CCTV5+')).toBe('cctv5plus');
    expect(slugOf('CCTV-5+')).toBe('cctv5plus');
    expect(slugOf('CCTV5PLUS')).toBe('cctv5plus');
    expect(slugOf('CCTV5+ 体育赛事')).toBe('cctv5plus');
    expect(slugOf('CCTV5')).not.toBe(slugOf('CCTV5+'));
  });

  it('CCTV4K 与 CCTV4 必须是两个不同频道（高危：不能合并）', () => {
    expect(slugOf('CCTV-4K')).toBe('cctv4k');
    expect(slugOf('CCTV4')).toBe('cctv4');
    expect(slugOf('CCTV-4K')).not.toBe(slugOf('CCTV4'));
  });

  it('CCTV1 与 CCTV11 / CCTV17 不会因为前缀匹配而串台', () => {
    expect(slugOf('CCTV1')).toBe('cctv1');
    expect(slugOf('CCTV11')).toBe('cctv11');
    expect(slugOf('CCTV17')).toBe('cctv17');
  });

  it('归一化后的标准中文名唯一（同一 slug 只导出一个名字）', () => {
    const names = ['CCTV1', 'CCTV-1', '中央一台'].map((name) => identifyChannel(name)?.name);
    expect(new Set(names).size).toBe(1);
    expect(names[0]).toContain('CCTV-1');
  });

  it('央视频道全部落在「央视」分组', () => {
    for (const name of ['CCTV1', 'CCTV5+', 'CCTV-4K', 'CETV1']) {
      expect(identifyChannel(name)?.group).toBe('央视');
    }
  });
});

describe('港澳台与广东：别名与分组', () => {
  it('翡翠台 / 无线翡翠台 / TVB翡翠台 归一到同一 slug（港澳台）', () => {
    const slugs = ['翡翠台', '无线翡翠台', 'TVB翡翠台', '翡翠'].map(slugOf);
    expect(new Set(slugs).size).toBe(1);
    expect(identifyChannel('翡翠台')?.group).toBe('港澳台');
  });

  it('繁体写法「無綫翡翠台」至少必须落在港澳台分组（不会被丢进「其他」）', () => {
    const identity = identifyChannel('無綫翡翠台');

    expect(identity).not.toBeNull();
    expect(identity?.group).toBe('港澳台');
    // 记录现状：繁体「綫」目前不参与归一，会生成独立 slug（已知 P2 缺口，见报告）
    expect(typeof identity?.id).toBe('string');
  });

  it('广东珠江 / 珠江台 / 珠江频道 归一到同一 slug（广东）', () => {
    const slugs = ['广东珠江', '珠江台', '珠江频道'].map(slugOf);
    expect(new Set(slugs).size).toBe(1);
    expect(identifyChannel('广东珠江')?.group).toBe('广东');
  });

  it('深圳都市（广东）与 深圳卫视（卫视）不会被合并', () => {
    expect(slugOf('深圳都市')).not.toBe(slugOf('深圳卫视'));
    expect(identifyChannel('深圳都市')?.group).toBe('广东');
    expect(identifyChannel('深圳卫视')?.group).toBe('卫视');
  });

  it('未知频道兜底到「其他」，且两次识别得到同一个 slug（稳定）', () => {
    const first = identifyChannel('某个没见过的频道');
    const second = identifyChannel('某个没见过的频道');

    expect(first?.group).toBe('其他');
    expect(first?.id).toBe(second?.id);
    expect(first?.id).toMatch(/^ch-[0-9a-z]+$/);
  });

  it('空频道名 / 纯标点 → null（由调用方丢弃）', () => {
    expect(identifyChannel('')).toBeNull();
    expect(identifyChannel('   ')).toBeNull();
    expect(identifyChannel('---')).toBeNull();
  });
});

describe('normalizeAliasKey：比对键压缩规则', () => {
  it('去空格、去半角全角标点、大写化', () => {
    expect(normalizeAliasKey('cctv-1 综合')).toBe('CCTV1综合');
    expect(normalizeAliasKey('CCTV 1')).toBe('CCTV1');
    expect(normalizeAliasKey('凤凰卫视（中文台）')).toBe('凤凰卫视中文台');
  });

  it('剥离画质后缀（高清/超清/HD/50FPS）', () => {
    expect(normalizeAliasKey('翡翠台高清')).toBe('翡翠台');
    expect(normalizeAliasKey('CCTV1 HD')).toBe('CCTV1');
  });

  it('不会把频道本体剥空（全为后缀时保留原串）', () => {
    expect(normalizeAliasKey('高清').length).toBeGreaterThan(0);
  });
});

describe('buildChannels：聚合与去重', () => {
  it('同名多源聚合成一个频道，同 URL 去重，别名被记录', () => {
    const streams = [
      makeStream('http://a.com/1.m3u8', 'CCTV1', 'qa'),
      makeStream('http://a.com/2.m3u8', 'CCTV-1', 'qa'),
      makeStream('http://a.com/2.m3u8', 'CCTV-1', 'qa'),
    ];
    const channels = buildChannels(streams);

    expect(channels).toHaveLength(1);
    expect(channels[0]?.id).toBe('cctv1');
    expect(channels[0]?.streams.map((item) => item.url)).toEqual(['http://a.com/1.m3u8', 'http://a.com/2.m3u8']);
    expect(channels[0]?.aliases).toEqual(['CCTV1', 'CCTV-1']);
  });

  it('无名源（纯 URL）被整体丢弃', () => {
    const channels = buildChannels([makeStream('http://a.com/1.m3u8', '', 'qa')]);

    expect(channels).toHaveLength(0);
  });

  it('输出顺序 = 分组权重升序（港澳台最前），组内按 slug 升序', () => {
    const channels = buildChannels([
      makeStream('http://a.com/1.m3u8', '湖南卫视', 'qa'),
      makeStream('http://a.com/2.m3u8', 'CCTV1', 'qa'),
      makeStream('http://a.com/3.m3u8', '翡翠台', 'qa'),
      makeStream('http://a.com/4.m3u8', '广州综合', 'qa'),
    ]);

    expect(channels.map((item) => item.group)).toEqual(['港澳台', '广东', '央视', '卫视']);
    expect(channels[0]?.id).toBe('tvb-jade');
    expect(channels[3]?.id).toBe('satellite-hunan');
  });

  it('用户自填源（userAdded）排在同频道候选源最前', () => {
    const auto = makeStream('http://auto.com/1.m3u8', '翡翠台', 'iptv-org-hk');
    const custom = makeStream('http://custom.com/1.m3u8', '翡翠台', 'custom', { userAdded: true });
    const channels = buildChannels([auto, custom]);

    expect(channels[0]?.streams[0]?.url).toBe('http://custom.com/1.m3u8');
  });
});

describe('分组常量与设计约定一致', () => {
  it('GROUP_ORDER 固定为 港澳台→广东→央视→卫视→其他，权重 0~4', () => {
    expect(GROUP_ORDER).toEqual(['港澳台', '广东', '央视', '卫视', '其他']);
    expect(GROUP_ORDER.map((group) => GROUP_WEIGHT[group])).toEqual([0, 1, 2, 3, 4]);
  });
});
