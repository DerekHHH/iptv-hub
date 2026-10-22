/**
 * @file 唯一入口：编排 L1 抓取 → L2 解析 → L3 归一 → L4 测活 → L5 优选/生成。
 *
 * 三分支降级（P0-13）：上游失败率 ≥50% / 候选源低于阈值 / 输出频道数 < 上次的 60%
 * → **只写 stats.json（stale:true）**，绝不覆盖 txt/m3u/epg。
 *
 * 顶层 wrapper 捕获一切异常 → 写 stale stats → `exit 0`
 * （定时任务不飘红、产物不被污染）。
 */

import {
  DEGRADE,
  FETCH,
  OVERSEAS_ORIGINS,
  PATHS,
  PROBE,
  SELECT,
  isMockMode,
} from './config';
import { GROUP_ORDER, groupWeight } from './data/groups';
import { Blacklist } from './blacklist';
import { readPrevStats, emitStats, emitHistory, createEmptyStats } from './emit/stats';
import { emitChannelsJson } from './emit/channelsJson';
import { renderM3u } from './emit/m3u';
import { renderTxt } from './emit/txt';
import { emitEpg } from './emit/epg';
import { emitNba } from './emit/nba';
import { HIDDEN_CHANNEL_COUNT, buildChannels } from './normalize/channelName';
import { parseAuto } from './parse/parseTxt';
import { probeAll } from './probe/probe';
import { createMockFetch } from './sources/mock';
import { computeFetchFailRate, fetchAllDocs } from './sources/fetch';
import { countSources, rankChannels } from './select/rank';
import type {
  BuildStats,
  Channel,
  GroupKey,
  ProbeDeps,
  ProbeResult,
  ProbeTarget,
  Stream,
  UpstreamStat,
} from './types';
import { writeTextFile } from './util/fsx';
import { log } from './util/logger';
import { formatDuration, formatIsoCst } from './util/time';

/** 降级判定输入。 */
export interface DegradeInput {
  /** 上游抓取失败率 0~1 */
  fetchFailRate: number;
  /** 进入候选池的源数 */
  candidateCount: number;
  /** 优选后输出的频道数 */
  channelCount: number;
  /** 优选后输出的源数 */
  sourceCount: number;
  /** 上次构建的频道数（首次构建为 null） */
  prevChannelCount: number | null;
}

/** 降级判定结论。 */
export interface DegradeDecision {
  stale: boolean;
  reason?: string;
}

/**
 * 纯函数形式的降级判定（便于单测覆盖三个分支）。
 *
 * @param input 判定输入
 * @return 结论
 */
export function evaluateDegrade(input: DegradeInput): DegradeDecision {
  if (input.fetchFailRate >= FETCH.failRateLimit) {
    return {
      stale: true,
      reason: `上游抓取失败率 ${(input.fetchFailRate * 100).toFixed(0)}% 过高（阈值 ${(FETCH.failRateLimit * 100).toFixed(0)}%）`,
    };
  }
  if (input.candidateCount < DEGRADE.minCandidates) {
    return { stale: true, reason: `候选源仅 ${input.candidateCount} 个，低于阈值 ${DEGRADE.minCandidates}` };
  }
  if (input.channelCount < DEGRADE.minChannels) {
    return {
      stale: true,
      reason: `输出频道仅 ${input.channelCount} 个，低于阈值 ${DEGRADE.minChannels}`,
    };
  }
  if (input.sourceCount < DEGRADE.minSourceCount) {
    return {
      stale: true,
      reason: `存活源仅 ${input.sourceCount} 个，低于阈值 ${DEGRADE.minSourceCount}`,
    };
  }
  if (input.prevChannelCount !== null && input.prevChannelCount > 0) {
    const floor = Math.floor(input.prevChannelCount * DEGRADE.channelDropRatio);
    if (input.channelCount < floor) {
      return {
        stale: true,
        reason: `输出频道 ${input.channelCount} 个，低于上次 ${input.prevChannelCount} 个的 ${Math.round(
          DEGRADE.channelDropRatio * 100,
        )}%`,
      };
    }
  }
  return { stale: false };
}

