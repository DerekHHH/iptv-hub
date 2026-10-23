/**
 * @file 本机服务（scripts/serve.mjs）测试：路由解析、目录穿越防护、赛事统计、HTTP 接口。
 */

import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { countLiveEntries, createServeServer, resolveStaticPath } from '../scripts/serve.mjs';

const SAMPLE_LIVE_TXT = `足球|高清,#genre#
上海海港B队 vs 杭州临平吴越,http://192.168.1.7:18765/play/aaa
劳德代尔堡女足 vs 卡罗莱纳攀登女足,http://192.168.1.7:18765/play/bbb

足球|赛场原声,#genre#
奥林匹亚科斯 vs 布拉格斯巴达|完场,http://192.168.1.7:18765/play/ccc
`;

describe('resolveStaticPath', () => {
  const dirs = { pagesDir: '/tmp/pages', liveDir: '/tmp/live' };
  // 服务端会用 resolve() 归一化目录（Windows 上会补盘符），断言必须同样归一化
  const pages = resolve('/tmp/pages');
  const live = resolve('/tmp/live');

  it('普通路径落在 pages 目录下', () => {
    expect(resolveStaticPath('/stats.json', dirs)).toBe(resolve(pages, 'stats.json'));
  });

  it('多级路径正常拼接', () => {
    expect(resolveStaticPath('/txt/all.txt', dirs)).toBe(resolve(pages, 'txt', 'all.txt'));
  });

  it('/live/* 走赛事目录（不走 pages 副本，保证刷新后立即可见）', () => {
    expect(resolveStaticPath('/live/live.txt', dirs)).toBe(resolve(live, 'live.txt'));
  });

  it('拒绝目录穿越（原始与编码两种写法）', () => {
    expect(resolveStaticPath('/../package.json', dirs)).toBeNull();
    expect(resolveStaticPath('/%2e%2e/package.json', dirs)).toBeNull();
    expect(resolveStaticPath('/txt/../../secret', dirs)).toBeNull();
    expect(resolveStaticPath('/live/../../secret', dirs)).toBeNull();
  });

  it('拒绝含空字节的路径', () => {
    expect(resolveStaticPath('/a%00.txt', dirs)).toBeNull();
  });

  it('忽略 query string', () => {
    expect(resolveStaticPath('/stats.json?t=123', dirs)).toBe(resolve(pages, 'stats.json'));
  });
});

describe('countLiveEntries', () => {
  it('分开统计场数、线路数与直播中场数', () => {
    const result = countLiveEntries(SAMPLE_LIVE_TXT);
    // 3 条线路、3 个不同台名、2 场正在直播（完场的不算）
    expect(result.lines).toBe(3);
    expect(result.matches).toBe(3);
    expect(result.liveNow).toBe(2);
  });

  it('空清单返回全 0，不抛异常', () => {
    expect(countLiveEntries('')).toEqual({ matches: 0, lines: 0, liveNow: 0 });
  });

  it('分组头不算线路', () => {
    expect(countLiveEntries('足球,#genre#\n').lines).toBe(0);
  });
});

