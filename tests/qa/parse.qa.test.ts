/**
 * @file QA 独立补充测试 —— 解析层边界（对应验收任务 C1）。
 *
 * 说明：本文件由 QA 独立编写，不复用工程师 `tests/parse.test.ts` 的任何断言，
 * 目的是从「上游真实畸形数据」角度验证解析层不崩、不丢字段、不误改 URL。
 */

import { describe, expect, it } from 'vitest';

import { parseM3U } from '../../src/parse/parseM3U';
import { parseAuto, parseTxt } from '../../src/parse/parseTxt';

describe('parseTxt：畸形但真实存在的上游写法', () => {
  it('BOM + CRLF：不产生乱码频道名，分组头被跳过', () => {
    const text = '\uFEFF港澳台,#genre#\r\n翡翠台,http://a.com/1.m3u8\r\nCCTV1,http://a.com/2.m3u8\r\n';
    const streams = parseTxt(text, 'qa');

    expect(streams).toHaveLength(2);
    expect(streams.map((item) => item.rawName)).toEqual(['翡翠台', 'CCTV1']);
    // 首条频道名首字符必须是"翡"，不能残留 BOM 或 \uFFFD
    expect(streams[0]?.rawName.charCodeAt(0)).toBe('翡'.charCodeAt(0));
    expect(streams.some((item) => item.rawName.includes('#genre#'))).toBe(false);
    expect(streams[0]?.url).toBe('http://a.com/1.m3u8');
  });

  it('一个频道多地址 url1#url2#url3 被拆成 3 条，且重复地址被去重', () => {
    const text = '翡翠台,http://a.com/1.m3u8#http://a.com/2.m3u8#http://a.com/3.m3u8#http://a.com/3.m3u8\n';
    const streams = parseTxt(text, 'qa');

    expect(streams).toHaveLength(3);
    expect(streams.map((item) => item.url)).toEqual([
      'http://a.com/1.m3u8',
      'http://a.com/2.m3u8',
      'http://a.com/3.m3u8',
    ]);
    expect(streams.every((item) => item.rawName === '翡翠台')).toBe(true);
  });

  it('只有 URL 没有频道名的行被保留为 rawName 空串（由归一阶段丢弃）', () => {
    const streams = parseTxt('http://a.com/1.m3u8\nhttp://a.com/2.m3u8\n', 'qa');

    expect(streams).toHaveLength(2);
    expect(streams.every((item) => item.rawName === '')).toBe(true);
    expect(streams.every((item) => item.channelId === '')).toBe(true);
  });

  it('缺少 #genre# 分组头的 txt 依然能正常解析出频道行', () => {
    const streams = parseTxt('翡翠台,http://a.com/1.m3u8\nCCTV1,http://a.com/2.m3u8\n', 'qa');

    expect(streams.map((item) => item.rawName)).toEqual(['翡翠台', 'CCTV1']);
  });

  it('空文件 / 只有注释和空行 → 0 条且不抛错', () => {
    expect(parseTxt('', 'qa')).toHaveLength(0);
    expect(parseTxt('\n\n\r\n', 'qa')).toHaveLength(0);
    expect(parseTxt('# 这是注释\n#genre#\n', 'qa')).toHaveLength(0);
  });

  it('10 万字符的超长行不会崩，且 URL 被完整保留', () => {
    const longName = 'Z'.repeat(100_000);
    const streams = parseTxt(`${longName},http://a.com/long.m3u8\n`, 'qa');

    expect(streams).toHaveLength(1);
    expect(streams[0]?.rawName).toHaveLength(100_000);
    expect(streams[0]?.url).toBe('http://a.com/long.m3u8');
  });

  it('频道行 URL 字段为空 → 跳过，不产出空 url 记录', () => {
    const streams = parseTxt('翡翠台,\nCCTV1,http://a.com/2.m3u8\n', 'qa');

    expect(streams.map((item) => item.url)).toEqual(['http://a.com/2.m3u8']);
  });

  it('URL 保留原始大小写与 query，不做改写（播放器要用原址）', () => {
    const streams = parseTxt('翡翠台,http://CDN.Example.com/Live/Index.M3U8?token=abc\n', 'qa');

    expect(streams[0]?.url).toBe('http://CDN.Example.com/Live/Index.M3U8?token=abc');
    // urlKey 才是去重用的规范化键
    expect(streams[0]?.urlKey).toBe('http://cdn.example.com/Live/Index.M3U8?token=abc');
  });
});