/** 一套完整的产物路径（默认来自 config 的 `PATHS`）。 */
export type RunPaths = { [K in keyof typeof PATHS]: string };

/**
 * 合并默认路径与覆盖项。
 *
 * 存在的意义：单测要验证落盘行为时，**通过注入路径换到临时目录**，
 * 而不是用 `process.chdir`（进程级副作用会让并行测试的相对路径互相串台）。
 *
 * @param overrides 需要覆盖的路径
 * @return 完整路径表
 */
export function resolvePaths(overrides: Partial<RunPaths> = {}): RunPaths {
  return { ...PATHS, ...overrides };
}

/** `run` 的可注入选项。 */
export interface RunOptions {
  /** 注入的 fetch */
  fetchImpl?: typeof fetch;
  /** 注入的当前时间 */
  now?: () => number;
  /** 强制 mock 模式 */
  mockMode?: boolean;
  /** 覆盖产物路径（单测用临时目录，避免 process.chdir） */
  paths?: Partial<RunPaths>;
}

/** 降级落盘所需的上下文。 */
interface StalePersistContext {
  /** 产物路径 */
  paths: RunPaths;
  /** 上一次构建的 stats（用于回填展示口径） */
  prev: BuildStats | null;
  /** 当前时间函数 */
  nowMs: () => number;
  /** 本次构建开始时刻 */
  startedAt: number;
}

/**
 * 统一的「降级落盘」：写 stats.json + 追加一条 stale 历史。
 *
 * 正常降级（`writeStale`）与顶层异常兜底（`main` 的 catch）**必须共用这一个函数**，
 * 否则很容易出现「一边改了、另一边漏了」的历史缺失（N1 就是这么漏的）。
 *
 * @param stats 待落盘的统计（会被写入 stale 标记）
 * @param reason 降级原因
 * @param context 路径、上一版 stats、时间函数与起始时刻
 * @return 落盘后的统计
 */
