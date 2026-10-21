/**
 * @file L4 测活单测：全部走注入的 mock fetch，**绝不触网**。
 */

import { describe, expect, it } from 'vitest';

import { probeAll, probeOne, scoreResult } from '../src/probe/probe';
import { firstSegmentUri, isMasterPlaylist, parseVariantStreams } from '../src/probe/hls';
import { toUrlKey } from '../src/util/slug';

/** 一段合法的 master playlist。 */
const MASTER = [
  '#EXTM3U',
  '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=854x480',
  'v0.m3u8',
  '#EXT-X-STREAM-INF:BANDWIDTH=4000000,RESOLUTION=1920x1080',
  'v1.m3u8',
  '',
].join('\n');

/** 一段合法的 media playlist。 */
const MEDIA = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXTINF:4.0,', 'seg0.ts', '#EXT-X-ENDLIST', ''].join('\n');

/**
 * 造一个确定性的 mock fetch。
 *
 * @param handler 对 URL 返回 Response 的函数
 * @return 假 fetch
 */
function mockFetch(handler: (url: string) => Response): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return handler(url);
  }) as unknown as typeof fetch;
}

/**
 * 造一段 TS 分片字节。
 *
 * @param size 字节数
 * @return Uint8Array
 */
function tsBytes(size = 188 * 2): Uint8Array {
  return new Uint8Array(size).fill(0x47);
}

describe('probeOne', () => {
  it('200 + #EXTM3U（master）→ 二跳通过后 alive 且带 resolution', async () => {
    const fetchImpl = mockFetch((url) => {
      if (url.endsWith('.m3u8') && !url.includes('v1') && !url.includes('v0')) {
        return new Response(MASTER, { status: 200, headers: { 'content-type': 'application/vnd.apple.mpegurl' } });
      }
      if (url.endsWith('.m3u8')) {
        return new Response(MEDIA, { status: 200, headers: { 'content-type': 'application/vnd.apple.mpegurl' } });
      }
      return new Response(tsBytes(), { status: 200, headers: { 'content-type': 'video/mp2t' } });
    });

    const result = await probeOne('http://a/live/index.m3u8', {}, { fetchImpl, now: () => 1000 });
    expect(result.status).toBe('alive');
    expect(result.alive).toBe(true);
    expect(result.resolution).toBe('1920x1080');
    expect(result.width).toBe(1920);
    expect(result.bandwidth).toBe(4000000);
    expect(result.kind).toBe('hls');
  });

  it('404 → dead 且记录 httpStatus', async () => {
    const fetchImpl = mockFetch(() => new Response('not found', { status: 404 }));
    const result = await probeOne('http://a/missing.m3u8', {}, { fetchImpl, now: () => 0 });
    expect(result.status).toBe('dead');
    expect(result.httpStatus).toBe(404);
  });

  it('超时 → timeout', async () => {
    const fetchImpl = (async () => {
      const error = new Error('aborted');
      error.name = 'TimeoutError';
      throw error;
    }) as unknown as typeof fetch;
    const result = await probeOne('http://a/slow.m3u8', { timeoutMs: 10 }, { fetchImpl, now: () => 0 });
    expect(result.status).toBe('timeout');
  });

  it('网络异常 → dead 且带 error 文案', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const result = await probeOne('http://a/broken.m3u8', {}, { fetchImpl, now: () => 0 });
    expect(result.status).toBe('dead');
    expect(result.error).toContain('fetch failed');
  });

  it('rtmp/udp 等协议 → skipped（不探测、不输出）', async () => {
    const result = await probeOne('rtmp://a/live/stream', {}, { fetchImpl: mockFetch(() => new Response('')), now: () => 0 });
    expect(result.status).toBe('skipped');
    expect(result.alive).toBe(false);
  });

  it('m3u8 子请求失败 → dead', async () => {
    const fetchImpl = mockFetch((url) => {
      if (url.includes('index.m3u8')) {
        return new Response(MASTER, { status: 200, headers: { 'content-type': 'application/vnd.apple.mpegurl' } });
      }
      return new Response('', { status: 500 });
    });
    const result = await probeOne('http://a/index.m3u8', {}, { fetchImpl, now: () => 0 });
    expect(result.status).toBe('dead');
  });

  it('非 HLS 的 2xx + 视频字节 → alive（flv/ts 直连）', async () => {
    const fetchImpl = mockFetch(
      () => new Response(tsBytes(), { status: 200, headers: { 'content-type': 'video/x-flv' } }),
    );
    const result = await probeOne('http://a/live.flv', {}, { fetchImpl, now: () => 0 });
    expect(result.status).toBe('alive');
    expect(result.kind).toBe('flv');
  });

  it('2xx 但响应为空 → dead', async () => {
    const fetchImpl = mockFetch(() => new Response(null, { status: 200 }));
    const result = await probeOne('http://a/empty.flv', {}, { fetchImpl, now: () => 0 });
    expect(result.status).toBe('dead');
  });

  it('媒体类型未知但字节够长 → alive', async () => {
    const fetchImpl = mockFetch(
      () => new Response(tsBytes(), { status: 200, headers: { 'content-type': 'application/octet-stream' } }),
    );
    const result = await probeOne('http://a/stream.bin', {}, { fetchImpl, now: () => 0 });
    expect(result.status).toBe('alive');
  });

  it('urlKey 与 toUrlKey 一致', async () => {
    const fetchImpl = mockFetch(() => new Response(tsBytes(), { status: 200, headers: { 'content-type': 'video/mp2t' } }));
    const result = await probeOne('http://A/x.m3u8', {}, { fetchImpl, now: () => 0 });
    expect(result.urlKey).toBe(toUrlKey('http://A/x.m3u8'));
  });
});

