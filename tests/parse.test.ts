/**
 * @file L2 解析层单测（离线，不触网）。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseExtInfLine, parseM3U } from '../src/parse/parseM3U';
import { parseAuto, parseTxt } from '../src/parse/parseTxt';
import { splitUrlField, toCleanLines } from '../src/parse/common';

const FIXTURES = join(process.cwd(), 'tests', 'fixtures');

/**
 * 读 fixture 文本。
 *
 * @param name 文件名
 * @return 文本
 */
function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

describe('parseM3U', () => {
  it('解析带完整属性的 #EXTINF', () => {
    const streams = parseM3U(fixture('sample.m3u'), 'fixture');
    expect(streams).toHaveLength(5);

    const first = streams[0];
    expect(first).toBeDefined();
    expect(first?.rawName).toBe('CCTV-1');
    expect(first?.url).toBe('http://example.com/live/cctv1/index.m3u8');
    expect(first?.logo).toBe('https://example.com/logo/cctv1.png');
    expect(first?.origin).toBe('fixture');
    // 归一前 channelId 为空占位
    expect(first?.channelId).toBe('');
  });

  it('解析无属性的 #EXTINF:-1,频道名', () => {
    const streams = parseM3U('#EXTM3U\n#EXTINF:-1,湖南卫视\nhttp://example.com/hunan.m3u8\n', 'o');
    expect(streams).toHaveLength(1);
    expect(streams[0]?.rawName).toBe('湖南卫视');
  });

  it('缺失 tvg-logo 时不报错', () => {
    const streams = parseM3U(fixture('sample.m3u'), 'fixture');
    // 该条只有 group-title，没有 tvg-logo
    const noLogo = streams.find((item) => item.rawName === 'NoLogoChannel');
    expect(noLogo).toBeDefined();
    expect(noLogo?.logo).toBeUndefined();
  });

  it('无 #EXTINF 的纯地址列表：rawName 为空（后续丢弃）', () => {
    const streams = parseM3U(fixture('sample-nometa.m3u'), 'o');
    expect(streams).toHaveLength(3);
    expect(streams.every((item) => item.rawName === '')).toBe(true);
  });

  it('parseExtInfLine 能取到全部属性', () => {
    const meta = parseExtInfLine(
      '#EXTINF:-1 tvg-id="a.b" tvg-name="Name" tvg-logo="http://l/x.png" group-title="央视",展示名',
    );
    expect(meta.tvgId).toBe('a.b');
    expect(meta.tvgName).toBe('Name');
    expect(meta.logo).toBe('http://l/x.png');
    expect(meta.groupTitle).toBe('央视');
    expect(meta.name).toBe('展示名');
  });
});

describe('parseTxt', () => {
  it('解析 TVBox 分组格式并拆开 # 分隔的多源', () => {
    const streams = parseTxt(fixture('sample-tvbox.txt'), 'fixture');
    // 2 + 1 + 3 + 1 + 1 + 1 + 1 = 10
    expect(streams).toHaveLength(10);

    const jade = streams.filter((item) => item.rawName === '翡翠台');
    expect(jade).toHaveLength(3);
    expect(jade.map((item) => item.url)).toContain('http://example.com/live/tvb-jade/c.m3u8');
  });

  it('跳过 #genre# 分组头与注释行', () => {
    const streams = parseTxt('央视,#genre#\n# 注释\nCCTV1,http://a/b.m3u8\n', 'o');
    expect(streams).toHaveLength(1);
    expect(streams[0]?.rawName).toBe('CCTV1');
  });

  it('能处理 BOM + CRLF 的输入文件', () => {
    const raw = fixture('sample-bom-crlf.txt');
    expect(raw.startsWith('\uFEFF')).toBe(true);
    expect(raw.includes('\r\n')).toBe(true);

    const streams = parseTxt(raw, 'fixture');
    expect(streams).toHaveLength(3);
    expect(streams[0]?.rawName).toBe('CCTV1');
    expect(streams[0]?.url).toBe('http://example.com/live/cctv1/bom.m3u8');
  });

  it('无频道名的纯地址行保留为空名（由归一阶段丢弃）', () => {
    const streams = parseTxt('http://example.com/only.m3u8\n', 'o');
    expect(streams).toHaveLength(1);
    expect(streams[0]?.rawName).toBe('');
  });

  it('parseAuto 能按内容挑对解析器', () => {
    expect(parseAuto(fixture('sample.m3u'), 'o')).toHaveLength(5);
    expect(parseAuto(fixture('sample-tvbox.txt'), 'o')).toHaveLength(10);
  });

  it('JSON 快照不会被误当成播放列表', () => {
    const streams = parseAuto(fixture('upstream-snapshot.json'), 'o');
    expect(streams).toHaveLength(0);
  });
});

describe('解析工具', () => {
  it('toCleanLines 去 BOM、统一换行、丢空行', () => {
    const lines = toCleanLines('\uFEFFa\r\n\r\n  b  \r\n');
    expect(lines).toEqual(['a', 'b']);
  });

  it('splitUrlField 去空、去重、保序', () => {
    const urls = splitUrlField('http://a/x.m3u8##http://b/y.m3u8#http://a/x.m3u8');
    expect(urls).toEqual(['http://a/x.m3u8', 'http://b/y.m3u8']);
  });
});
