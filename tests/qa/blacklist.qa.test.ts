/**
 * @file QA 独立补充测试 —— 失效源黑名单（对应验收任务 C4）。
 *
 * 对应 P1-3：连续 2 次失败入黑 → 后续构建跳过/延后 → 复测成功自动恢复；
 * 文件损坏必须自愈，绝不能让流水线崩掉。
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Blacklist } from '../../src/blacklist';
import { BLACKLIST } from '../../src/config';
import type { ProbeResult } from '../../src/types';
import { toUrlKey } from '../../src/util/slug';

/** 测试用临时目录（放项目内，避免系统临时目录被沙箱拦）。 */
const TMP_DIR = join(process.cwd(), '.tmp', 'qa-blacklist');

/**
 * 造一条探测结果。
 *
 * @param url 地址
 * @param status 结论
 * @return ProbeResult
 */
function result(url: string, status: ProbeResult['status']): ProbeResult {
  return {
    urlKey: toUrlKey(url),
    status,
    alive: status === 'alive',
    checkedAt: '2025-01-01T12:00:00+08:00',
  };
}

const NOW_ISO = '2025-01-01T12:00:00+08:00';
const NOW_MS = Date.parse(NOW_ISO);
const URL_A = 'http://a.com/1.m3u8';

beforeAll(async () => {
  await mkdir(TMP_DIR, { recursive: true });
});

afterAll(async () => {
  await rm(TMP_DIR, { recursive: true, force: true });
});

describe('连续失败入黑名单', () => {
  it('连续 2 次 dead 后 fail_count 达到 2', () => {
    const blacklist = new Blacklist();

    blacklist.update([result(URL_A, 'dead')], NOW_ISO);
    expect(blacklist.toFile().entries[toUrlKey(URL_A)]?.fail_count).toBe(1);

    blacklist.update([result(URL_A, 'dead')], NOW_ISO);
    expect(blacklist.toFile().entries[toUrlKey(URL_A)]?.fail_count).toBe(2);
  });

  it('timeout 与 dead 同等计入失败', () => {
    const blacklist = new Blacklist();

    blacklist.update([result(URL_A, 'timeout')], NOW_ISO);
    blacklist.update([result(URL_A, 'timeout')], NOW_ISO);

    expect(blacklist.toFile().entries[toUrlKey(URL_A)]?.fail_count).toBe(2);
  });

  it('skipped / unknown（预算不足未测）不计失败，避免误伤', () => {
    const blacklist = new Blacklist();

    blacklist.update([result(URL_A, 'skipped'), result('http://a.com/2.m3u8', 'unknown')], NOW_ISO);

    expect(blacklist.size()).toBe(0);
  });
});

describe('黑名单命中后的调度（partition）', () => {
  it('fail_count < 2 的源仍然立即测活', () => {
    const blacklist = new Blacklist();
    blacklist.update([result(URL_A, 'dead')], NOW_ISO);

    const partition = blacklist.partition([toUrlKey(URL_A)]);

    expect(partition.probeFirst).toEqual([toUrlKey(URL_A)]);
    expect(partition.retryLater).toEqual([]);
  });

  it('连续 2 次失败后第 3 次构建被移出立即测活队列（延后复测）', () => {
    const blacklist = new Blacklist();
    blacklist.update([result(URL_A, 'dead')], NOW_ISO);
    blacklist.update([result(URL_A, 'dead')], NOW_ISO);

    const partition = blacklist.partition([toUrlKey(URL_A), 'http://a.com/other.m3u8']);

    expect(partition.retryLater).toEqual([toUrlKey(URL_A)]);
    expect(partition.probeFirst).toEqual(['http://a.com/other.m3u8']);
    expect(BLACKLIST.maxFailBeforeDelay).toBe(2);
  });

  it('复测成功后条目被移除，下一次回到立即测活队列', () => {
    const blacklist = new Blacklist();
    blacklist.update([result(URL_A, 'dead')], NOW_ISO);
    blacklist.update([result(URL_A, 'dead')], NOW_ISO);

    blacklist.update([result(URL_A, 'alive')], NOW_ISO);

    expect(blacklist.toFile().entries[toUrlKey(URL_A)]).toBeUndefined();
    expect(blacklist.partition([toUrlKey(URL_A)]).probeFirst).toEqual([toUrlKey(URL_A)]);
  });
});