describe('parseM3U：缺失属性与退化写法', () => {
  it('完全没有属性的 #EXTINF:-1,频道名 也能取到频道名', () => {
    const streams = parseM3U('#EXTM3U\n#EXTINF:-1,翡翠台\nhttp://a.com/jade.m3u8\n', 'qa');

    expect(streams).toHaveLength(1);
    expect(streams[0]?.rawName).toBe('翡翠台');
  });

  it('#EXTINF 只有 tvg-id 时用 tvg-id 兜底当频道名（不产生无名源）', () => {
    const streams = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-id="cctv1"\nhttp://a.com/1.m3u8\n', 'qa');

    expect(streams).toHaveLength(1);
    expect(streams[0]?.rawName).toBe('cctv1');
  });

  it('tvg-name 优先于逗号后的展示名（上游常用英文台名）', () => {
    const streams = parseM3U(
      '#EXTM3U\n#EXTINF:-1 tvg-name="TVB Jade" group-title="HK",翡翠台 高清\nhttp://a.com/jade.m3u8\n',
      'qa',
    );

    expect(streams[0]?.rawName).toBe('TVB Jade');
  });

  it('tvg-logo 缺失不报错，存在时写入 logo', () => {
    const withLogo = parseM3U(
      '#EXTM3U\n#EXTINF:-1 tvg-name="A" tvg-logo="http://logo/a.png",A\nhttp://a.com/a.m3u8\n',
      'qa',
    );
    const withoutLogo = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="B",B\nhttp://a.com/b.m3u8\n', 'qa');

    expect(withLogo[0]?.logo).toBe('http://logo/a.png');
    expect(withoutLogo[0]?.logo).toBeUndefined();
  });

  it('一个 #EXTINF 后面跟 "#" 分隔的多地址也能拆开', () => {
    const streams = parseM3U('#EXTM3U\n#EXTINF:-1,A\nhttp://a.com/1.m3u8#http://a.com/2.m3u8\n', 'qa');

    expect(streams.map((item) => item.url)).toEqual(['http://a.com/1.m3u8', 'http://a.com/2.m3u8']);
    expect(streams.every((item) => item.rawName === 'A')).toBe(true);
  });

  it('没有任何 #EXTINF 的纯地址列表：解析出源但频道名为空', () => {
    const streams = parseM3U('http://a.com/1.m3u8\nhttp://a.com/2.m3u8\n', 'qa');

    expect(streams).toHaveLength(2);
    expect(streams.every((item) => item.rawName === '')).toBe(true);
  });

  it('#EXTM3U / #EXTGRP / #EXTVLCOPT 注释行一律忽略，不产出源', () => {
    const streams = parseM3U(
      [
        '#EXTM3U',
        '#EXTGRP:未分组',
        '#EXTINF:-1 tvg-name="A",A',
        '#EXTVLCOPT:http-user-agent=Mozilla',
        'http://a.com/a.m3u8',
      ].join('\n'),
      'qa',
    );

    expect(streams).toHaveLength(1);
    expect(streams[0]?.url).toBe('http://a.com/a.m3u8');
  });

  it('空文本 → 0 条且不抛错', () => {
    expect(parseM3U('', 'qa')).toHaveLength(0);
  });
});

describe('parseAuto：按内容选解析器', () => {
  it('含 #EXTM3U 走 M3U 解析（txt 里的逗号不会被误当分隔）', () => {
    const streams = parseAuto('#EXTM3U\n#EXTINF:-1 tvg-name="A,带逗号",A\nhttp://a.com/a.m3u8\n', 'qa');

    expect(streams).toHaveLength(1);
    expect(streams[0]?.url).toBe('http://a.com/a.m3u8');
  });

  it('纯 DIYP txt 走 TXT 解析', () => {
    const streams = parseAuto('港澳台,#genre#\n翡翠台,http://a.com/jade.m3u8\n', 'qa');

    expect(streams).toHaveLength(1);
    expect(streams[0]?.rawName).toBe('翡翠台');
  });
});
