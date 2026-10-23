/**
 * @file 赛事专用构建入口：**不重走主链路**。
 *
 * 用途：手机上只想更新赛事清单时跑这个，2~3 秒出结果，
 * 不用等主列表那 2000+ 条源测活（4~6 分钟）。
 *
 * 与主链路的硬隔离（改动时务必保持）：
 *   - 不抓任何 `UPSTREAMS` 上游
 *   - 不做测活
 *   - 不写 `dist/stats.json` / `data/history.json` / `data/blacklist.json`
 *     （动了会污染主列表的统计与降级判定）
 * 只写 `dist/live/live.txt` 与 `dist/live/live.m3u` 两个文件。
 *
 * 用法：`npm run build:live`
 */

import { PATHS } from '../config';
import { emitLive } from '../emit/live';
import { log } from '../util/logger';

/** 赛事构建结果，供 HTTP 接口回给前端。 */
export interface LiveOnlyResult {
  /** 是否成功写出产物 */
  ok: boolean;
  /** 赛事场数 */
  matches: number;
  /** 线路条数（同场多线路会重复计） */
  variants: number;
  /** 正在直播的场数 */
  liveCount: number;
  /** 耗时（毫秒） */
  durationMs: number;
  /** 失败原因 */
  error?: string;
}

/**
 * 只跑赛事链路：拉一次列表 → 渲染 → 落盘。
 *
 * 失败时**不覆盖旧产物**（`emitLive` 内部已保证），返回 `ok: false` 与原因。
 *
 * @param env 环境变量（测试注入用）
 * @return 构建结果
 */
export async function runLiveOnly(env: NodeJS.ProcessEnv = process.env): Promise<LiveOnlyResult> {
  const startedAt = Date.now();
  const outcome = await emitLive({
    txtPath: PATHS.liveTxt,
    m3uPath: PATHS.liveM3u,
    ...(env === process.env ? {} : { env }),
  });
  const durationMs = Date.now() - startedAt;

  if (!outcome.ok) {
    const error = outcome.error ?? '未知原因';
    log.warn('live-only', `赛事刷新失败，保留上一版产物：${error}`);
    return { ok: false, matches: 0, variants: 0, liveCount: 0, durationMs, error };
  }

  const variants = outcome.matches.reduce((total, match) => total + match.variants.length, 0);
  const liveCount = outcome.matches.filter((match) => match.status === 'live').length;

  // 给 HTTP 层解析用的机器可读行：#RESULT {json}
  log.info('live-only', `#RESULT ${JSON.stringify({
    ok: true,
    matches: outcome.matches.length,
    variants,
    liveCount,
    durationMs,
  })}`);

  return { ok: true, matches: outcome.matches.length, variants, liveCount, durationMs };
}

/** 直接执行时跑一次并设置退出码。 */
async function main(): Promise<void> {
  const result = await runLiveOnly();
  if (!result.ok) {
    process.exitCode = 1;
  }
}

// 仅在直接执行（node/tsx src/pipeline/liveOnly.ts）时运行，导入时不跑。
if (process.argv[1] !== undefined && /liveOnly\.(ts|js|mjs)$/.test(process.argv[1])) {
  await main();
}