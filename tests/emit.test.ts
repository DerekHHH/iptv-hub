/**
 * @file 产物生成单测：TXT 无 BOM/LF、分组头格式、M3U EXTINF 属性、EPG XMLTV 结构。
 */

import { describe, expect, it } from 'vitest';

import { renderM3u } from '../src/emit/m3u';
import { renderTxt } from '../src/emit/txt';
import { escapeXml, parseXmltvTime, renderEpg } from '../src/emit/epg';
import { formatIsoCst, formatXmltvTime } from '../src/util/time';
import type { Channel } from '../src/types';
import { makeChannel } from './helpers';

/** 造一批跨分组频道。 */
function sampleChannels(): Channel[] {
  return [
    makeChannel('tvb-jade', '翡翠台', '港澳台', ['http://a/jade-1.m3u8', 'http://a/jade-2.m3u8']),
    makeChannel('gd-zhujiang', '广东珠江', '广东', ['http://a/zj.m3u8']),
    makeChannel('cctv1', 'CCTV-1 综合', '央视', ['http://a/cctv1-1.m3u8', 'http://a/cctv1-2.m3u8', 'http://a/cctv1-3.m3u8']),
    makeChannel('satellite-hunan', '湖南卫视', '卫视', ['http://a/hunan.m3u8']),
  ];
}