describe('本机服务 HTTP 接口', () => {
  let pagesDir = '';
  let liveDir = '';

  beforeAll(async () => {
    const root = await mkdtemp(join(tmpdir(), 'iptv-serve-'));
    pagesDir = join(root, 'pages-out');
    liveDir = join(root, 'live');
    await mkdir(join(pagesDir, 'txt'), { recursive: true });
    await mkdir(liveDir, { recursive: true });
    await writeFile(join(pagesDir, 'index.html'), '<html>ok</html>', 'utf8');
    await writeFile(join(pagesDir, 'stats.json'), '{"channel_count":7}', 'utf8');
    await writeFile(join(pagesDir, 'txt', 'all.txt'), '央视,#genre#', 'utf8');
    await writeFile(join(liveDir, 'live.txt'), SAMPLE_LIVE_TXT, 'utf8');

    const scoped = createServeServer({
      autoPull: false,
      host: '127.0.0.1',
      port: 0,
      pagesDir,
      liveDir,
      liveCommand: ['node', ['-e', 'process.exit(0)']],
    });
    await new Promise<void>((done) => scoped.server.listen(0, '127.0.0.1', done));
    await new Promise<void>((done) => scoped.server.close(() => done()));
  });

  /** 起一个真实监听的服务供用例使用。 */
  async function withServer<T>(fn: (url: string) => Promise<T>): Promise<T> {
    const scoped = createServeServer({
      autoPull: false,
      host: '127.0.0.1',
      port: 0,
      pagesDir,
      liveDir,
      liveCommand: ['node', ['-e', 'process.exit(0)']],
    });
    await new Promise<void>((done) => scoped.server.listen(0, '127.0.0.1', done));
    const url = `http://127.0.0.1:${(scoped.server.address() as AddressInfo).port}`;
    try {
      return await fn(url);
    } finally {
      await new Promise<void>((done) => scoped.server.close(() => done()));
    }
  }

  it('GET /api/health 返回本机模式标识', async () => {
    await withServer(async (url) => {
      const response = await fetch(`${url}/api/health`);
      expect(response.status).toBe(200);
      const data = (await response.json()) as { ok: boolean; mode: string };
      expect(data.ok).toBe(true);
      expect(data.mode).toBe('local');
    });
  });

  it('静态文件按扩展名给正确 Content-Type', async () => {
    await withServer(async (url) => {
      const html = await fetch(`${url}/`);
      expect(html.headers.get('content-type')).toContain('text/html');

      const json = await fetch(`${url}/stats.json`);
      expect(json.headers.get('content-type')).toContain('application/json');
      expect(((await json.json()) as { channel_count: number }).channel_count).toBe(7);

      const txt = await fetch(`${url}/txt/all.txt`);
      expect(txt.headers.get('content-type')).toContain('text/plain');
    });
  });

  it('/live/live.txt 从赛事目录读，改产物后立即可见', async () => {
    await withServer(async (url) => {
      const first = await fetch(`${url}/live/live.txt`);
      expect(first.status).toBe(200);
      expect(await first.text()).toContain('上海海港B队');

      await writeFile(join(liveDir, 'live.txt'), '篮球,#genre#\n新赛事,http://x/1\n', 'utf8');
      const second = await fetch(`${url}/live/live.txt`);
      expect(await second.text()).toContain('新赛事');
      await writeFile(join(liveDir, 'live.txt'), SAMPLE_LIVE_TXT, 'utf8');
    });
  });

  it('不存在的带扩展名文件返回 404', async () => {
    await withServer(async (url) => {
      const response = await fetch(`${url}/nope.txt`);
      expect(response.status).toBe(404);
    });
  });

  it('深链回退到 index.html（HashRouter 兜底）', async () => {
    await withServer(async (url) => {
      const response = await fetch(`${url}/channels/anything`);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('ok');
    });
  });

  it('目录穿越请求不会泄露文件内容', async () => {
    await withServer(async (url) => {
      // 注意：fetch 客户端会把 %2e%2e 规范化成 .. 再发出去，服务端看到的是 /package.json。
      // 所以这里断言"拿不到内容"即可；真正的路径解析防护由 resolveStaticPath 单测覆盖。
      const response = await fetch(`${url}/%2e%2e/package.json`);
      expect(response.status).not.toBe(200);
      expect(await response.text()).not.toContain('iptv_source_hub');
    });
  });

  it('GET /api/live/status 初始为空但可用', async () => {
    await withServer(async (url) => {
      const response = await fetch(`${url}/api/live/status`);
      expect(response.status).toBe(200);
      const data = (await response.json()) as { running: boolean; last: unknown };
      expect(data.running).toBe(false);
      expect(data.last).toBeNull();
    });
  });

  it('GET 方式调刷新接口返回 405', async () => {
    await withServer(async (url) => {
      const response = await fetch(`${url}/api/live/refresh`);
      expect(response.status).toBe(405);
    });
  });

  it('POST /api/live/refresh 跑完刷新并回传统计', async () => {
    await withServer(async (url) => {
      const response = await fetch(`${url}/api/live/refresh`, { method: 'POST' });
      expect(response.status).toBe(200);
      const data = (await response.json()) as {
        ok: boolean;
        matches: number;
        lines: number;
        liveNow: number;
        durationMs: number;
      };
      expect(data.ok).toBe(true);
      expect(data.lines).toBe(3);
      expect(data.liveNow).toBe(2);
      expect(typeof data.durationMs).toBe('number');
    });
  });

  it('刷新命令失败时返回 500 与原因，且不崩服务', async () => {
    await withServer(async (url) => {
      const failing = createServeServer({
        autoPull: false,
        host: '127.0.0.1',
        port: 0,
        pagesDir,
        liveDir,
        liveCommand: ['node', ['-e', 'process.exit(3)']],
      });
      await new Promise<void>((done) => failing.server.listen(0, '127.0.0.1', done));
      const failUrl = `http://127.0.0.1:${(failing.server.address() as AddressInfo).port}`;
      const response = await fetch(`${failUrl}/api/live/refresh`, { method: 'POST' });
      expect(response.status).toBe(500);
      const data = (await response.json()) as { ok: boolean; message?: string };
      expect(data.ok).toBe(false);
      expect(typeof data.message).toBe('string');
      // 服务本身还活着
      expect((await fetch(`${failUrl}/api/health`)).status).toBe(200);
      await new Promise<void>((done) => failing.server.close(() => done()));
    });
  });

  it('GET /api/state 返回两个开关的状态', async () => {
    await withServer(async (url) => {
      const response = await fetch(`${url}/api/state`);
      expect(response.status).toBe(200);
      const data = (await response.json()) as { web: string; live: string };
      expect(['on', 'off']).toContain(data.web);
      expect(['on', 'off']).toContain(data.live);
    });
  });

  it('POST /api/state 改开关并落盘到状态文件', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'iptv-state-'));
    await withServer(async (url) => {
      const scoped = createServeServer({
        autoPull: false,
        host: '127.0.0.1',
        port: 0,
        pagesDir,
        liveDir,
        stateDir,
      });
      await new Promise<void>((done) => scoped.server.listen(0, '127.0.0.1', done));
      const scopedUrl = `http://127.0.0.1:${(scoped.server.address() as AddressInfo).port}`;
      try {
        const response = await fetch(`${scopedUrl}/api/state`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ target: 'live', value: 'off' }),
        });
        expect(response.status).toBe(200);
        const data = (await response.json()) as { ok: boolean; target: string; value: string };
        expect(data.ok).toBe(true);
        expect(data.target).toBe('live');
        expect(data.value).toBe('off');

        // 状态文件真的写了
        const onDisk = (await readFile(join(stateDir, 'live.state'), 'utf8')).trim();
        expect(onDisk).toBe('off');

        // 再读回来应该是 off
        const readBack = (await (await fetch(`${scopedUrl}/api/state`)).json()) as { live: string };
        expect(readBack.live).toBe('off');
      } finally {
        await new Promise<void>((done) => scoped.server.close(() => done()));
      }
    });
  });

  it('POST /api/state 收到非法 JSON 返回 400', async () => {
    await withServer(async (url) => {
      const response = await fetch(`${url}/api/state`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not-json',
      });
      expect(response.status).toBe(400);
    });
  });
});