#!/usr/bin/env node
/**
 * @file QA 独立端到端降级验证（对应验收任务 C5）。
 *
 * 为什么用独立进程 + chdir：`src/main.ts` 的产物路径是相对路径常量（`dist/txt/all.txt`），
 * 只有把进程工作目录挪到临时目录，才能在不污染真实 `dist/` 的前提下验证
 * 「降级时绝不覆盖上一版 txt/m3u/epg」。
 *
 * 覆盖 6 个场景：
 *   S0 健康构建（对照组：必须真的覆盖产物，否则后面"没被覆盖"是假通过）
 *   S1 上游抓取失败率 ≥50%
 *   S2 候选源低于阈值
 *   S3 输出频道数 < 上次的 60%
 *   S4 测活阶段抛异常 → 顶层 wrapper 写 stale stats、不向外抛、不覆盖产物
 *   S5 真实入口进程（tsx src/main.ts）在异常下仍 exit 0
 *
 * 用法：npx tsx tests/qa/degrade-e2e.ts
 * 退出码：0 = 全通过，1 = 有失败。
 */

import { execFile } from 'node:child_process';
import { cp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const WORK_ROOT = join(REPO_ROOT, '.tmp', 'qa-degrade-e2e');

/** S0/S3 用的 25 个频道（分属 5 个分组，保证 ≥ DEGRADE.minChannels 与 minSourceCount）。 */
const CHANNEL_NAMES = [
  'CCTV1', 'CCTV2', 'CCTV3', 'CCTV4', 'CCTV5', 'CCTV6', 'CCTV7', 'CCTV8', 'CCTV9', 'CCTV10',
  'CCTV11', 'CCTV12', 'CCTV13', 'CCTV14', '广东珠江', '广州综合', '深圳都市', '翡翠台', '明珠台',
  '凤凰卫视', '湖南卫视', '浙江卫视', '江苏卫视', '东方卫视', '北京卫视',
];

/** 哨兵产物内容：文件里还能读到它，就说明没被覆盖。 */
const SENTINEL = {
  txt: '港澳台,#genre#\n哨兵频道,http://sentinel.local/old.m3u8\n',
  m3u: '#EXTM3U\n#EXTINF:-1 tvg-id="sentinel" tvg-name="哨兵" tvg-logo="" group-title="港澳台",哨兵\nhttp://sentinel.local/old.m3u8\n',
  epg: '<?xml version="1.0" encoding="UTF-8"?>\n<tv>\n  <channel id="sentinel">\n    <display-name>哨兵</display-name>\n  </channel>\n</tv>\n',
};

/**
 * 造一份"上一版 stats"。
 *
 * @param channelCount 上次构建的频道数
 * @return JSON 文本
 */
function sentinelStats(channelCount: number): string {
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

/** 一条校验结论。 */
interface CheckItem {
  name: string;
  ok: boolean;
  detail: string;
}

/** stats.json 里本脚本关心的字段。 */
interface StatsFile {
  stale?: boolean;
  stale_reason?: string;
  channel_count?: number;
  source_count?: number;
  updated_at?: string;
  fetch_fail_rate?: number;
}

/** 校验结果。 */
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

/** 造一段 DIYP txt（每行一个频道一个源）。 */
function buildTxt(names: readonly string[]): string {
  return `${names.map((name, index) => `${name},http://qa.local/live/${index}.m3u8`).join('\n')}\n`;
}

/** 假 fetch 的配置。 */
interface FetchMockOptions {
  /** 上游正文 */
  upstreamDoc: string;
  /** 命中的上游 URL 一律失败 */
  failPattern?: RegExp;
}

/**
 * 造一个假 fetch。
 *
 * @param opts.upstreamDoc 上游正文
 * @param opts.failPattern 命中的上游 URL（正则）一律失败，其余成功
 * @return 与 fetch 同签名的函数
 */
function makeFetch(opts: FetchMockOptions): typeof fetch {
  const mock = async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

    if (/raw\.githubusercontent\.com|cdn\.jsdelivr\.net/.test(url)) {
      if (opts.failPattern !== undefined && opts.failPattern.test(url)) {
        throw new TypeError('fetch failed (qa: upstream unreachable)');
      }
      return new Response(opts.upstreamDoc, { status: 200, headers: { 'content-type': 'text/plain' } });
    }
    if (/epg|xmltv/i.test(url)) {
      throw new TypeError('fetch failed (qa: epg unreachable)');
    }
    const bytes = new Uint8Array(188 * 4);
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = (index * 7) % 256;
    }
    return new Response(bytes, { status: 200, headers: { 'content-type': 'video/mp2t' } });
  };
  return mock as unknown as typeof fetch;
}

