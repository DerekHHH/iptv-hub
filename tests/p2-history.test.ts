/**
 * @file P2-3 回归：降级构建也必须写 data/history.json（stale:true + 原因，计数沿用上一版）。
 *
 * 注意（N3）：这里**不使用 `process.chdir`**。`chdir` 是进程级副作用，
 * 在 vitest 并行 worker 里会让其它测试文件的相对路径解析串台（表现为用例数忽多忽少）。
 * 改为通过 `run({ paths })` 注入临时目录，测试之间彻底隔离。
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { persistStaleOutcome, resolvePaths, run, type RunPaths } from '../src/main';
import { createEmptyStats } from '../src/emit/stats';
import type { BuildStats, HistoryFile } from '../src/types';

/** 上一版的 stats（channel_count 200，用来验证回填）。 */
function prevStatsText(): string {
  return JSON.stringify(
    {
      version: 1,
      updated_at: '2020-01-01T00:00:00+08:00',
      channel_count: 200,
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

/** 一律失败的 fetch（把上游失败率打到 100%）。 */
const failingFetch = (async () => {
  throw new TypeError('fetch failed (p2-3 test)');
}) as unknown as typeof fetch;

/** 固定的"当前时间"。 */
const FIXED_NOW = Date.UTC(2025, 0, 1, 4, 0, 0);

let sandbox = '';
let paths: RunPaths;

/**
 * 在临时目录下造一套完整路径。
 *
 * @param dir 临时目录
 * @return 路径表
 */
function pathsOf(dir: string): RunPaths {
  return resolvePaths({
    distDir: join(dir, 'dist'),
    txtDir: join(dir, 'dist', 'txt'),
    m3uDir: join(dir, 'dist', 'm3u'),
    epgDir: join(dir, 'dist', 'epg'),
    txt: join(dir, 'dist', 'txt', 'all.txt'),
    m3u: join(dir, 'dist', 'm3u', 'all.m3u'),
    epg: join(dir, 'dist', 'epg', 'epg.xml'),
    stats: join(dir, 'dist', 'stats.json'),
    dataDir: join(dir, 'data'),
    blacklist: join(dir, 'data', 'blacklist.json'),
    history: join(dir, 'data', 'history.json'),
    custom: join(dir, 'custom', 'sources.txt'),
    fixturesDir: join(dir, 'tests', 'fixtures'),
  });
}

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'iptv-p2-history-'));
  for (const sub of ['dist/txt', 'dist/m3u', 'dist/epg', 'data', 'custom']) {
    await mkdir(join(sandbox, sub), { recursive: true });
  }
  await writeFile(join(sandbox, 'dist', 'stats.json'), prevStatsText(), 'utf8');
  paths = pathsOf(sandbox);
});

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

/**
 * 读临时目录里的历史文件。
 *
 * @return 历史文件内容
 */
async function readHistory(): Promise<HistoryFile> {
  return JSON.parse(await readFile(paths.history, 'utf8')) as HistoryFile;
}

describe('降级构建写历史', () => {
  it('上游全部失败 → history.json 追加一条 stale:true，计数沿用上一版', async () => {
    const stats = await run({ fetchImpl: failingFetch, now: () => FIXED_NOW, paths });

    expect(stats.stale).toBe(true);
    expect(stats.stale_reason).toContain('失败率');
    expect(existsSync(paths.history)).toBe(true);

    const history = await readHistory();
    expect(history.version).toBe(1);
    expect(history.items).toHaveLength(1);

    const last = history.items.at(-1);
    expect(last?.stale).toBe(true);
    // 关键：不能把空构建的 0 写进趋势，必须沿用上一版回填值
    expect(last?.channel_count).toBe(200);
    expect(last?.source_count).toBe(500);
    expect(last?.updated_at).toBe('2020-01-01T00:00:00+08:00');
    expect(last?.stale_reason).toContain('失败率');
  });

  it('降级时仍然不覆盖上一版 txt/m3u/epg', async () => {
    await run({ fetchImpl: failingFetch, now: () => FIXED_NOW, paths });

    expect(existsSync(paths.txt)).toBe(false);
    expect(existsSync(paths.m3u)).toBe(false);
    expect(existsSync(paths.epg)).toBe(false);
  });

  it('连续两次降级 → 历史累积两条，都带 stale 标记', async () => {
    await run({ fetchImpl: failingFetch, now: () => FIXED_NOW, paths });
    await run({ fetchImpl: failingFetch, now: () => FIXED_NOW + 3_600_000, paths });

    const history = await readHistory();
    expect(history.items).toHaveLength(2);
    expect(history.items.every((item) => item.stale === true)).toBe(true);
  });

  it('N1：顶层异常兜底走的 persistStaleOutcome 同样写 stale 历史（两条路径行为一致）', async () => {
    const prev = JSON.parse(prevStatsText()) as BuildStats;
    const fallback = createEmptyStats('2025-01-01T12:00:00+08:00');

    const persisted = await persistStaleOutcome(fallback, '构建异常：QA 注入：测活阶段崩溃', {
      paths,
      prev,
      nowMs: () => FIXED_NOW,
      startedAt: FIXED_NOW - 1234,
    });

    expect(persisted.stale).toBe(true);
    expect(persisted.stale_reason).toContain('构建异常');
    // 与降级路径同一套回填规则
    expect(persisted.channel_count).toBe(200);
    expect(persisted.source_count).toBe(500);
    expect(persisted.updated_at).toBe('2020-01-01T00:00:00+08:00');
    expect(persisted.build_duration_ms).toBe(1234);

    const history = await readHistory();
    const last = history.items.at(-1);
    expect(history.items).toHaveLength(1);
    expect(last?.stale).toBe(true);
    expect(last?.stale_reason).toContain('构建异常');
    expect(last?.channel_count).toBe(200);
    expect(last?.source_count).toBe(500);
  });
});

describe('路径注入的隔离性（N3）', () => {
  it('注入临时路径后，不会碰仓库里的 dist/ 与 data/', async () => {
    const repoHistory = join(process.cwd(), 'data', 'history.json');
    const before = existsSync(repoHistory) ? await readFile(repoHistory, 'utf8') : null;

    await run({ fetchImpl: failingFetch, now: () => FIXED_NOW, paths });

    const afterText = existsSync(repoHistory) ? await readFile(repoHistory, 'utf8') : null;
    expect(afterText).toBe(before);
    expect(existsSync(join(sandbox, 'data', 'history.json'))).toBe(true);
  });
});
