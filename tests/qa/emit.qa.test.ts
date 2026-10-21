/**
 * @file QA 独立补充测试 —— 产物生成与降级隔离（对应验收任务 C6）。
 *
 * 核心要求（P0-7 / P0-13）：EPG 挂了也必须产出合法 XMLTV，且绝不影响 txt / m3u；
 * 空频道列表时产物仍要能写出、不崩。
 */

import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { emitEpg, escapeXml, renderEpg } from '../../src/emit/epg';
import { renderExtInf, renderM3u } from '../../src/emit/m3u';
import { renderTxt } from '../../src/emit/txt';
import { formatXmltvTime } from '../../src/util/time';
import type { Channel } from '../../src/types';

/** 测试用临时目录（项目内，避免系统临时目录被沙箱拦）。 */
const TMP_DIR = join(process.cwd(), '.tmp', 'qa-emit');

/**
 * 造一个频道。
 *
 * @param id slug
 * @param name 中文名
 * @param group 分组
 * @param urls 源地址
 * @return Channel
 */
function makeChannel(id: string, name: string, group: Channel['group'], urls: readonly string[]): Channel {
  return {
    id,
    name,
    aliases: [name],
    group,
    streams: urls.map((url) => ({ url, urlKey: url, rawName: name, channelId: id, group, origin: 'qa' })),
  };
}

const HMT = makeChannel('tvb-jade', '翡翠台', '港澳台', ['http://a.com/jade.m3u8', 'http://b.com/jade.m3u8']);
const CCTV1 = makeChannel('cctv1', 'CCTV-1 综合', '央视', ['http://a.com/cctv1.m3u8']);
const GD = makeChannel('gd-zhujiang', '广东珠江', '广东', ['http://a.com/zhujiang.m3u8']);
const HN = makeChannel('satellite-hunan', '湖南卫视', '卫视', ['http://a.com/hunan.m3u8']);
const OTHER = makeChannel('ch-abc', '某个台', '其他', ['http://a.com/other.m3u8']);
const ALL = [HN, CCTV1, HMT, OTHER, GD];

/**
 * 造一个"永远失败"的 fetch。
 *
 * @param mode throw = 抛网络错误；status = 返回指定状态码
 * @param status HTTP 状态码
 * @return 假 fetch
 */
function failingFetch(mode: 'throw' | 'status', status = 500): typeof fetch {
  return (async () => {
    if (mode === 'throw') {
      throw new TypeError('fetch failed (qa: network unreachable)');
    }
    return new Response('#EXTM3U\n', { status, headers: { 'content-type': 'application/xml' } });
  }) as unknown as typeof fetch;
}

/**
 * 造一个"返回固定 XMLTV"的 fetch。
 *
 * @param xml 上游 XMLTV 正文
 * @return 假 fetch
 */
function xmlFetch(xml: string): typeof fetch {
  return (async () =>
    new Response(xml, { status: 200, headers: { 'content-type': 'application/xml' } })) as unknown as typeof fetch;
}

/** 极简 XML 良构校验（标签栈配对）。 */
function isWellFormed(xml: string): boolean {
  const stack: string[] = [];
  const pattern = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[A-Za-z_][\w.:-]*\s*=\s*"[^"]*")*)\s*(\/?)>|<\?[\s\S]*?\?>/g;
  let match = pattern.exec(xml);
  while (match !== null) {
    const [raw, closing, tag, , selfClosing] = match;
    if (!raw.startsWith('<?')) {
      if (closing === '/') {
        if (stack.pop() !== tag) {
          return false;
        }
      } else if (selfClosing !== '/') {
        stack.push(tag as string);
      }
    }
    match = pattern.exec(xml);
  }
  return stack.length === 0;
}

beforeAll(async () => {
  await mkdir(TMP_DIR, { recursive: true });
});

afterAll(async () => {
  await rm(TMP_DIR, { recursive: true, force: true });
});

