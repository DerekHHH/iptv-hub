#!/usr/bin/env node
/**
 * @file 第 2 轮回归：R3「降级也要进历史」的独立端到端复验。
 *
 * 为什么要独立进程：`src/main.ts` 的产物路径是相对路径，只有把 cwd 挪进沙盒
 * 才能验证"降级不覆盖旧产物 + 历史落盘"两件事同时成立。
 *
 * 覆盖：
 *   H1 上游失败率 ≥50% 降级 → history 末条 stale=true、计数为上一版
 *   H2 候选源不足降级 → 同上
 *   H3 连续两次降级 → 历史累积两条（不是覆盖）
 *   H4 测活阶段抛异常（顶层 wrapper 兜底）→ 也应有 stale 历史
 *
 * 用法：npx tsx tests/qa/p2-regress-history.ts
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const WORK_ROOT = join(REPO_ROOT, '.tmp', 'qa-p2-history');

/** 25 个频道，保证正常路径能过 DEGRADE 的各项下限。 */
const NAMES = [
  'CCTV1', 'CCTV2', 'CCTV3', 'CCTV4', 'CCTV5', 'CCTV6', 'CCTV7', 'CCTV8', 'CCTV9', 'CCTV10',
  'CCTV11', 'CCTV12', 'CCTV13', 'CCTV14', '广东珠江', '广州综合', '深圳都市', '翡翠台', '明珠台',
  '凤凰卫视', '湖南卫视', '浙江卫视', '江苏卫视', '东方卫视', '北京卫视',
];

const SENTINEL = {
  txt: '港澳台,#genre#\n哨兵频道,http://sentinel.local/old.m3u8\n',
  m3u: '#EXTM3U\n#EXTINF:-1 tvg-id="sentinel" tvg-name="哨兵" tvg-logo="" group-title="港澳台",哨兵\nhttp://sentinel.local/old.m3u8\n',
  epg: '<?xml version="1.0" encoding="UTF-8"?>\n<tv>\n  <channel id="sentinel">\n    <display-name>哨兵</display-name>\n  </channel>\n</tv>\n',
};

/** 一条历史记录。 */
interface HistoryItem {
  updated_at: string;
  channel_count: number;
  source_count: number;
  stale: boolean;
  stale_reason?: string;
}

/** 校验结果。 */
interface CheckItem {
  name: string;
  ok: boolean;
  detail: string;
}

const checks: CheckItem[] = [];

/**
 * 记录一条检查。
 *
 * @param name 检查项
 * @param ok 是否通过
 * @param detail 实际值
 */
