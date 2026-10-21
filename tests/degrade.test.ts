/**
 * @file 降级判定 + 候选截断单测（对应设计 T10 的三条降级分支）。
 */

import { describe, expect, it } from 'vitest';

import { DEGRADE, SELECT } from '../src/config';
import { evaluateDegrade, selectCandidates } from '../src/main';
import { makeChannel } from './helpers';

/** 一份"健康"的基准输入。 */
const HEALTHY = {
  fetchFailRate: 0,
  candidateCount: 200,
  channelCount: 60,
  sourceCount: 150,
  prevChannelCount: 60,
};

describe('evaluateDegrade', () => {
  it('健康输入不降级', () => {
    expect(evaluateDegrade(HEALTHY)).toEqual({ stale: false });
  });

  it('分支一：上游失败率 ≥50% → stale', () => {
    const decision = evaluateDegrade({ ...HEALTHY, fetchFailRate: 0.5 });
    expect(decision.stale).toBe(true);
    expect(decision.reason).toContain('失败率');
  });

  it('分支二：候选源低于阈值 → stale', () => {
    const decision = evaluateDegrade({ ...HEALTHY, candidateCount: DEGRADE.minCandidates - 1 });
    expect(decision.stale).toBe(true);
    expect(decision.reason).toContain('候选源');
  });

  it('分支三：输出频道数 < 上次的 60% → stale', () => {
    const decision = evaluateDegrade({ ...HEALTHY, channelCount: Math.floor(60 * 0.6) - 1 });
    expect(decision.stale).toBe(true);
    expect(decision.reason).toContain('上次');
  });

  it('恰好等于 60% 时不降级（边界）', () => {
    expect(evaluateDegrade({ ...HEALTHY, channelCount: 36, sourceCount: 100 }).stale).toBe(false);
  });

  it('首次构建（无上次数据）不会因频道数掉而降级', () => {
    expect(evaluateDegrade({ ...HEALTHY, prevChannelCount: null }).stale).toBe(false);
  });

  it('存活源过少也算降级', () => {
    const decision = evaluateDegrade({ ...HEALTHY, sourceCount: DEGRADE.minSourceCount - 1 });
    expect(decision.stale).toBe(true);
    expect(decision.reason).toContain('存活源');
  });
});

describe('selectCandidates', () => {
  it('按分组优先级截断，且按 urlKey 全局去重', () => {
    const channels = [
      makeChannel('tvb-jade', '翡翠台', '港澳台', ['http://a/jade.m3u8']),
      makeChannel('cctv1', 'CCTV-1 综合', '央视', ['http://a/cctv1.m3u8', 'http://a/jade.m3u8']),
      makeChannel('satellite-hunan', '湖南卫视', '卫视', ['http://a/hunan.m3u8']),
    ];
    const targets = selectCandidates(channels, 10);
    expect(targets.map((target) => target.url)).toEqual([
      'http://a/jade.m3u8',
      'http://a/cctv1.m3u8',
      'http://a/hunan.m3u8',
    ]);
  });

  it('超过上限时截断到 MAX_CANDIDATES', () => {
    const urls = Array.from({ length: 20 }, (_unused, index) => `http://a/${index}.m3u8`);
    const channels = [makeChannel('cctv1', 'CCTV-1 综合', '央视', urls)];
    expect(selectCandidates(channels, 5)).toHaveLength(5);
  });

  it('默认上限来自 config', () => {
    const urls = Array.from({ length: 10 }, (_unused, index) => `http://a/${index}.m3u8`);
    const channels = [makeChannel('cctv1', 'CCTV-1 综合', '央视', urls)];
    expect(selectCandidates(channels)).toHaveLength(10);
    expect(SELECT.maxCandidates).toBeGreaterThan(0);
  });
});
