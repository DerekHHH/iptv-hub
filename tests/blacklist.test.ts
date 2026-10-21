/**
 * @file 黑名单单测（离线，使用临时目录）。
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { Blacklist } from '../src/blacklist';
import type { ProbeResult } from '../src/types';
import { makeResult } from './helpers';

const NOW = '2025-01-01T12:00:00+08:00';

/**
 * 造一条失败结果。
 *
 * @param url 地址
 * @param status 状态
 * @return ProbeResult
 */
function fail(url: string, status: ProbeResult['status'] = 'dead'): ProbeResult {
  return makeResult(url, { status, error: 'mock' });
}

let tempDir = '';

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'iptv-blacklist-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('Blacklist', () => {
  it('连续 2 次 dead → 进入延后复测队列', () => {
    const blacklist = new Blacklist();
    const url = 'http://a/1.m3u8';

    blacklist.update([fail(url)], NOW);
    expect(blacklist.toFile().entries['http://a/1.m3u8']?.fail_count).toBe(1);

    blacklist.update([fail(url)], NOW);
    expect(blacklist.toFile().entries['http://a/1.m3u8']?.fail_count).toBe(2);
    expect(blacklist.partition(['http://a/1.m3u8'])).toEqual({
      probeFirst: [],
      retryLater: ['http://a/1.m3u8'],
    });
  });

  it('复测成功 → 条目被删除（自动恢复）', () => {
    const blacklist = new Blacklist();
    const url = 'http://a/1.m3u8';
    blacklist.update([fail(url)], NOW);
    blacklist.update([fail(url)], NOW);

    blacklist.update([makeResult(url)], NOW);
    expect(blacklist.toFile().entries['http://a/1.m3u8']).toBeUndefined();
    expect(blacklist.size()).toBe(0);
  });

  it('timeout 也计入失败，skipped 不计', () => {
    const blacklist = new Blacklist();
    blacklist.update([fail('http://a/t.m3u8', 'timeout')], NOW);
    blacklist.update([fail('http://a/s.m3u8', 'skipped')], NOW);
    const entries = blacklist.toFile().entries;
    expect(entries['http://a/t.m3u8']?.fail_count).toBe(1);
    expect(entries['http://a/s.m3u8']).toBeUndefined();
  });

  it('文件缺失时加载为空，不抛错', async () => {
    const blacklist = await Blacklist.load(join(tempDir, 'nope.json'));
    expect(blacklist.size()).toBe(0);
  });

  it('文件损坏时加载为空，不抛错', async () => {
    const path = join(tempDir, 'broken.json');
    await writeFile(path, '{ this is not json', 'utf8');
    const blacklist = await Blacklist.load(path);
    expect(blacklist.size()).toBe(0);
  });

  it('结构不符（version 错）也重建', async () => {
    const path = join(tempDir, 'old.json');
    await writeFile(path, JSON.stringify({ version: 2, entries: { a: { fail_count: 9 } } }), 'utf8');
    const blacklist = await Blacklist.load(path);
    expect(blacklist.size()).toBe(0);
  });

  it('保存后能重新加载（键按字典序）', async () => {
    const path = join(tempDir, 'bl.json');
    const blacklist = new Blacklist();
    blacklist.update([fail('http://b/2.m3u8'), fail('http://a/1.m3u8')], NOW);
    await blacklist.save(path);

    const reloaded = await Blacklist.load(path);
    expect(reloaded.size()).toBe(2);
    expect(Object.keys(reloaded.toFile().entries)).toEqual(['http://a/1.m3u8', 'http://b/2.m3u8']);
  });

  it('过期条目被清理', () => {
    const blacklist = new Blacklist();
    blacklist.update([fail('http://a/old.m3u8')], '2024-01-01T00:00:00+08:00');
    const nowMs = Date.parse('2025-01-01T00:00:00+08:00');
    blacklist.prune(nowMs);
    expect(blacklist.size()).toBe(0);
  });
});