/**
 * 准备一个带哨兵产物的沙盒目录。
 *
 * @param name 场景名
 * @param prevChannelCount 上一版 stats 的频道数；null 表示没有上一版
 * @return 目录绝对路径
 */
async function prepareSandbox(name: string, prevChannelCount: number | null): Promise<string> {
  const dir = join(WORK_ROOT, name);
  await rm(dir, { recursive: true, force: true });
  for (const sub of ['dist/txt', 'dist/m3u', 'dist/epg', 'data', 'custom']) {
    await mkdir(join(dir, sub), { recursive: true });
  }
  await writeFile(join(dir, 'dist', 'txt', 'all.txt'), SENTINEL.txt, 'utf8');
  await writeFile(join(dir, 'dist', 'm3u', 'all.m3u'), SENTINEL.m3u, 'utf8');
  await writeFile(join(dir, 'dist', 'epg', 'epg.xml'), SENTINEL.epg, 'utf8');
  await writeFile(
    join(dir, 'dist', 'stats.json'),
    prevChannelCount === null ? '{}' : sentinelStats(prevChannelCount),
    'utf8',
  );
  return dir;
}

/**
 * 判断三个产物是否仍是哨兵内容。
 *
 * @param dir 沙盒目录
 * @return 各产物是否未被覆盖
 */
async function productsUntouched(dir: string): Promise<{ txt: boolean; m3u: boolean; epg: boolean }> {
  const txt = await readFile(join(dir, 'dist', 'txt', 'all.txt'), 'utf8');
  const m3u = await readFile(join(dir, 'dist', 'm3u', 'all.m3u'), 'utf8');
  const epg = await readFile(join(dir, 'dist', 'epg', 'epg.xml'), 'utf8');
  return { txt: txt === SENTINEL.txt, m3u: m3u === SENTINEL.m3u, epg: epg === SENTINEL.epg };
}

/** 读取 dist/stats.json。 */
async function readStats(dir: string): Promise<StatsFile> {
  return JSON.parse(await readFile(join(dir, 'dist', 'stats.json'), 'utf8'));
}

/**
 * 在「测活模块内部取时间」时抛异常 —— 精准注入 L4 阶段崩溃，不影响 undici 内部对 Date.now 的调用。
 *
 * @param realNow 原始 Date.now
 * @return 包装后的 Date.now
 */
function makeProbeExplodingNow(realNow: () => number): () => number {
  return function patchedNow() {
    const stack = new Error().stack ?? '';
    // Windows 用反斜杠、POSIX 用斜杠，两种都要认
    if (/probe[\\/]+probe\.ts/.test(stack)) {
      throw new Error('QA 注入：测活阶段崩溃');
    }
    return realNow();
  };
}

