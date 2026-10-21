/**
 * @file 第 2 轮回归验证：针对第 1 轮 5 条 P2 修复的定点复验（QA 独立编写）。
 *
 * 覆盖：
 *   R1 台标（上游 tvg-logo 提升 / 规则表优先 / EPG icon 位置 / XML 转义）
 *   R2 繁体归一（同台收敛 / 展示名不被篡改 / 央视高危项不串台 / 映射表多义字不误伤）
 *   R4 自填源截断优先级（userAdded 最前、去重、死链仍剔除）
 *
 * R3（降级写历史）与 R5（React key）在独立脚本 `tests/qa/p2-regress-history.ts` 与源码检查里覆盖。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { emitEpg, renderEpg } from '../../src/emit/epg';
import { renderExtInf, renderM3u } from '../../src/emit/m3u';
import { buildChannels, identifyChannel, pickLogo } from '../../src/normalize/channelName';
import { toSimplified } from '../../src/normalize/traditional';
import { makeStream } from '../../src/parse/common';
import { parseM3U } from '../../src/parse/parseM3U';
import { rankChannels } from '../../src/select/rank';
import { selectCandidates } from '../../src/main';
import type { Channel, ProbeResult, Stream } from '../../src/types';
import { toUrlKey } from '../../src/util/slug';

/**
 * 造一个频道（源可带 userAdded / logo 标记）。
 *
 * @param id slug
 * @param group 分组
 * @param urls 地址
 * @param userAdded 是否用户自填
 * @return Channel
 */
function channelOf(id: string, group: Channel['group'], urls: readonly string[], userAdded = false): Channel {
  const streams: Stream[] = urls.map((url) => makeStream(url, id, userAdded ? 'custom' : 'qa', { userAdded }));
  for (const stream of streams) {
    stream.channelId = id;
    stream.group = group;
  }
  return { id, name: id, aliases: [], group, streams };
}

/**
 * 造一条探测结果。
 *
 * @param url 地址
 * @param alive 是否存活
 * @return ProbeResult
 */
function probe(url: string, alive: boolean): ProbeResult {
  return {
    urlKey: toUrlKey(url),
    status: alive ? 'alive' : 'dead',
    alive,
    checkedAt: '2025-01-01T12:00:00+08:00',
  };
}

describe('R1 台标链路', () => {
  it('上游 tvg-logo 会被提升到 channel.logo（不再恒为空）', () => {
    const streams = parseM3U(
      '#EXTM3U\n#EXTINF:-1 tvg-name="翡翠台" tvg-logo="https://logo/tvb.png" group-title="港澳台",翡翠台\nhttp://a.com/jade.m3u8\n',
      'qa',
    );
    const channels = buildChannels(streams);

    expect(channels[0]?.logo).toBe('https://logo/tvb.png');
    expect(renderM3u(channels).split('\n')[1]).toContain('tvg-logo="https://logo/tvb.png"');
  });

  it('规则表显式给的台标优先于上游 tvg-logo（不被覆盖）', () => {
    expect(pickLogo('https://rule/logo.png', 'https://upstream/logo.png')).toBe('https://rule/logo.png');
    expect(pickLogo(undefined, 'https://upstream/logo.png')).toBe('https://upstream/logo.png');
    expect(pickLogo('https://rule/logo.png', undefined)).toBe('https://rule/logo.png');
    expect(pickLogo(undefined, undefined)).toBeUndefined();
    expect(pickLogo('', '')).toBeUndefined();
  });

  it('同频道多个源只有部分带台标时，取第一个非空台标', () => {
    const withLogo = parseM3U(
      '#EXTM3U\n#EXTINF:-1 tvg-name="翡翠台",翡翠台\nhttp://a.com/no-logo.m3u8\n',
      'qa',
    );
    const logoStream = makeStream('http://a.com/with-logo.m3u8', '翡翠台', 'qa', { logo: 'https://logo/jade.png' });
    const channels = buildChannels([...withLogo, logoStream]);

    expect(channels[0]?.logo).toBe('https://logo/jade.png');
  });

  it('EPG <icon> 位于 <display-name> 之后，且数量与带台标频道数一致', () => {
    const noLogo: Channel = { ...channelOf('cctv1', '央视', ['http://a.com/1.m3u8']), name: 'CCTV-1 综合' };
    const withLogo: Channel = {
      ...channelOf('tvb-jade', '港澳台', ['http://a.com/2.m3u8']),
      name: '翡翠台',
      logo: 'https://logo/jade.png',
    };

    const rendered = renderEpg([noLogo, withLogo], []);

    expect((rendered.xml.match(/<icon /g) ?? [])).toHaveLength(1);
    const channelBody = rendered.xml.slice(rendered.xml.indexOf('<channel id="tvb-jade">'));
    expect(channelBody.indexOf('<display-name>')).toBeLessThan(channelBody.indexOf('<icon '));
  });

  it('台标 URL 含 & 与引号时 XML/M3U 都做转义，不破坏格式', async () => {
    const channel: Channel = {
      ...channelOf('tvb-jade', '港澳台', ['http://a.com/2.m3u8']),
      name: '翡翠台',
      logo: 'https://logo/x.png?a=1&b=2',
    };

    const xml = renderEpg([channel], []).xml;
    expect(xml).toContain('<icon src="https://logo/x.png?a=1&amp;b=2" />');
    expect(xml).not.toContain('a=1&b=2');

    const extinf = renderExtInf({ ...channel, logo: 'https://logo/x.png?a=1&b=2' }, channel.logo as string);
    expect(extinf).toContain('tvg-logo="https://logo/x.png?a=1&b=2"');

    // 端到端：emitEpg 落盘后仍是良构 XML
    const outPath = join(process.cwd(), '.tmp', 'qa-p2', 'epg-escape.xml');
    await emitEpg([channel], { filePath: outPath, fetchImpl: (async () => {
      throw new TypeError('qa: epg down');
    }) as unknown as typeof fetch, sources: ['http://epg.test/a.xml'] });
    const written = readFileSync(outPath, 'utf8');
    expect(written).toContain('&amp;');
    expect((written.match(/<icon /g) ?? [])).toHaveLength(1);
  });
});

