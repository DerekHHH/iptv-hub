/**
 * @file 本机服务接口（赛事刷新 / 状态查询）。
 *
 * 只有在**本机模式**下才有这些接口——也就是用手机上的 `npm run serve` 起服务、
 * 浏览器地址是 `127.0.0.1` / `localhost` 的时候。走 github.io 打开时接口不存在，
 * 界面会自动隐藏赛事刷新卡片。
 */

/** 是否本机模式（服务在手机本地）。 */
export const LOCAL_MODE =
  typeof window !== 'undefined'
  && /^(?:127\.0\.0\.1|localhost|\[::1\]|::1)$/.test(window.location.hostname);

/** 赛事刷新接口返回体。 */
export interface LiveRefreshResult {
  ok: boolean;
  /** 失败原因（`ok: false` 时有值） */
  message?: string;
  /** 赛事场数 */
  matches?: number;
  /** 线路条数 */
  lines?: number;
  /** 正在直播的场数 */
  liveNow?: number;
  /** 耗时（毫秒） */
  durationMs?: number;
  /** 完成时间 ISO 串 */
  at?: string;
  /** 正在刷新中（接口返回 409 时为 true） */
  running?: boolean;
}

/**
 * 触发一次赛事刷新（只刷赛事，不碰主列表）。
 *
 * @return 刷新结果；网络异常也会包成 `ok: false` 返回，不会抛
 */
export async function refreshLive(): Promise<LiveRefreshResult> {
  try {
    const response = await fetch('./api/live/refresh', { method: 'POST' });
    const data = (await response.json()) as LiveRefreshResult;
    if (response.status === 409) {
      return { ok: false, running: true, message: '赛事正在刷新，请稍候' };
    }
    return data;
  } catch (error) {
    return { ok: false, message: `连不上本机服务：${String(error)}` };
  }
}

/**
 * 查询赛事刷新状态（服务启动时可能已经刷过一次）。
 *
 * @return 状态；接口不存在或出错返回 null
 */
export async function fetchLiveStatus(): Promise<LiveRefreshResult | null> {
  try {
    const response = await fetch('./api/live/status', { cache: 'no-store' });
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as { running?: boolean; last?: LiveRefreshResult };
    return {
      running: data.running === true,
      ...(data.last ?? { ok: false }),
    };
  } catch {
    return null;
  }
}

/**
 * 把毫秒数说成人话。
 *
 * @param ms 毫秒
 * @return 中文文案
 */
export function formatDuration(ms: number | undefined): string {
  if (ms === undefined) {
    return '';
  }
  if (ms < 1000) {
    return `${ms} 毫秒`;
  }
  return `${(ms / 1000).toFixed(1)} 秒`;
}