/** 主流程。 */
async function main() {
  const { run, main: entryMain } = await import('../../src/main');

  await mkdir(WORK_ROOT, { recursive: true });
  const originalCwd = process.cwd();
  const realNow = Date.now;

  // ---------------- S0 健康构建（对照组） ----------------
  {
    const dir = await prepareSandbox('s0-healthy', null);
    process.chdir(dir);

    const stats = await run({ fetchImpl: makeFetch({ upstreamDoc: buildTxt(CHANNEL_NAMES) }) });
    const untouched = await productsUntouched(dir);
    const onDisk = await readStats(dir);

    check('S0 健康构建不降级', stats.stale === false, `stale=${stats.stale}`);
    check(
      'S0 健康构建确实覆盖了 txt/m3u/epg（对照组前提）',
      untouched.txt === false && untouched.m3u === false && untouched.epg === false,
      `未被覆盖情况=${JSON.stringify(untouched)}`,
    );
    check('S0 输出 25 个频道 / 25 条源', stats.channel_count === 25 && stats.source_count === 25, `channels=${stats.channel_count}, sources=${stats.source_count}`);
    check('S0 stats.json 落盘且 stale=false', onDisk.stale === false && onDisk.channel_count === 25, `channel_count=${onDisk.channel_count}`);
    check('S0 写入了 history.json', existsSync(join(dir, 'data', 'history.json')), existsSync(join(dir, 'data', 'history.json')) ? '存在' : '缺失');
    process.chdir(originalCwd);
  }

  // ---------------- S1 上游失败率 ≥ 50% ----------------
  {
    const dir = await prepareSandbox('s1-fetch-fail', 200);
    process.chdir(dir);

    // 6 个上游里挂掉 3 个（iptv-org 的 cn / hk / tw）→ 失败率正好 50%
    const stats = await run({
      fetchImpl: makeFetch({
        upstreamDoc: buildTxt(CHANNEL_NAMES),
        failPattern: /streams\/(cn|hk|tw)\.m3u/,
      }),
    });
    const untouched = await productsUntouched(dir);

    check('S1 上游失败率 ≥50% → stale', stats.stale === true, `stale=${stats.stale}, fetch_fail_rate=${stats.fetch_fail_rate}`);
    check('S1 失败率确实 ≥0.5', Number(stats.fetch_fail_rate) >= 0.5, `fetch_fail_rate=${stats.fetch_fail_rate}`);
    check('S1 降级原因写明"失败率"', String(stats.stale_reason).includes('失败率'), String(stats.stale_reason));
    check('S1 未覆盖上一版 txt/m3u/epg', untouched.txt && untouched.m3u && untouched.epg, JSON.stringify(untouched));
    check('S1 保留上一版 updated_at', stats.updated_at === '2020-01-01T00:00:00+08:00', String(stats.updated_at));
    check('S1 保留上一版 channel_count', stats.channel_count === 200, String(stats.channel_count));
    process.chdir(originalCwd);
  }

  // ---------------- S2 候选源低于阈值 ----------------
  {
    const dir = await prepareSandbox('s2-few-candidates', 200);
    process.chdir(dir);

    const stats = await run({ fetchImpl: makeFetch({ upstreamDoc: buildTxt(['CCTV1', 'CCTV2', 'CCTV3']) }) });
    const untouched = await productsUntouched(dir);

    check('S2 候选源不足 → stale', stats.stale === true, `stale=${stats.stale}`);
    check('S2 降级原因写明"候选源"', String(stats.stale_reason).includes('候选源'), String(stats.stale_reason));
    check('S2 未覆盖上一版产物', untouched.txt && untouched.m3u && untouched.epg, JSON.stringify(untouched));
    process.chdir(originalCwd);
  }

  // ---------------- S3 输出频道数 < 上次 60% ----------------
  {
    const dir = await prepareSandbox('s3-channel-drop', 200);
    process.chdir(dir);

    // 上次 200 个，这次 25 个（25 < 200*0.6=120）
    const stats = await run({ fetchImpl: makeFetch({ upstreamDoc: buildTxt(CHANNEL_NAMES) }) });
    const untouched = await productsUntouched(dir);

    check('S3 频道数低于上次 60% → stale', stats.stale === true, `stale=${stats.stale}, channel_count=${stats.channel_count}`);
    check('S3 降级原因写明"上次"', String(stats.stale_reason).includes('上次'), String(stats.stale_reason));
    check('S3 未覆盖上一版产物', untouched.txt && untouched.m3u && untouched.epg, JSON.stringify(untouched));
    check('S3 stats.channel_count 回填为上一版（200）', stats.channel_count === 200, String(stats.channel_count));
    process.chdir(originalCwd);
  }

  // ---------------- S4 测活阶段抛异常 → 顶层 wrapper ----------------
  {
    const dir = await prepareSandbox('s4-probe-throw', 30);
    process.chdir(dir);

    // 先证明注入确实能让 run() 抛出（否则 S4 的 wrapper 断言是假通过）
    Date.now = makeProbeExplodingNow(realNow);
    let runThrew: unknown = null;
    try {
      await run({ fetchImpl: makeFetch({ upstreamDoc: buildTxt(CHANNEL_NAMES) }) });
    } catch (error) {
      runThrew = error;
    }
    Date.now = realNow;
    const runThrewMessage = runThrew instanceof Error ? runThrew.message : String(runThrew);
    check(
      'S4 注入有效：run() 在测活阶段确实抛出',
      runThrewMessage.includes('测活阶段崩溃'),
      runThrew === null ? '未抛出' : runThrewMessage,
    );

    // 再让顶层 wrapper 面对同一个异常：main() 走 run() 的默认依赖（全局 fetch / Date.now）
    const originalFetch = globalThis.fetch;
    globalThis.fetch = makeFetch({ upstreamDoc: buildTxt(CHANNEL_NAMES) });
    Date.now = makeProbeExplodingNow(realNow);
    let wrapperThrew: unknown = null;
    try {
      await entryMain();
    } catch (error) {
      wrapperThrew = error;
    }
    Date.now = realNow;
    globalThis.fetch = originalFetch;

    const untouched = await productsUntouched(dir);
    const stats = await readStats(dir);

    check('S4 顶层 wrapper 不向外抛异常', wrapperThrew === null, wrapperThrew === null ? '正常返回' : String(wrapperThrew));
    check('S4 wrapper 写出 stale=true 的 stats.json', stats.stale === true, `stale=${stats.stale}`);
    check('S4 stale_reason 记录异常原因', String(stats.stale_reason ?? '').includes('构建异常'), String(stats.stale_reason));
    check('S4 异常时未覆盖上一版 txt/m3u/epg', untouched.txt && untouched.m3u && untouched.epg, JSON.stringify(untouched));
    check('S4 兜底 stats 保留上一版数据时间', stats.updated_at === '2020-01-01T00:00:00+08:00', String(stats.updated_at));
    process.chdir(originalCwd);
  }

  // ---------------- S5 真实入口进程的退出码 ----------------
  {
    const dir = join(WORK_ROOT, 's5-exit-code');
    await rm(dir, { recursive: true, force: true });
    for (const sub of ['dist', 'data', 'custom', 'tests']) {
      await mkdir(join(dir, sub), { recursive: true });
    }
    // src 用 junction 指回真实源码；fixtures 复制一份（MOCK 模式需要）
    await symlink(join(REPO_ROOT, 'src'), join(dir, 'src'), 'junction');
    await cp(join(REPO_ROOT, 'tests', 'fixtures'), join(dir, 'tests', 'fixtures'), { recursive: true });
    // 上一版频道数取 30：mock 产物约 27 个频道，不会触发"骤降 60%"分支
    await writeFile(join(dir, 'dist', 'stats.json'), sentinelStats(30), 'utf8');
    // 把 dist/txt 做成"普通文件"，让 emit 阶段写文件必然失败 → run() 抛异常 → 走顶层 wrapper
    await writeFile(join(dir, 'dist', 'txt'), '这不是目录', 'utf8');

    const result = await execFileAsync(
      process.execPath,
      [join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'src/main.ts'],
      { cwd: dir, env: { ...process.env, MOCK_MODE: '1' }, encoding: 'utf8' },
    ).then(
      (execResult) => ({ code: 0, output: `${execResult.stdout ?? ''}${execResult.stderr ?? ''}` }),
      (error) => ({ code: error.code ?? -1, output: `${error.stdout ?? ''}${error.stderr ?? ''}` }),
    );

    const statsPath = join(dir, 'dist', 'stats.json');
    const stats: StatsFile | null = existsSync(statsPath)
      ? (JSON.parse(await readFile(statsPath, 'utf8')) as StatsFile)
      : null;
    const wrapperLogged = result.output.includes('构建异常');

    check('S5 产物写出失败时进程仍 exit 0（定时任务不飘红）', result.code === 0, `exit code = ${result.code}`);
    check('S5 日志里出现"构建异常"（确实走到了 wrapper）', wrapperLogged, wrapperLogged ? '已记录' : '未出现');
    check('S5 进程写出 stale=true 的兜底 stats', stats !== null && stats.stale === true, stats === null ? 'stats.json 缺失' : `stale=${stats.stale}`);
    check(
      'S5 兜底 stats 记录异常原因',
      stats !== null && String(stats.stale_reason ?? '').includes('构建异常'),
      stats === null ? '-' : String(stats.stale_reason),
    );
  }

  // ---------------- 汇总 ----------------
  const failed = checks.filter((item) => !item.ok).length;
  console.log(`\n合计 ${checks.length} 项，通过 ${checks.length - failed}，失败 ${failed}`);
  process.exitCode = failed === 0 ? 0 : 1;
}

await main();