describe('EPG 失败隔离（P0-7）', () => {
  it('EPG 源全部网络异常 → 仍写出仅含 <channel> 的合法 XMLTV，ok=false', async () => {
    const filePath = join(TMP_DIR, 'epg-throw.xml');

    const outcome = await emitEpg(ALL, {
      filePath,
      fetchImpl: failingFetch('throw'),
      sources: ['http://epg.test/a.xml'],
    });
    const xml = await readFile(filePath, 'utf8');

    expect(outcome.ok).toBe(false);
    expect(outcome.programmes).toBe(0);
    expect(outcome.error).toContain('未获取到节目单');
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<tv ');
    expect(xml).not.toContain('<programme');
    expect(isWellFormed(xml)).toBe(true);
    // 每个频道都要有 channel + display-name
    expect((xml.match(/<channel id="/g) ?? [])).toHaveLength(ALL.length);
    expect((xml.match(/<display-name>/g) ?? [])).toHaveLength(ALL.length);
    expect(xml).toContain('<display-name>翡翠台</display-name>');
  });

  it('EPG 源返回 HTTP 500 → 同样降级为仅 <channel>，不抛错', async () => {
    const filePath = join(TMP_DIR, 'epg-500.xml');

    const outcome = await emitEpg(ALL, {
      filePath,
      fetchImpl: failingFetch('status', 500),
      sources: ['http://epg.test/a.xml'],
    });

    expect(outcome.ok).toBe(false);
    expect(await readFile(filePath, 'utf8')).toContain('<tv ');
  });

  it('EPG 有数据但频道匹配不上 → programmes 0、ok=false，产物仍合法', async () => {
    const filePath = join(TMP_DIR, 'epg-nomatch.xml');
    const upstream = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<tv>',
      '  <channel id="unknown.ch"><display-name>不存在的台</display-name></channel>',
      '  <programme start="20250101120000 +0800" stop="20250101130000 +0800" channel="unknown.ch">',
      '    <title>节目</title>',
      '  </programme>',
      '</tv>',
    ].join('\n');

    const outcome = await emitEpg(ALL, {
      filePath,
      fetchImpl: xmlFetch(upstream),
      sources: ['http://epg.test/a.xml'],
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.programmes).toBe(0);
    expect(isWellFormed(await readFile(filePath, 'utf8'))).toBe(true);
  });

  it('EPG 能匹配上频道时写出 <programme>，时间戳为 YYYYMMDDHHmmss +0800', async () => {
    const filePath = join(TMP_DIR, 'epg-ok.xml');
    const upstream = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<tv>',
      '  <channel id="cctv1"><display-name>CCTV-1</display-name></channel>',
      '  <programme start="20250101120000 +0800" stop="20250101130000 +0800" channel="cctv1">',
      '    <title>新闻联播 &amp; 天气预报</title>',
      '  </programme>',
      '</tv>',
    ].join('\n');

    const outcome = await emitEpg(ALL, {
      filePath,
      fetchImpl: xmlFetch(upstream),
      sources: ['http://epg.test/a.xml'],
    });
    const xml = await readFile(filePath, 'utf8');

    expect(outcome.ok).toBe(true);
    expect(outcome.programmes).toBe(1);
    expect(xml).toContain('<programme start="20250101120000 +0800" stop="20250101130000 +0800" channel="cctv1">');
    expect(xml).toContain('<title lang="zh">新闻联播 &amp; 天气预报</title>');
    expect(isWellFormed(xml)).toBe(true);
  });
});

describe('空频道列表', () => {
  it('renderTxt 返回空串、renderM3u 只有 #EXTM3U 头、renderEpg 仍是合法 XMLTV', () => {
    expect(renderTxt([])).toBe('');
    expect(renderM3u([])).toBe('#EXTM3U\n');

    const rendered = renderEpg([], []);
    expect(rendered.programmes).toBe(0);
    expect(isWellFormed(rendered.xml)).toBe(true);
    expect(rendered.xml).toContain('<tv ');
    expect(rendered.xml).not.toContain('<channel id=');
  });

  it('emitEpg 对空频道列表不抛错，并写出合法空 XMLTV', async () => {
    const filePath = join(TMP_DIR, 'epg-empty.xml');

    const outcome = await emitEpg([], { filePath, fetchImpl: failingFetch('throw'), sources: [] });

    expect(outcome.ok).toBe(false);
    expect(isWellFormed(await readFile(filePath, 'utf8'))).toBe(true);
  });
});

describe('TXT 产物格式（P0-5 + 约定 §3）', () => {
  const text = renderTxt(ALL);

  it('分组顺序 = 港澳台→广东→央视→卫视→其他，组间一个空行', () => {
    const headers = text
      .split('\n')
      .filter((line) => line.includes('#genre#'))
      .map((line) => line.split(',')[0]);

    expect(headers).toEqual(['港澳台', '广东', '央视', '卫视', '其他']);
    expect(text).toContain('翡翠台,http://a.com/jade.m3u8#http://b.com/jade.m3u8\n\n广东,#genre#');
  });

  it('无 BOM、无 CR、末尾恰好一个换行', () => {
    expect(text.charCodeAt(0)).not.toBe(0xfeff);
    expect(text).not.toContain('\r');
    expect(text.endsWith('\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
  });

  it('每行结构为「频道名,url1#url2#…」，频道行不带 #genre#', () => {
    const channelLines = text.split('\n').filter((line) => line.length > 0 && !line.includes('#genre#'));

    expect(channelLines).toHaveLength(ALL.length);
    for (const line of channelLines) {
      const commaIndex = line.indexOf(',');
      expect(commaIndex).toBeGreaterThan(0);
      const name = line.slice(0, commaIndex);
      const urls = line.slice(commaIndex + 1).split('#');

      expect(name.trim()).toBe(name);
      expect(name).not.toContain(',');
      expect(urls.length).toBeGreaterThan(0);
      for (const url of urls) {
        expect(url).toMatch(/^https?:\/\/\S+$/);
      }
    }
  });
});

describe('M3U 产物格式（P0-6 + 约定 §1）', () => {
  const text = renderM3u(ALL);
  const lines = text.split('\n');

  it('首行 #EXTM3U，每个源一条 #EXTINF + 一行 URL', () => {
    expect(lines[0]).toBe('#EXTM3U');
    const extinf = lines.filter((line) => line.startsWith('#EXTINF'));
    const urls = lines.filter((line) => line.length > 0 && !line.startsWith('#'));

    expect(urls).toHaveLength(6); // 5 个频道共 6 个源
    expect(extinf).toHaveLength(urls.length);
  });

  it('每条 #EXTINF 含 tvg-id(取 slug)/tvg-name(中文名)/tvg-logo/group-title', () => {
    const extinf = lines.find((line) => line.includes('tvb-jade'));

    expect(extinf).toBe(
      '#EXTINF:-1 tvg-id="tvb-jade" tvg-name="翡翠台" tvg-logo="" group-title="港澳台",翡翠台',
    );
  });

  it('extinf 渲染对引号做安全转义，避免破坏语法', () => {
    const broken = { ...CCTV1, name: 'CCTV"1', id: 'cctv1' };

    const line = renderExtInf(broken, '');

    expect((line.match(/"/g) ?? [])).toHaveLength(8); // 4 对属性引号
    expect(line).not.toContain('"1"');
  });
});

describe('EPG / 时间戳', () => {
  it('formatXmltvTime 输出 YYYYMMDDHHmmss +0800，且不依赖本机时区', () => {
    const ms = Date.parse('2025-01-01T12:00:00+08:00');

    expect(formatXmltvTime(ms)).toBe('20250101120000 +0800');
  });

  it('escapeXml 转义 5 个 XML 特殊字符', () => {
    expect(escapeXml(`<&>"'`)).toBe('&lt;&amp;&gt;&quot;&apos;');
  });

  it('频道名含 & 时 EPG 不破坏 XML 良构性', () => {
    const weird: Channel = { ...CCTV1, id: 'ch-weird', name: 'A&B<C>', streams: CCTV1.streams };

    const rendered = renderEpg([weird], []);

    expect(isWellFormed(rendered.xml)).toBe(true);
    expect(rendered.xml).toContain('<display-name>A&amp;B&lt;C&gt;</display-name>');
  });
});