describe('renderTxt', () => {
  it('无 BOM、只有 LF、末尾单个换行', () => {
    const text = renderTxt(sampleChannels());
    expect(text.startsWith('\uFEFF')).toBe(false);
    expect(text.includes('\r')).toBe(false);
    expect(text.endsWith('\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
  });

  it('分组头格式为「分组名,#genre#」独立成行，组间有空行', () => {
    const lines = renderTxt(sampleChannels()).split('\n');
    expect(lines[0]).toBe('港澳台,#genre#');
    expect(lines).toContain('广东,#genre#');
    expect(lines).toContain('央视,#genre#');
    expect(lines).toContain('卫视,#genre#');
    // 港澳台组只有一条频道行，之后应是空行
    expect(lines[2]).toBe('');
    expect(lines[3]).toBe('广东,#genre#');
  });

  it('频道行是「频道名,url1#url2#url3」', () => {
    const lines = renderTxt(sampleChannels()).split('\n');
    expect(lines).toContain('CCTV-1 综合,http://a/cctv1-1.m3u8#http://a/cctv1-2.m3u8#http://a/cctv1-3.m3u8');
    expect(lines).toContain('翡翠台,http://a/jade-1.m3u8#http://a/jade-2.m3u8');
  });

  it('分组顺序固定：港澳台 → 广东 → 央视 → 卫视', () => {
    const text = renderTxt(sampleChannels());
    const positions = ['港澳台,#genre#', '广东,#genre#', '央视,#genre#', '卫视,#genre#'].map((marker) =>
      text.indexOf(marker),
    );
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    expect(positions.every((position) => position >= 0)).toBe(true);
  });

  it('filter 参数可用（lite.txt 预留）', () => {
    const text = renderTxt(sampleChannels(), { groups: ['港澳台', '广东'] });
    expect(text).toContain('港澳台,#genre#');
    expect(text).toContain('广东,#genre#');
    expect(text).not.toContain('央视,#genre#');
  });

  it('空频道列表返回空串（不产出 BOM/空行）', () => {
    expect(renderTxt([])).toBe('');
  });
});

describe('renderM3u', () => {
  it('首行 #EXTM3U，每个源一条 EXTINF', () => {
    const text = renderM3u(sampleChannels());
    const lines = text.split('\n').filter((line) => line.length > 0);
    expect(lines[0]).toBe('#EXTM3U');
    const extinf = lines.filter((line) => line.startsWith('#EXTINF:'));
    expect(extinf).toHaveLength(7);
  });

  it('EXTINF 含 tvg-id(slug) / tvg-name(中文) / tvg-logo / group-title', () => {
    const text = renderM3u(sampleChannels());
    expect(text).toContain('tvg-id="cctv1"');
    expect(text).toContain('tvg-name="CCTV-1 综合"');
    expect(text).toContain('tvg-logo=""');
    expect(text).toContain('group-title="央视"');
    expect(text).toContain('tvg-id="tvb-jade"');
  });

  it('#EXTINF 后面紧跟地址行', () => {
    const lines = renderM3u([makeChannel('cctv1', 'CCTV-1 综合', '央视', ['http://a/1.m3u8'])])
      .split('\n')
      .filter((line) => line.length > 0);
    expect(lines[1]).toMatch(/^#EXTINF:-1 /);
    expect(lines[2]).toBe('http://a/1.m3u8');
  });

  it('无 BOM 且只有 LF', () => {
    const text = renderM3u(sampleChannels());
    expect(text.startsWith('\uFEFF')).toBe(false);
    expect(text.includes('\r')).toBe(false);
  });
});

describe('renderEpg', () => {
  it('输出合法 XMLTV 结构，channel id 用 slug，display-name 用中文', () => {
    const rendered = renderEpg(sampleChannels(), []);
    expect(rendered.xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(rendered.xml).toContain('<tv generator-info-name="iptv_source_hub"');
    expect(rendered.xml).toContain('<channel id="cctv1">');
    expect(rendered.xml).toContain('<display-name>CCTV-1 综合</display-name>');
    expect(rendered.xml.trimEnd().endsWith('</tv>')).toBe(true);
  });

  it('programme 时间戳是 YYYYMMDDHHmmss +0800', () => {
    const start = Date.UTC(2025, 0, 1, 4, 0, 0); // 北京时间 12:00
    const stop = start + 30 * 60 * 1000;
    const rendered = renderEpg(sampleChannels(), [
      { channelSlug: 'cctv1', startMs: start, stopMs: stop, title: '新闻联播' },
    ]);
    expect(rendered.xml).toContain('start="20250101120000 +0800"');
    expect(rendered.xml).toContain('stop="20250101123000 +0800"');
    expect(rendered.xml).toContain('channel="cctv1"');
    expect(rendered.xml).toContain('<title lang="zh">新闻联播</title>');
    expect(rendered.programmes).toBe(1);
  });

  it('未知频道的节目被丢弃', () => {
    const rendered = renderEpg(sampleChannels(), [
      { channelSlug: 'not-exist', startMs: 0, stopMs: 1000, title: 'x' },
    ]);
    expect(rendered.programmes).toBe(0);
  });

  it('escapeXml 转义五类特殊字符', () => {
    expect(escapeXml('<a&b>"c\'')).toBe('&lt;a&amp;b&gt;&quot;c&apos;');
  });

  it('parseXmltvTime 能反解带偏移的时间戳', () => {
    expect(parseXmltvTime('20250101120000 +0800')).toBe(Date.UTC(2025, 0, 1, 4, 0, 0));
    expect(parseXmltvTime('20250101120000 +0000')).toBe(Date.UTC(2025, 0, 1, 12, 0, 0));
    expect(parseXmltvTime('乱码')).toBeNull();
  });
});

describe('时间格式化（不依赖 TZ 环境变量）', () => {
  it('formatXmltvTime 在 TZ=UTC 下仍输出 +0800 语义', () => {
    const original = process.env['TZ'];
    process.env['TZ'] = 'UTC';
    try {
      const ms = Date.UTC(2025, 0, 1, 4, 0, 0);
      expect(formatXmltvTime(ms)).toBe('20250101120000 +0800');
      expect(formatIsoCst(ms)).toBe('2025-01-01T12:00:00+08:00');
    } finally {
      if (original === undefined) {
        delete process.env['TZ'];
      } else {
        process.env['TZ'] = original;
      }
    }
  });

  it('跨日边界正确（UTC 20:00 = 北京次日 04:00）', () => {
    expect(formatIsoCst(Date.UTC(2025, 0, 1, 20, 0, 0))).toBe('2025-01-02T04:00:00+08:00');
  });
});