describe('probeAll', () => {
  it('64 并发跑 100 个立即返回的源，远小于 10s', async () => {
    const fetchImpl = mockFetch(() => new Response(tsBytes(), { status: 200, headers: { 'content-type': 'video/mp2t' } }));
    const targets = Array.from({ length: 100 }, (_unused, index) => ({
      urlKey: toUrlKey(`http://a/${index}.flv`),
      url: `http://a/${index}.flv`,
    }));

    const startedAt = Date.now();
    const results = await probeAll(targets, { concurrency: 64, timeoutMs: 8000, deadline: Date.now() + 60_000 }, { fetchImpl });
    const elapsed = Date.now() - startedAt;

    expect(results).toHaveLength(100);
    expect(results.every((item) => item.status === 'alive')).toBe(true);
    expect(elapsed).toBeLessThan(10_000);
  });

  it('超过全局 deadline 的源记 skipped', async () => {
    const fetchImpl = mockFetch(() => new Response(tsBytes(), { status: 200, headers: { 'content-type': 'video/mp2t' } }));
    const results = await probeAll(
      [{ urlKey: toUrlKey('http://a/1.flv'), url: 'http://a/1.flv' }],
      { concurrency: 1, timeoutMs: 100, deadline: Date.now() - 1000 },
      { fetchImpl },
    );
    expect(results[0]?.status).toBe('skipped');
  });

  it('结果顺序与输入一致', async () => {
    const fetchImpl = mockFetch((url) =>
      url.includes('bad')
        ? new Response('x', { status: 500 })
        : new Response(tsBytes(), { status: 200, headers: { 'content-type': 'video/mp2t' } }),
    );
    const targets = [
      { urlKey: toUrlKey('http://a/1.flv'), url: 'http://a/1.flv' },
      { urlKey: toUrlKey('http://a/bad.flv'), url: 'http://a/bad.flv' },
      { urlKey: toUrlKey('http://a/2.flv'), url: 'http://a/2.flv' },
    ];
    const results = await probeAll(targets, { concurrency: 3, timeoutMs: 1000, deadline: Date.now() + 10_000 }, { fetchImpl });
    expect(results.map((item) => item.urlKey)).toEqual(targets.map((item) => item.urlKey));
    expect(results[1]?.status).toBe('dead');
  });
});

describe('HLS 解析', () => {
  it('parseVariantStreams 按分辨率降序，最高变体在前', () => {
    const variants = parseVariantStreams(MASTER, 'http://a/index.m3u8');
    expect(variants).toHaveLength(2);
    expect(variants[0]?.resolution).toBe('1920x1080');
    expect(variants[0]?.uri).toBe('http://a/v1.m3u8');
  });

  it('isMasterPlaylist 与 firstSegmentUri', () => {
    expect(isMasterPlaylist(MASTER)).toBe(true);
    expect(isMasterPlaylist(MEDIA)).toBe(false);
    expect(firstSegmentUri(MEDIA, 'http://a/live/v0.m3u8')).toBe('http://a/live/seg0.ts');
  });
});

describe('scoreResult', () => {
  it('1080p 高分值高于 480p', () => {
    const uhd = scoreResult({
      urlKey: 'a',
      status: 'alive',
      alive: true,
      width: 1920,
      height: 1080,
      latencyMs: 800,
      checkedAt: '',
    });
    const sd = scoreResult({
      urlKey: 'b',
      status: 'alive',
      alive: true,
      width: 854,
      height: 480,
      latencyMs: 5,
      checkedAt: '',
    });
    expect(uhd).toBeGreaterThan(sd);
  });
});