describe('R2 繁体归一', () => {
  it.each([
    ['翡翠台', '無綫翡翠台'],
    ['翡翠台', '無線翡翠台'],
    ['明珠台', '無綫明珠台'],
    ['无线新闻台', '無綫新聞台'],
    ['澳视澳门', '澳視澳門'],
    ['凤凰卫视', '鳳凰衛視'],
  ])('「%s」与「%s」归一为同一 slug', (simplified, traditional) => {
    const a = identifyChannel(simplified);
    const b = identifyChannel(traditional);

    expect(a, simplified).not.toBeNull();
    expect(b, traditional).not.toBeNull();
    expect(b?.id).toBe(a?.id);
    expect(b?.group).toBe(a?.group);
  });

  it('命中规则时展示名用规则表的规范名（不会把繁体原样吐给用户）', () => {
    expect(identifyChannel('無綫翡翠台')?.name).toBe('翡翠台');
    expect(identifyChannel('澳視澳門')?.name).toBe('澳视澳门');
  });

  it('未命中规则时展示名保持上游原名，不做繁简转换（展示名红线）', () => {
    const identity = identifyChannel('無綫劇集台');

    expect(identity?.name).toBe('無綫劇集台');
    expect(identity?.name).not.toBe('无线剧集台');
  });

  it('CCTV 高危项未被繁简映射带偏：CCTV5≠CCTV5+、CCTV4≠CCTV4K、1/11/17 不串台', () => {
    const ids = ['CCTV5', 'CCTV5+', 'CCTV4', 'CCTV-4K', 'CCTV1', 'CCTV11', 'CCTV17'].map(
      (name) => identifyChannel(name)?.id,
    );

    expect(ids).toEqual(['cctv5', 'cctv5plus', 'cctv4', 'cctv4k', 'cctv1', 'cctv11', 'cctv17']);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('多义字未被映射（眾/乾/髮/後/隻/裡 保持原样，避免误合并）', () => {
    expect(toSimplified('眾議院')).toBe('眾議院');
    expect(toSimplified('乾淨')).toBe('乾淨');
    expect(toSimplified('頭髮')).toBe('頭髮');
    expect(toSimplified('後來')).toBe('後來');
    expect(toSimplified('一隻')).toBe('一隻');
    expect(toSimplified('這裡')).toBe('這裡');
    expect(toSimplified('重慶衛視')).toBe('重慶卫视');
  });

  it('ASCII / 日文假名 / 数字不被改动', () => {
    expect(toSimplified('CCTV1 HD 1080P')).toBe('CCTV1 HD 1080P');
    expect(toSimplified('ABCテレビ')).toBe('ABCテレビ');
  });

  it('映射表「多对一」只有 3 组异体字，不存在把不同频道压成同一台的情况', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'normalize', 'traditional.ts'), 'utf8');
    const tableStart = source.indexOf('T2S_TABLE');
    const tableBody = source.slice(tableStart, source.indexOf('};', tableStart));
    const pairs = [...tableBody.matchAll(/([\u4e00-\u9fff]):\s*'([\u4e00-\u9fff])'/g)].map((match) => ({
      繁体: match[1] as string,
      简体: match[2] as string,
    }));

    expect(pairs.length).toBeGreaterThan(100);
    // 键唯一
    expect(new Set(pairs.map((pair) => pair.繁体)).size).toBe(pairs.length);
    // 多对一分组只允许这三组"同义异体字"
    const bySimplified = new Map<string, string[]>();
    for (const pair of pairs) {
      bySimplified.set(pair.简体, [...(bySimplified.get(pair.简体) ?? []), pair.繁体]);
    }
    const multi = [...bySimplified.entries()]
      .filter(([, keys]) => keys.length > 1)
      .sort((left, right) => (left[0] < right[0] ? -1 : 1));
    expect(multi).toEqual([
      ['卫', ['衞', '衛']],
      ['台', ['臺', '颱']],
      ['线', ['綫', '線']],
    ]);
  });
});