export async function persistStaleOutcome(
  stats: BuildStats,
  reason: string,
  context: StalePersistContext,
): Promise<BuildStats> {
  stats.stale = true;
  stats.stale_reason = reason;
  if (context.prev !== null) {
    stats.updated_at = context.prev.updated_at;
    stats.channel_count = context.prev.channel_count;
    stats.source_count = context.prev.source_count;
    stats.groups = context.prev.groups ?? countGroups([]);
  }
  stats.build_duration_ms = context.nowMs() - context.startedAt;

  await emitStats(stats, context.paths.stats);

  // 降级也要进历史（stale:true + 原因），否则首页趋势里永远看不到降级；
  // 计数用的是上面回填的上一版数值，不会把趋势画成 0。失败只告警，绝不二次崩溃。
  try {
    await emitHistory(stats, context.paths.history);
  } catch (error) {
    log.warn('main', '写入构建历史失败（不影响降级落盘）', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return stats;
}

/**
 * 把 Stream 列表压成探测目标（按「userAdded 优先 → 分组权重 → channelId → urlKey」截断）。
 *
 * 为什么 userAdded 排在最前：`custom/sources.txt` 是用户手填的源，承诺「优先级高于自动抓取」。
 * 若只按分组顺序截断，超上限时「其他」组里的自填源会先被砍掉，与承诺矛盾。
 *
 * @param channels 归一后的频道（顺序不重要，内部会重新排序）
 * @param maxCandidates 候选上限
 * @return 去重后的探测目标
 */
export function selectCandidates(
  channels: readonly Channel[],
  maxCandidates: number = SELECT.maxCandidates,
): ProbeTarget[] {
  const flat: Array<{
    url: string;
    urlKey: string;
    origin: string;
    channelId: string;
    groupRank: number;
    autoRank: number;
  }> = [];

  for (const channel of channels) {
    const groupRank = groupWeight(channel.group);
    for (const stream of channel.streams) {
      flat.push({
        url: stream.url,
        urlKey: stream.urlKey,
        origin: stream.origin,
        channelId: channel.id,
        groupRank,
        // 0 = 用户自填（最优先），1 = 自动抓取
        autoRank: stream.userAdded === true ? 0 : 1,
      });
    }
  }

  flat.sort((left, right) => {
    if (left.autoRank !== right.autoRank) {
      return left.autoRank - right.autoRank;
    }
    if (left.groupRank !== right.groupRank) {
      return left.groupRank - right.groupRank;
    }
    if (left.channelId !== right.channelId) {
      return left.channelId < right.channelId ? -1 : 1;
    }
    if (left.urlKey === right.urlKey) {
      return 0;
    }
    return left.urlKey < right.urlKey ? -1 : 1;
  });

  const targets: ProbeTarget[] = [];
  const seen = new Set<string>();
  for (const item of flat) {
    if (seen.has(item.urlKey)) {
      continue;
    }
    seen.add(item.urlKey);
    targets.push({ urlKey: item.urlKey, url: item.url, origin: item.origin });
    if (targets.length >= maxCandidates) {
      break;
    }
  }
  return targets;
}

/** 统计各分组的频道数。 */
function countGroups(channels: readonly Channel[]): Record<GroupKey, number> {
  const groups = {} as Record<GroupKey, number>;
  for (const group of GROUP_ORDER) {
    groups[group] = 0;
  }
  for (const channel of channels) {
    // 分组已数据驱动（`GroupKey = string`），人工覆盖可能引入不在 `GROUP_ORDER` 里的新分组，
    // 直接 `+=` 会得到 NaN，所以用 `?? 0` 兜底。
    groups[channel.group] = (groups[channel.group] ?? 0) + 1;
  }
  return groups;
}

/** 汇总测活结果计数。 */
function summarizeProbe(
  results: readonly ProbeResult[],
  durationMs: number,
  totalTargets: number,
): BuildStats['probe'] {
  let alive = 0;
  let dead = 0;
  let timeout = 0;
  let skipped = 0;
  for (const result of results) {
    if (result.status === 'alive') {
      alive += 1;
    } else if (result.status === 'dead') {
      dead += 1;
    } else if (result.status === 'timeout') {
      timeout += 1;
    } else {
      skipped += 1;
    }
  }
  return { total: totalTargets, alive, dead, timeout, skipped, duration_ms: durationMs };
}

/**
 * 执行一次完整构建。
 *
 * @param options 注入选项
 * @return 最终写入的 stats（便于测试断言）
 */
export async function run(options: RunOptions = {}): Promise<BuildStats> {
  const mockMode = options.mockMode ?? isMockMode();
  const nowMs = options.now ?? Date.now;
  const fetchImpl = options.fetchImpl ?? (mockMode ? createMockFetch() : undefined);
  const deps: ProbeDeps = {};
  if (options.now !== undefined) {
    deps.now = options.now;
  }
  if (fetchImpl !== undefined) {
    deps.fetchImpl = fetchImpl;
  }

  const startedAt = nowMs();
  const startedIso = formatIsoCst(startedAt);
  const paths = resolvePaths(options.paths);

  const prevStats = await readPrevStats(paths.stats);
  const blacklist = await Blacklist.load(paths.blacklist);
  log.info('main', `开始构建（${mockMode ? 'MOCK 离线模式' : '在线模式'}）`, {
    prevChannels: prevStats?.channel_count ?? 0,
    blacklistSize: blacklist.size(),
  });

  /** 降级落盘：复用 `persistStaleOutcome`，与顶层异常兜底保持同一套行为。 */
  const writeStale = async (stats: BuildStats, reason: string): Promise<BuildStats> => {
    const persisted = await persistStaleOutcome(stats, reason, {
      paths,
      prev: prevStats,
      nowMs,
      startedAt,
    });
    log.warn('main', `进入降级：${reason}（保留上一版 txt/m3u/epg）`);
    return persisted;
  };

  // ---------- L1 抓取 ----------
  const docs = await fetchAllDocs({
    fetchImpl,
    mockMode,
    customPath: paths.custom,
    fixturesDir: paths.fixturesDir,
  });
  const fetchFailRate = computeFetchFailRate(docs);
  const upstreamStats: UpstreamStat[] = docs.map((doc) => {
    const stat: UpstreamStat = {
      name: doc.origin,
      ok: doc.ok,
      items: doc.items,
      channel: doc.channel,
    };
    if (doc.error !== undefined) {
      stat.error = doc.error;
    }
    return stat;
  });

  const stats = createEmptyStats(startedIso);
  stats.upstream = upstreamStats;
  stats.fetch_fail_rate = Number(fetchFailRate.toFixed(4));
  stats.build_duration_ms = 0;
  // 屏蔽名单是在归一阶段就丢弃的（见 normalize/channelName.ts），数量与本次构建恒定
  stats.hidden_count = HIDDEN_CHANNEL_COUNT;

  log.info('main', `上游 ${docs.length} 个，失败率 ${(fetchFailRate * 100).toFixed(0)}%`);

  if (fetchFailRate >= FETCH.failRateLimit) {
    return await writeStale(
      stats,
      `上游抓取失败率 ${(fetchFailRate * 100).toFixed(0)}% 超过阈值 ${(FETCH.failRateLimit * 100).toFixed(0)}%`,
    );
  }

  // ---------- L2 解析 ----------
  const allStreams: Stream[] = [];
  let parseFailures = 0;
  for (const doc of docs) {
    if (!doc.ok || doc.text.length === 0) {
      continue;
    }
    try {
      const parsed = parseAuto(doc.text, doc.origin);
      if (doc.channel === 'custom') {
        for (const stream of parsed) {
          stream.userAdded = true;
        }
      }
      allStreams.push(...parsed);
    } catch (error) {
      parseFailures += 1;
      log.warn('parse', `文档解析失败：${doc.origin}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  log.info('parse', `解析出 ${allStreams.length} 条源（失败文档 ${parseFailures} 个）`);

  // ---------- L3 归一 ----------
  const channels = buildChannels(allStreams);
  log.info('normalize', `归一出 ${channels.length} 个频道`);

  const candidates = selectCandidates(channels, SELECT.maxCandidates);
  log.info('normalize', `进入候选池 ${candidates.length} 条源`);

  if (candidates.length < DEGRADE.minCandidates) {
    const decision = evaluateDegrade({
      fetchFailRate,
      candidateCount: candidates.length,
      channelCount: 0,
      sourceCount: 0,
      prevChannelCount: null,
    });
    return await writeStale(stats, decision.reason ?? '候选源不足');
  }

  // ---------- L4 测活 ----------
  const partition = blacklist.partition(candidates.map((target) => target.urlKey));
  const candidateByKey = new Map(candidates.map((target) => [target.urlKey, target]));
  const firstTargets = partition.probeFirst
    .map((urlKey) => candidateByKey.get(urlKey))
    .filter((target): target is ProbeTarget => target !== undefined);
  const retryTargets = partition.retryLater
    .map((urlKey) => candidateByKey.get(urlKey))
    .filter((target): target is ProbeTarget => target !== undefined);

  log.info('probe', `立即测活 ${firstTargets.length} 条，黑名单延后复测 ${retryTargets.length} 条`);

  const probeStartedAt = nowMs();
  const deadline = probeStartedAt + PROBE.deadlineMs;
  let lastLogged = 0;

  const firstResults = await probeAll(
    firstTargets,
    {
      concurrency: PROBE.concurrency,
      timeoutMs: PROBE.timeoutMs,
      deadline,
      onProgress: (done, total) => {
        if (done - lastLogged >= Math.max(1, Math.floor(total / 10))) {
          lastLogged = done;
          log.info('probe', `进度 ${done}/${total}`);
        }
      },
    },
    deps,
  );

  const mergedResults = new Map<string, ProbeResult>();
  for (const result of firstResults) {
    mergedResults.set(result.urlKey, result);
  }

  const remainingMs = deadline - nowMs();
  if (retryTargets.length > 0 && remainingMs > PROBE.retryWindowMs) {
    log.info('probe', `预算充足（剩余 ${formatDuration(remainingMs)}），开始黑名单复测`);
    const retryResults = await probeAll(
      retryTargets,
      { concurrency: PROBE.concurrency, timeoutMs: PROBE.timeoutMs, deadline },
      deps,
    );
    for (const result of retryResults) {
      mergedResults.set(result.urlKey, result);
    }
  } else if (retryTargets.length > 0) {
    log.info('probe', '预算不足，跳过黑名单复测');
  }

  // ---------- 海外源补测 ----------
  // 海外源在国内网络下首连失败率极高，且高并发会互相挤占连接放大误判
  // （实测同一批 42 条海外源，并发 64 时存活数在 1~29 之间乱跳）。
  // 所以对海外上游的**首轮失败项**再单独跑一轮，给它们第二次机会。
  const overseasRetryTargets = candidates.filter(
    (target) =>
      target.origin !== undefined &&
      OVERSEAS_ORIGINS.includes(target.origin) &&
      mergedResults.get(target.urlKey)?.alive !== true,
  );
  if (overseasRetryTargets.length > 0 && PROBE.overseasRetries > 0) {
    for (let round = 0; round < PROBE.overseasRetries; round += 1) {
      const remaining = deadline - nowMs();
      if (remaining <= PROBE.retryWindowMs) {
        log.info('probe', '预算不足，跳过海外源补测');
        break;
      }
      log.info('probe', `海外源补测第 ${round + 1} 轮：${overseasRetryTargets.length} 条`);
      const retried = await probeAll(
        overseasRetryTargets,
        {
          // 补测用低并发：高并发下海外源会互相挤占，反而更容易误判
          concurrency: Math.max(1, Math.min(PROBE.concurrency, overseasRetryTargets.length)),
          timeoutMs: PROBE.timeoutMs,
          deadline,
        },
        deps,
      );
      let recovered = 0;
      for (const result of retried) {
        if (result.alive) {
          mergedResults.set(result.urlKey, result);
          recovered += 1;
        }
      }
      log.info('probe', `海外源补测第 ${round + 1} 轮：${recovered}/${retried.length} 恢复存活`);
    }
  }

  const probeDurationMs = nowMs() - probeStartedAt;
  const allResults = [...mergedResults.values()];
  const aliveCount = allResults.filter((result) => result.alive).length;
  log.info('probe', `测活完成：${aliveCount}/${allResults.length} 存活，用时 ${formatDuration(probeDurationMs)}`);

  // ---------- 黑名单更新 ----------
  blacklist.update(allResults, formatIsoCst(nowMs()));
  blacklist.prune(nowMs());
  await blacklist.save(paths.blacklist);

  // ---------- L5 优选 ----------
  const ranked = rankChannels(channels, allResults);
  const sourceCount = countSources(ranked);
  stats.channel_count = ranked.length;
  stats.source_count = sourceCount;
  stats.groups = countGroups(ranked);
  stats.probe = summarizeProbe(allResults, probeDurationMs, candidates.length);

  log.info('rank', `优选出 ${ranked.length} 个频道 / ${sourceCount} 条存活源`);

  const decision = evaluateDegrade({
    fetchFailRate,
    candidateCount: candidates.length,
    channelCount: ranked.length,
    sourceCount,
    prevChannelCount: prevStats?.channel_count ?? null,
  });

  if (decision.stale) {
    return await writeStale(stats, decision.reason ?? '输出质量下降');
  }

  // ---------- 产物生成 ----------
  const txtText = renderTxt(ranked);
  const m3uText = renderM3u(ranked);
  await writeTextFile(paths.txt, txtText);
  log.info('emit', `写出 ${paths.txt}（${txtText.length} 字节）`);
  await writeTextFile(paths.m3u, m3uText);
  log.info('emit', `写出 ${paths.m3u}（${m3uText.length} 字节）`);

  try {
    const epgOutcome = await emitEpg(ranked, { filePath: paths.epg, fetchImpl });
    stats.epg = { ok: epgOutcome.ok, programmes: epgOutcome.programmes };
    if (epgOutcome.error !== undefined) {
      stats.epg.error = epgOutcome.error;
      log.warn('epg', epgOutcome.error);
    } else {
      log.info('epg', `写出 ${paths.epg}，${epgOutcome.programmes} 条节目`);
    }
  } catch (error) {
    stats.epg = {
      ok: false,
      programmes: 0,
      error: error instanceof Error ? error.message : String(error),
    };
    log.warn('epg', 'EPG 生成失败，已跳过（不影响列表）', { error: stats.epg.error });
  }

  stats.stale = false;
  delete stats.stale_reason;
  stats.updated_at = formatIsoCst(nowMs());
  stats.build_duration_ms = nowMs() - startedAt;
  await emitStats(stats, paths.stats);
  await emitHistory(stats, paths.history);

  // 网页端频道目录：失败只告警，不影响 txt/m3u/epg（网页端会退回读取 txt）。
  try {
    const channelsFile = await emitChannelsJson(ranked, stats.updated_at, paths.channelsJson);
    log.info(
      'emit',
      `写出 ${paths.channelsJson}（${channelsFile.channels.length} 个频道 / ${channelsFile.groups.length} 个分组）`,
    );
  } catch (error) {
    log.warn('emit', '频道目录生成失败，已跳过（不影响 txt/m3u）', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // NBA 赛程产物：失败只告警，不写产物（保留上一版），不影响主列表。
  // MOCK 离线模式下跳过：该模式承诺不触网，也不应往 dist/ 写额外文件。
  if (!mockMode) {
    try {
      const nbaOutcome = await emitNba(ranked, {
        txtPath: paths.nbaTxt,
        m3uPath: paths.nbaM3u,
        ...(fetchImpl === undefined ? {} : { fetchImpl }),
        now: nowMs,
      });
      if (!nbaOutcome.ok) {
        log.warn('nba', nbaOutcome.error ?? '赛程获取失败，保留上一版产物');
      }
    } catch (error) {
      log.warn('nba', 'NBA 赛程生成失败，已跳过（不影响频道列表）', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  log.info('emit', `构建完成，用时 ${formatDuration(stats.build_duration_ms)}`);

  return stats;
}

/**
 * 顶层兜底：任何未预期异常都写成 stale stats + stale 历史，并以 0 退出码结束。
 *
 * 与正常降级走**同一个** `persistStaleOutcome`，避免「一边补了、另一边漏了」。
 */
async function main(): Promise<void> {
  const startedAt = Date.now();
  try {
    await run();
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    log.error('main', `构建异常，已降级为 stale：${message}`);
    try {
      const paths = resolvePaths();
      const prevStats = await readPrevStats(paths.stats);
      const fallback = createEmptyStats(formatIsoCst(Date.now()));
      await persistStaleOutcome(fallback, `构建异常：${message}`, {
        paths,
        prev: prevStats,
        nowMs: Date.now,
        startedAt,
      });
    } catch (nestedError) {
      log.error('main', '写入兜底 stats/history 也失败了（不阻断流水线）', {
        error: nestedError instanceof Error ? nestedError.message : String(nestedError),
      });
    }
  }
}

// 直接执行时启动；作为模块被测试导入时不启动
const isDirectRun = process.argv[1] !== undefined && /main\.(ts|js|mjs)$/.test(process.argv[1]);
if (isDirectRun) {
  await main();
  // 显式 0：定时任务不因降级而飘红
  process.exitCode = 0;
}

export { main };
