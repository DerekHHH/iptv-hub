/**
 * @file P2-2 回归：繁体写法必须与简体归一到同一个 slug（否则同一个台会重复出现）。
 *
 * 红线（不能改坏）：CCTV5 与 CCTV5+、CCTV4 与 CCTV4K 仍然是不同的台。
 */

import { describe, expect, it } from 'vitest';

import { buildChannels, identifyChannel } from '../src/normalize/channelName';
import { makeStream } from '../src/parse/common';
import { toSimplified } from '../src/normalize/traditional';

/**
 * 取 slug（断言前必须先确认非 null）。
 *
 * @param name 频道名
 * @return slug
 */
function slugOf(name: string): string {
  const identity = identifyChannel(name);
  expect(identity).not.toBeNull();
  return identity?.id ?? '';
}

describe('繁体 → 简体归一', () => {
  it('無綫翡翠台 / 無線翡翠台 / 翡翠台 → 同一个 tvb-jade', () => {
    expect(slugOf('無綫翡翠台')).toBe('tvb-jade');
    expect(slugOf('無線翡翠台')).toBe('tvb-jade');
    expect(slugOf('翡翠台')).toBe('tvb-jade');
    expect(new Set([slugOf('無綫翡翠台'), slugOf('無線翡翠台'), slugOf('翡翠台')]).size).toBe(1);
  });

  it('澳視澳門 与 澳视澳门 → 同一个 slug', () => {
    expect(slugOf('澳視澳門')).toBe(slugOf('澳视澳门'));
    // 增量改造：slug 由 tcl-macau 统一为 tdm-oumun（与上游 TDM 命名对齐），语义断言不变
    expect(slugOf('澳視澳門')).toBe('tdm-oumun');
  });

  it('無綫新聞台 / 互動新聞台 → tvb-news', () => {
    expect(slugOf('無綫新聞台')).toBe('tvb-news');
    expect(slugOf('互動新聞台')).toBe('tvb-news');
  });

  it('鳳凰衛視（繁体）与 凤凰卫视 同一个 slug', () => {
    expect(slugOf('鳳凰衛視')).toBe(slugOf('凤凰卫视'));
    expect(slugOf('鳳凰衛視')).toBe('phoenix-chinese');
  });

  it('HOY TV 与 澳視葡文 有独立 slug，不落到哈希兜底', () => {
    expect(slugOf('HOY TV')).toBe('hoy-tv');
    // 增量改造：slug 由 tdm-portuguese 统一为 tdm-pm（与 TDM 命名对齐），语义断言不变
    expect(slugOf('澳視葡文')).toBe('tdm-pm');
    expect(slugOf('澳視葡文')).not.toBe(slugOf('澳視澳門'));
  });

  it('繁体写法不会把两个不同的台压成一个（一对一映射）', () => {
    expect(slugOf('無綫新聞台')).not.toBe(slugOf('無綫翡翠台'));
    expect(slugOf('明珠台')).not.toBe(slugOf('翡翠台'));
  });
});

describe('繁简只在匹配键上用，展示名不转换', () => {
  it('命中规则的频道用规则表里的规范中文名', () => {
    expect(identifyChannel('無綫翡翠台')?.name).toBe('翡翠台');
  });

  it('未命中的频道，展示名保留上游原名（不被转成简体）', () => {
    const identity = identifyChannel('無名測試台');
    expect(identity).not.toBeNull();
    expect(identity?.name).toBe('無名測試台');
    // 但匹配键已简体化 → 简体写法必须落到同一个 slug
    expect(identity?.id).toBe(slugOf('无名测试台'));
  });

  it('toSimplified 是一对一替换，长度不变', () => {
    expect(toSimplified('無綫翡翠臺')).toBe('无线翡翠台');
    expect(toSimplified('無綫翡翠臺').length).toBe('無綫翡翠臺'.length);
    expect(toSimplified('CCTV-1')).toBe('CCTV-1');
  });

  it('繁体/简体写法在 buildChannels 里合并成一个频道，不重复出现在列表', () => {
    const streams = [
      makeStream('http://a.local/jade-cn.m3u8', '翡翠台', 'u1'),
      makeStream('http://a.local/jade-tc.m3u8', '無綫翡翠台', 'u2'),
      makeStream('http://a.local/jade-mix.m3u8', '無線翡翠台', 'u3'),
    ];
    const channels = buildChannels(streams);
    const jadeChannels = channels.filter((channel) => channel.id === 'tvb-jade');

    expect(jadeChannels).toHaveLength(1);
    expect(jadeChannels[0]?.streams).toHaveLength(3);
    expect(channels).toHaveLength(1);
  });
});

describe('回归红线：编号相近的台仍然分开', () => {
  it('CCTV5 与 CCTV5+ 不合并', () => {
    expect(slugOf('CCTV5')).toBe('cctv5');
    expect(slugOf('CCTV5+')).toBe('cctv5plus');
    expect(slugOf('CCTV5')).not.toBe(slugOf('CCTV5+'));
  });

  it('CCTV4 与 CCTV4K 不合并', () => {
    expect(slugOf('CCTV4')).toBe('cctv4');
    expect(slugOf('CCTV4K')).toBe('cctv4k');
    expect(slugOf('CCTV4')).not.toBe(slugOf('CCTV4K'));
  });
});