describe('落盘与自愈', () => {
  it('保存后可从磁盘读回同样的条目', async () => {
    const filePath = join(TMP_DIR, 'blacklist.json');
    const blacklist = new Blacklist();
    blacklist.update([result(URL_A, 'dead')], NOW_ISO);
    await blacklist.save(filePath);

    const reloaded = await Blacklist.load(filePath);

    expect(reloaded.toFile().entries[toUrlKey(URL_A)]?.fail_count).toBe(1);
  });

  it('文件不存在 → 空黑名单，不抛错', async () => {
    const blacklist = await Blacklist.load(join(TMP_DIR, 'not-exists.json'));

    expect(blacklist.size()).toBe(0);
  });

  it('内容损坏（不是 JSON）→ 自动重建为空，不抛错', async () => {
    const filePath = join(TMP_DIR, 'broken.json');
    await writeFile(filePath, '{ 这不是 json', 'utf8');

    const blacklist = await Blacklist.load(filePath);

    expect(blacklist.size()).toBe(0);
    // 自愈后仍可正常保存
    await blacklist.save(filePath);
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual({ version: 1, entries: {} });
  });

  it('结构损坏（version 不对 / entries 不是对象 / 字段类型错）→ 一律当空处理', async () => {
    const cases = [
      '{"version":2,"entries":{}}',
      '{"version":1,"entries":[]}',
      `{"version":1,"entries":{"${toUrlKey(URL_A)}":{"fail_count":"2","last_checked":"x"}}}`,
      'null',
      '[]',
    ];

    for (const [index, raw] of cases.entries()) {
      const filePath = join(TMP_DIR, `invalid-${index}.json`);
      await writeFile(filePath, raw, 'utf8');
      const blacklist = await Blacklist.load(filePath);
      expect(blacklist.size(), `第 ${index} 个损坏样本应被当空处理`).toBe(0);
    }
  });

  it('超过 TTL 的条目被 prune 清掉，未过期的保留', () => {
    const blacklist = new Blacklist();
    blacklist.update([result(URL_A, 'dead')], NOW_ISO);

    const almostExpiredMs = NOW_MS + (BLACKLIST.ttlDays - 1) * 24 * 3600 * 1000;
    expect(blacklist.partition([toUrlKey(URL_A)]).probeFirst).toHaveLength(1);
    blacklist.prune(almostExpiredMs);
    expect(blacklist.size()).toBe(1);

    const expiredMs = NOW_MS + (BLACKLIST.ttlDays + 1) * 24 * 3600 * 1000;
    blacklist.prune(expiredMs);
    expect(blacklist.size()).toBe(0);
  });

  it('last_checked 不可解析的条目会被 prune 清掉', () => {
    const blacklist = new Blacklist({ [toUrlKey(URL_A)]: { fail_count: 3, last_checked: '不知道' } });

    blacklist.prune(NOW_MS);

    expect(blacklist.size()).toBe(0);
  });

  it('落盘键按字典序，保证多次构建的 git diff 稳定', async () => {
    const filePath = join(TMP_DIR, 'sorted.json');
    const blacklist = new Blacklist();
    blacklist.update(
      [
        result('http://z.com/1.m3u8', 'dead'),
        result('http://a.com/1.m3u8', 'dead'),
        result('http://m.com/1.m3u8', 'dead'),
      ],
      NOW_ISO,
    );
    await blacklist.save(filePath);

    const keys = Object.keys(JSON.parse(await readFile(filePath, 'utf8')).entries);
    expect(keys).toEqual([...keys].sort());
  });
});
