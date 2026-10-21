/**
 * @file 离线 MOCK 用的假 fetch（仅 `MOCK_MODE=1` 时启用）。
 *
 * 目的：`npm run validate:local` 能在**完全无网络**的机器上跑完整流水线。
 * 结果对同一 URL 是确定性的（FNV-1a 哈希分桶），因此产物可复现。
 */

import { fnv1a } from '../util/slug';

/** 假响应的分桶数量。 */
const BUCKETS = 10;

/** 分片字节数（>=188 视为真实 TS 数据）。 */
const MOCK_SEGMENT_BYTES = 188 * 4;

/** 假 HLS 分辨率池。 */
const MOCK_RESOLUTIONS: ReadonlyArray<{ width: number; height: number; bandwidth: number }> = [
  { width: 1920, height: 1080, bandwidth: 4_500_000 },
  { width: 1280, height: 720, bandwidth: 2_500_000 },
  { width: 854, height: 480, bandwidth: 1_200_000 },
];

/**
 * 构造一个确定性的假响应体。
 *
 * @param url 请求地址
 * @return [正文, content-type]
 */
function buildPlaylist(url: string): [string, string] {
  const hash = fnv1a(url);
  const resolution = MOCK_RESOLUTIONS[hash % MOCK_RESOLUTIONS.length] ?? MOCK_RESOLUTIONS[0];
  const variantMatch = url.match(/v(\d+)\.m3u8/i);

  if (variantMatch !== null) {
    const index = variantMatch[1] ?? '0';
    return [
      ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:4', '#EXTINF:4.000,', `seg${index}.ts`, '#EXT-X-ENDLIST', ''].join(
        '\n',
      ),
      'application/vnd.apple.mpegurl',
    ];
  }

  if (resolution === undefined) {
    return ['#EXTM3U\n', 'application/vnd.apple.mpegurl'];
  }

  return [
    [
      '#EXTM3U',
      `#EXT-X-STREAM-INF:BANDWIDTH=${resolution.bandwidth},RESOLUTION=${resolution.width}x${resolution.height}`,
      'v0.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=854x480',
      'v1.m3u8',
      '',
    ].join('\n'),
    'application/vnd.apple.mpegurl',
  ];
}

/**
 * 创建假 fetch。
 *
 * @return 与 `fetch` 同签名的函数
 */
export function createMockFetch(): typeof fetch {
  const mock = async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const bucket = fnv1a(url) % BUCKETS;

    // 0：网络层直接失败（模拟 DNS/连接被重置）
    if (bucket === 0) {
      throw new TypeError('fetch failed (mock: network unreachable)');
    }
    // 1：超时
    if (bucket === 1) {
      const error = new Error('mock timeout');
      error.name = 'TimeoutError';
      throw error;
    }
    // 2：404
    if (bucket === 2) {
      return new Response('#EXTM3U\n', {
        status: 404,
        headers: { 'content-type': 'application/vnd.apple.mpegurl' },
      });
    }
    // 3：空响应
    if (bucket === 3) {
      return new Response(null, { status: 200, headers: { 'content-type': 'video/mp2t' } });
    }

    if (/\.m3u8(\?|$)/i.test(url)) {
      const [body, contentType] = buildPlaylist(url);
      return new Response(body, { status: 200, headers: { 'content-type': contentType } });
    }

    const bytes = new Uint8Array(MOCK_SEGMENT_BYTES);
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = (index * 7 + bucket) % 256;
    }
    return new Response(bytes, { status: 200, headers: { 'content-type': 'video/mp2t' } });
  };

  return mock as unknown as typeof fetch;
}
