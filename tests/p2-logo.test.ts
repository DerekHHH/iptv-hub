/**
 * @file P2-1 回归：上游 tvg-logo 必须被提升为 channel.logo，并一路带到 M3U 与 EPG。
 */

import { describe, expect, it } from 'vitest';

import { renderEpg } from '../src/emit/epg';
import { renderM3u } from '../src/emit/m3u';
import { buildChannels, pickLogo } from '../src/normalize/channelName';
import { parseM3U } from '../src/parse/parseM3U';

/** 带 `&` 查询参数的台标（CDN 很常见，专门用来验证 XML 属性转义）。 */
const LOGO_URL = 'http://logo.local/cctv1.png?w=120&h=120';

/**
 * 造一段带 tvg-logo 的 m3u。
 *
 * @return m3u 文本
 */
function sampleM3u(): string {
  return [
    '#EXTM3U',
    `#EXTINF:-1 tvg-name="CCTV-1" tvg-logo="${LOGO_URL}" group-title="央视",CCTV-1 综合`,
    'http://a.local/live/cctv1.m3u8',
    '#EXTINF:-1 tvg-name="翡翠台" group-title="港澳台",翡翠台',
    'http://a.local/live/jade.m3u8',
    '',
  ].join('\n');
}

describe('pickLogo（规则表优先，上游兜底）', () => {
  it('规则表已给 logo 时不被上游覆盖', () => {
    expect(pickLogo('http://rule.local/x.png', 'http://stream.local/y.png')).toBe('http://rule.local/x.png');
  });

  it('规则表没给时用上游的', () => {
    expect(pickLogo(undefined, 'http://stream.local/y.png')).toBe('http://stream.local/y.png');
    expect(pickLogo('', 'http://stream.local/y.png')).toBe('http://stream.local/y.png');
  });

  it('两边都没有时返回 undefined（产物里应为空字符串而不是 "undefined"）', () => {
    expect(pickLogo(undefined, undefined)).toBeUndefined();
    expect(pickLogo('', '')).toBeUndefined();
  });
});

describe('tvg-logo 提升链路', () => {
  it('解析 → 归一：channel.logo 拿到上游台标', () => {
    const channels = buildChannels(parseM3U(sampleM3u(), 'fixture'));
    const cctv1 = channels.find((channel) => channel.id === 'cctv1');

    expect(cctv1).toBeDefined();
    expect(cctv1?.logo).toBe(LOGO_URL);
    // 没带 tvg-logo 的频道仍然没有 logo，不报错
    expect(channels.find((channel) => channel.id === 'tvb-jade')?.logo).toBeUndefined();
  });

  it('M3U 的 tvg-logo 属性非空', () => {
    const m3u = renderM3u(buildChannels(parseM3U(sampleM3u(), 'fixture')));

    expect(m3u).toContain(`tvg-logo="${LOGO_URL}"`);
    expect(m3u).not.toContain('tvg-logo="undefined"');
    // 没台标的频道依然输出空属性，不产生 undefined
    expect(m3u).toContain('tvg-id="tvb-jade" tvg-name="翡翠台" tvg-logo=""');
  });

  it('EPG 输出 <icon src>，且 & 被转义成 &amp;', () => {
    const channels = buildChannels(parseM3U(sampleM3u(), 'fixture'));
    const epg = renderEpg(channels, []).xml;

    expect(epg).toContain('<icon src="http://logo.local/cctv1.png?w=120&amp;h=120" />');
    // <icon> 必须是 <channel> 的子元素，且出现在 display-name 之后
    expect(epg).toMatch(/<display-name>CCTV-1 综合<\/display-name>\s*<icon src="[^"]+" \/>\s*<\/channel>/);
    // 没有台标的频道不应该凭空产生 <icon>
    expect((epg.match(/<icon /g) ?? []).length).toBe(1);
  });

  it('多个源时取第一个非空 logo（后面的不覆盖前面的）', () => {
    const text = [
      '#EXTM3U',
      '#EXTINF:-1 tvg-name="CCTV-2",CCTV-2 财经',
      'http://a.local/live/cctv2-a.m3u8',
      '#EXTINF:-1 tvg-name="CCTV-2" tvg-logo="http://logo.local/cctv2.png",CCTV-2 财经',
      'http://a.local/live/cctv2-b.m3u8',
      '#EXTINF:-1 tvg-name="CCTV-2" tvg-logo="http://logo.local/cctv2-other.png",CCTV-2 财经',
      'http://a.local/live/cctv2-c.m3u8',
      '',
    ].join('\n');

    const channels = buildChannels(parseM3U(text, 'fixture'));
    expect(channels.find((channel) => channel.id === 'cctv2')?.logo).toBe('http://logo.local/cctv2.png');
  });
});
