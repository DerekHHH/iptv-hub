/**
 * @file 增量回归（需求 4）：用上游 group-title 辅助分类。
 *
 * 分类优先级（`normalize/group.ts` 的 `resolveGroup`）：
 *   ① 规则表显式 group → ② 上游 group-title 提示 → ③ 名称关键词 → ④ 其他
 *
 * 关键约束：规则表命中的频道**不得**被上游提示覆盖（香港源里转发 CCTV-1 会被标成
 * "香港"，此时必须仍归央视）。
 */

import { describe, expect, it } from 'vitest';

import { GROUP_HINT_RULES, hintGroupFromTitle, stripGroupDecorations } from '../src/data/channel-rules';
import { buildChannels, identifyChannel } from '../src/normalize/channelName';
import { resolveGroup } from '../src/normalize/group';
import { parseM3U } from '../src/parse/parseM3U';
import { parseTxt } from '../src/parse/parseTxt';

/**
 * 构造一份单条目的 M3U（带 group-title）。
 *
 * @param groupTitle 上游分组名
 * @param name 频道名
 * @return M3U 文本
 */
function m3uWithGroup(groupTitle: string, name: string): string {
  return [
    '#EXTM3U',
    `#EXTINF:-1 tvg-name="${name}" group-title="${groupTitle}",${name}`,
    'http://example.com/stream.m3u8',
    '',
  ].join('\n');
}

describe('hintGroupFromTitle：emoji 前缀必须先剥掉', () => {
  it('去装饰符只保留字母/数字/汉字', () => {
    expect(stripGroupDecorations('☘️广东频道')).toBe('广东频道');
    expect(stripGroupDecorations('📺央视 | CCTV')).toBe('央视CCTV');
    expect(stripGroupDecorations('🇭🇰 港澳台')).toBe('港澳台');
  });

  it.each([
    ['港澳台频道', '港澳台'],
    ['☘️香港频道', '港澳台'],
    ['台灣頻道', '港澳台'],
    ['☘️广东频道', '广东'],
    ['廣東頻道', '广东'],
    ['☘️佛山', '广东'],
    ['☘️央视频道', '央视'],
    ['CCTV', '央视'],
    ['☘️衛視頻道', '卫视'],
  ])('%s → %s', (title, expected) => {
    expect(hintGroupFromTitle(title)).toBe(expected);
  });

  it('识别不出的分组返回 undefined（落回关键词推断）', () => {
    expect(hintGroupFromTitle('☘️浙江频道')).toBeUndefined();
    expect(hintGroupFromTitle('☘️湖南频道')).toBeUndefined();
    expect(hintGroupFromTitle('')).toBeUndefined();
    expect(hintGroupFromTitle(undefined)).toBeUndefined();
  });

  it('规则顺序即优先级（港澳台 → 广东 → 央视 → 卫视）', () => {
    expect(GROUP_HINT_RULES.map((rule) => rule.group)).toEqual(['港澳台', '广东', '央视', '卫视']);
  });
});

describe('resolveGroup：四层优先级', () => {
  it('① 规则表命中时压过上游提示', () => {
    expect(resolveGroup({ ruleMatched: true, nameGroup: '央视', upstreamGroup: '☘️香港频道' })).toBe('央视');
    expect(resolveGroup({ ruleMatched: true, nameGroup: '广东', upstreamGroup: '☘️浙江频道' })).toBe('广东');
  });

  it('② 规则表未命中时用上游提示', () => {
    expect(resolveGroup({ ruleMatched: false, nameGroup: '其他', upstreamGroup: '☘️广东频道' })).toBe('广东');
  });

  it('③ 提示识别不出时落回名称关键词推断', () => {
    expect(resolveGroup({ ruleMatched: false, nameGroup: '卫视', upstreamGroup: '☘️浙江频道' })).toBe('卫视');
  });

  it('④ 都没有时保持「其他」', () => {
    expect(resolveGroup({ ruleMatched: false, nameGroup: '其他' })).toBe('其他');
  });
});

describe('M3U group-title 透传 + 分类', () => {
  it('group-title="☘️广东频道" + 佛山综合 → 广东', () => {
    const streams = parseM3U(m3uWithGroup('☘️广东频道', '佛山综合'), 'guovin-iptv-api');
    expect(streams[0]?.upstreamGroup).toBe('☘️广东频道');
    const channels = buildChannels(streams);
    expect(channels[0]?.group).toBe('广东');
  });

  it('未知频道靠上游提示归到广东（关键词推断给不出这个结论）', () => {
    const withHint = buildChannels(parseM3U(m3uWithGroup('☘️广东频道', '顺德频道'), 'guovin-iptv-api'));
    const withoutHint = buildChannels([...parseM3U(m3uWithGroup('', '顺德频道'), 'guovin-iptv-api')]);
    expect(identifyChannel('顺德频道')?.group).toBe('其他');
    expect(withHint[0]?.group).toBe('广东');
    expect(withoutHint[0]?.group).toBe('其他');
  });

  it('group-title="☘️浙江频道" + 浙江卫视 → 卫视（提示无结论，落回关键词）', () => {
    const channels = buildChannels(parseM3U(m3uWithGroup('☘️浙江频道', '浙江卫视'), 'guovin-iptv-api'));
    expect(channels[0]?.id).toBe('satellite-zhejiang');
    expect(channels[0]?.group).toBe('卫视');
  });

  it('规则表命中的频道不被上游提示覆盖', () => {
    const overridden = buildChannels([
      ...parseM3U(m3uWithGroup('☘️浙江频道', '大湾区卫视'), 'guovin-iptv-api'),
      ...parseM3U(m3uWithGroup('☘️广东频道', 'CCTV-1 综合'), 'guovin-iptv-api'),
      ...parseM3U(m3uWithGroup('☘️广东频道', '翡翠台'), 'guovin-iptv-api'),
    ]);
    const bay = overridden.find((channel) => channel.id === 'gd-bayarea');
    const cctv1 = overridden.find((channel) => channel.id === 'cctv1');
    const jade = overridden.find((channel) => channel.id === 'tvb-jade');
    expect(bay?.group).toBe('广东');
    expect(cctv1?.group).toBe('央视');
    expect(jade?.group).toBe('港澳台');
  });
});

describe('TXT #genre# 分组头同样透传', () => {
  it('分组头写进 Stream.upstreamGroup，并参与分类', () => {
    const text = ['广东,#genre#', '顺德频道,http://example.com/sd.m3u8', '', '央视,#genre#', 'CCTV1,http://example.com/cctv1.m3u8', ''].join(
      '\n',
    );
    const streams = parseTxt(text, 'txt-upstream');
    expect(streams.map((stream) => stream.upstreamGroup)).toEqual(['广东', '央视']);

    const channels = buildChannels(streams);
    expect(channels.find((channel) => channel.id === identifyChannel('顺德频道')?.id)?.group).toBe('广东');
    expect(channels.find((channel) => channel.id === 'cctv1')?.group).toBe('央视');
  });

  it('没有分组头时 upstreamGroup 不存在（保持既有行为）', () => {
    const streams = parseTxt('CCTV1,http://example.com/a.m3u8', 'txt-upstream');
    expect(streams[0]?.upstreamGroup).toBeUndefined();
  });
});