describe('R4 自填源（userAdded）截断优先级', () => {
  /** 造 4000 条自动源 + 5 条「其他」组自填源。 */
  function buildLargePool(): Channel[] {
    const channels: Channel[] = [];
    // 「其他」组放最前，验证排序不依赖输入顺序
    channels.push(
      channelOf(
        'ch-custom',
        '其他',
        Array.from({ length: 5 }, (_unused, index) => `http://custom.local/${index}.m3u8`),
        true,
      ),
    );
    for (let index = 0; index < 2000; index += 1) {
      const group: Channel['group'] = index % 2 === 0 ? '港澳台' : '卫视';
      channels.push(
        channelOf(`ch-auto-${index}`, group, [`http://auto.local/${index}-a.m3u8`, `http://auto.local/${index}-b.m3u8`]),
      );
    }
    return channels;
  }

  it('4005 条源截断到 3000：5 条自填源全部保留且排在最前', () => {
    const targets = selectCandidates(buildLargePool(), 3000);

    expect(targets).toHaveLength(3000);
    expect(targets.slice(0, 5).map((item) => item.url)).toEqual([
      'http://custom.local/0.m3u8',
      'http://custom.local/1.m3u8',
      'http://custom.local/2.m3u8',
      'http://custom.local/3.m3u8',
      'http://custom.local/4.m3u8',
    ]);
  });

  it('截断结果仍按 urlKey 全局去重', () => {
    const channels = [
      channelOf('ch-custom', '其他', ['http://same.local/x.m3u8'], true),
      channelOf('ch-auto', '港澳台', ['http://same.local/x.m3u8']),
    ];
    const targets = selectCandidates(channels, 3000);

    expect(targets).toHaveLength(1);
    expect(targets[0]?.url).toBe('http://same.local/x.m3u8');
  });

  it('自填源即使优先级最高，测活失败也不输出死链', () => {
    const channels = [channelOf('ch-custom', '其他', ['http://custom.local/0.m3u8'], true)];
    const ranked = rankChannels(channels, [probe('http://custom.local/0.m3u8', false)]);

    expect(ranked).toHaveLength(0);
  });

  it('同频道内自填源排在最前（buildChannels 的 userAdded 优先仍生效）', () => {
    const auto = makeStream('http://auto.local/1.m3u8', '翡翠台', 'iptv-org-hk');
    const custom = makeStream('http://custom.local/1.m3u8', '翡翠台', 'custom', { userAdded: true });
    const channels = buildChannels([auto, custom]);

    expect(channels[0]?.streams[0]?.url).toBe('http://custom.local/1.m3u8');
  });
});