function check(name: string, ok: boolean, detail: string): void {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  →  ${detail}`);
}

/** 造 DIYP txt。 */
function buildTxt(names: readonly string[]): string {
  return `${names.map((name, index) => `${name},http://qa.local/live/${index}.m3u8`).join('\n')}\n`;
}

/** 造"上一版 stats"（channel_count 由参数控制）。 */
function prevStats(channelCount: number): string {
  return JSON.stringify(
    {
      version: 1,
      updated_at: '2020-01-01T00:00:00+08:00',
      channel_count: channelCount,
      source_count: 500,
      groups: { 港澳台: 40, 广东: 40, 央视: 40, 卫视: 40, 其他: 40 },
      upstream: [],
      fetch_fail_rate: 0,
      probe: { total: 0, alive: 0, dead: 0, timeout: 0, skipped: 0, duration_ms: 0 },
      epg: { ok: false, programmes: 0 },
      build_duration_ms: 1,
      stale: false,
    },
    null,
    2,
  );
}

/** 假 fetch 配置。 */
interface FetchOptions {
  doc: string;
  failPattern?: RegExp;
}

/** 造假 fetch。 */
function makeFetch(opts: FetchOptions): typeof fetch {
  const mock = async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (/raw\.githubusercontent\.com|cdn\.jsdelivr\.net/.test(url)) {
      if (opts.failPattern !== undefined && opts.failPattern.test(url)) {
        throw new TypeError('fetch failed (qa: upstream unreachable)');
      }
      return new Response(opts.doc, { status: 200, headers: { 'content-type': 'text/plain' } });
    }
    if (/epg|xmltv/i.test(url)) {
      throw new TypeError('fetch failed (qa: epg unreachable)');
    }
    return new Response(new Uint8Array(752), { status: 200, headers: { 'content-type': 'video/mp2t' } });
  };
  return mock as unknown as typeof fetch;
}

/** 准备沙盒。 */
async function prepare(name: string, prevChannelCount: number): Promise<string> {
  const dir = join(WORK_ROOT, name);
  await rm(dir, { recursive: true, force: true });
  for (const sub of ['dist/txt', 'dist/m3u', 'dist/epg', 'data', 'custom']) {
    await mkdir(join(dir, sub), { recursive: true });
  }
  await writeFile(join(dir, 'dist', 'txt', 'all.txt'), SENTINEL.txt, 'utf8');
  await writeFile(join(dir, 'dist', 'm3u', 'all.m3u'), SENTINEL.m3u, 'utf8');
  await writeFile(join(dir, 'dist', 'epg', 'epg.xml'), SENTINEL.epg, 'utf8');
  await writeFile(join(dir, 'dist', 'stats.json'), prevStats(prevChannelCount), 'utf8');
  return dir;
}

/** 读历史文件（不存在返回 null）。 */
async function readHistory(dir: string): Promise<{ version: number; items: HistoryItem[] } | null> {
  const path = join(dir, 'data', 'history.json');
  if (!existsSync(path)) {
    return null;
  }
  return JSON.parse(await readFile(path, 'utf8')) as { version: number; items: HistoryItem[] };
}

/** 产物是否未被覆盖。 */
async function untouched(dir: string): Promise<boolean> {
  const txt = await readFile(join(dir, 'dist', 'txt', 'all.txt'), 'utf8');
  const m3u = await readFile(join(dir, 'dist', 'm3u', 'all.m3u'), 'utf8');
  const epg = await readFile(join(dir, 'dist', 'epg', 'epg.xml'), 'utf8');
  return txt === SENTINEL.txt && m3u === SENTINEL.m3u && epg === SENTINEL.epg;
}

/** 主流程。 */
async function main(): Promise<void> {
  const { run, main: entryMain } = await import('../../src/main');

  await mkdir(WORK_ROOT, { recursive: true });
  const originalCwd = process.cwd();
  const realNow = Date.now;

  // ---------------- H1 上游失败率 ≥50% ----------------
  {
    const dir = await prepare('h1-fetch-fail', 200);
    process.chdir(dir);
    const stats = await run({
      fetchImpl: makeFetch({ doc: buildTxt(NAMES), failPattern: /streams\/(cn|hk|tw)\.m3u/ }),
    });
    const history = await readHistory(dir);
    const last = history?.items.at(-1);

    check('H1 降级构建写出了 history.json', history !== null, history === null ? '缺失' : `${history.items.length} 条`);
    check('H1 历史末条 stale === true', last?.stale === true, `stale=${String(last?.stale)}`);
    check('H1 历史末条带 stale_reason', (last?.stale_reason ?? '').includes('失败率'), String(last?.stale_reason));
    check(
      'H1 历史 channel_count 为回填的上一版（200，不是 0/空）',
      last?.channel_count === 200 && stats.channel_count === 200,
      `history=${String(last?.channel_count)} / stats=${String(stats.channel_count)}`,
    );
    check('H1 历史 source_count 为回填的上一版（500）', last?.source_count === 500, String(last?.source_count));
    check('H1 降级仍不覆盖旧产物', await untouched(dir), 'txt/m3u/epg 均为哨兵');
    process.chdir(originalCwd);
  }

  // ---------------- H2 候选源不足 ----------------
  {
    const dir = await prepare('h2-few-candidates', 200);
    process.chdir(dir);
    await run({ fetchImpl: makeFetch({ doc: buildTxt(['CCTV1', 'CCTV2', 'CCTV3']) }) });
    const history = await readHistory(dir);
    const last = history?.items.at(-1);

    check('H2 候选不足降级也写历史', history !== null && last?.stale === true, history === null ? '缺失' : `stale=${String(last?.stale)}`);
    check('H2 历史末条 stale_reason 含"候选源"', (last?.stale_reason ?? '').includes('候选源'), String(last?.stale_reason));
    check('H2 计数为上一版 200', last?.channel_count === 200, String(last?.channel_count));
    process.chdir(originalCwd);
  }

  // ---------------- H3 连续两次降级累积 ----------------
  {
    const dir = await prepare('h3-double-stale', 200);
    process.chdir(dir);
    const failing = () => makeFetch({ doc: buildTxt(NAMES), failPattern: /streams\/(cn|hk|tw)\.m3u/ });
    await run({ fetchImpl: failing() });
    const afterFirst = await readHistory(dir);
    await run({ fetchImpl: failing() });
    const afterSecond = await readHistory(dir);

    check('H3 第一次降级后 1 条历史', afterFirst?.items.length === 1, String(afterFirst?.items.length));
    check('H3 第二次降级后 2 条历史（累积不是覆盖）', afterSecond?.items.length === 2, String(afterSecond?.items.length));
    check(
      'H3 两条历史都标记 stale=true',
      afterSecond !== null && afterSecond.items.every((item) => item.stale === true),
      JSON.stringify(afterSecond?.items.map((item) => item.stale)),
    );
    process.chdir(originalCwd);
  }

  // ---------------- H4 测活阶段抛异常（顶层 wrapper 兜底） ----------------
  {
    const dir = await prepare('h4-probe-throw', 30);
    process.chdir(dir);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = makeFetch({ doc: buildTxt(NAMES) });
    Date.now = function patchedNow(): number {
      const stack = new Error().stack ?? '';
      if (/probe[\\/]+probe\.ts/.test(stack)) {
        throw new Error('QA 注入：测活阶段崩溃');
      }
      return realNow();
    };
    let wrapperThrew: unknown = null;
    try {
      await entryMain();
    } catch (error) {
      wrapperThrew = error;
    }
    Date.now = realNow;
    globalThis.fetch = originalFetch;

    const history = await readHistory(dir);
    const last = history?.items.at(-1);
    const stats = JSON.parse(await readFile(join(dir, 'dist', 'stats.json'), 'utf8')) as {
      stale?: boolean;
      stale_reason?: string;
    };

    check('H4 wrapper 不向外抛', wrapperThrew === null, wrapperThrew === null ? '正常返回' : String(wrapperThrew));
    check('H4 wrapper 写了 stale stats', stats.stale === true, `stale=${String(stats.stale)}, reason=${String(stats.stale_reason)}`);
    check(
      'H4 wrapper 兜底也写了 stale 历史（P2-3 完整修复的判据）',
      history !== null && last?.stale === true,
      history === null ? 'history.json 缺失' : `stale=${String(last?.stale)}`,
    );
    check('H4 异常时仍不覆盖旧产物', await untouched(dir), 'txt/m3u/epg 均为哨兵');
    process.chdir(originalCwd);
  }

  const failed = checks.filter((item) => !item.ok).length;
  console.log(`\n合计 ${checks.length} 项，通过 ${checks.length - failed}，失败 ${failed}`);
  process.exitCode = failed === 0 ? 0 : 1;
}

await main();
