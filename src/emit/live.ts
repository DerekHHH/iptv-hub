/**
 * @file 赛事直播产物（`dist/live/live.txt` 与 `dist/live/live.m3u`）。
 *
 * 与 NBA 赛程产物同性质：**独立一份文件**，不混进主频道列表（`all.txt`）。
 * 原因：这些链接只有手机服务在跑的时候才有效，且内容每天完全换一批，
 * 混进主列表会让频道目录持续抖动、还会把"找不到台"的锅甩给主源。
 *
 * 分组名**一级平铺**（`NBA` / `CBA` / `英超` / `欧冠` / `英雄联盟` …），不再有
 * 「篮球|NBA」这类两级前缀 —— 电视端分组栏直接就是联赛列表。
 * 名条统一带状态前缀（`[比赛中]` / `[未开始]` / `[完场]`），
 * 大联赛能匹配到赛程的再加开赛时间（`09:00`），多资源用线路名区分（`(高清)`）。
 *
 * 失败策略：服务不在（GitHub Actions / 手机没起服务）时**不写产物**，
 * 保留上一版，只打 info 日志，绝不影响主列表。
 */

import { PATHS } from '../config';
import { attachSchedule, fetchSchedule, LEAGUE_IDS } from '../sources/schedule';
import { compareMatches, fetchLiveMatches, type LiveMatch, type LiveStatus } from '../sources/wudaliansai';
import { writeTextFile } from '../util/fsx';
import { log } from '../util/logger';

/** TXT 分组头标记（与 `emit/txt.ts` 保持一致）。 */
const GENRE_MARKER = '#genre#';

/** 状态 → 名条前缀（四种状态统一标注，一眼能分清）。 */
const STATUS_TAG: Readonly<Record<LiveStatus, string>> = {
  live: '[比赛中]',
  upcoming: '[未开始]',
  unavailable: '[暂无直播]',
  ended: '[完场]',
};

/**
 * 分组名：直接就是联赛/游戏名（`NBA` / `英超` / `英雄联盟`）。
 *
 * 一级平铺——播放器分组栏看到的就是联赛列表，不再有「篮球/足球」这层。
 * 线路名不占分组位，写进条目名（见 `entryLabel`）。
 *
 * @param match 赛事
 * @return 分组名
 */
function groupLabel(match: LiveMatch): string {
  return match.league;
}

/** 北京时间的毫秒偏移（UTC+8）。 */
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * 把开赛时间格式化成北京时间短标签。
 *
 * 当天的只给 `HH:mm`（电视上够看），跨日的补上 `MM-DD`，避免看不出是哪天。
 *
 * @param startAt 开赛时间（epoch 毫秒）
 * @param now 当前时间（epoch 毫秒），用于判断是不是同一天
 * @return 形如 `09:00` 或 `10-27 09:00`
 */
export function formatKickoff(startAt: number, now: number): string {
  const toBeijing = (value: number): Date => new Date(value + BEIJING_OFFSET_MS);
  const target = toBeijing(startAt);
  const today = toBeijing(now);
  const pad = (value: number): string => String(value).padStart(2, '0');
  const clock = `${pad(target.getUTCHours())}:${pad(target.getUTCMinutes())}`;
  const sameDay =
    target.getUTCFullYear() === today.getUTCFullYear() &&
    target.getUTCMonth() === today.getUTCMonth() &&
    target.getUTCDate() === today.getUTCDate();
  return sameDay ? clock : `${pad(target.getUTCMonth() + 1)}-${pad(target.getUTCDate())} ${clock}`;
}

/**
 * 名条文案：`[未开始] 雷霆 vs 掘金 09:00 (高清)`。
 *
 * 状态前缀对四种状态统一输出；能匹配到赛程的补开赛时间；
 * 完场的如果有比分就一并带上；线路名非空时追加在括号里
 * （同一场比赛的多个资源就是靠它区分的）。
 *
 * @param match 赛事
 * @param line 线路名（可为空）
 * @param now 当前时间（epoch 毫秒）
 * @return 名条
 */
function entryLabel(match: LiveMatch, line: string, now: number): string {
  const parts = [STATUS_TAG[match.status], match.title];
  if (match.startAt !== undefined) {
    parts.push(formatKickoff(match.startAt, now));
  }
  if (match.status === 'ended' && match.score !== undefined && match.score.length > 0) {
    parts.push(match.score);
  }
  const suffix = line.length > 0 ? ` (${line})` : '';
  return `${parts.join(' ')}${suffix}`;
}

/**
 * 收集「分组名 → 该组的全部 `(名条, 地址)`」，分组顺序保持输入顺序。
 *
 * @param matches 赛事列表
 * @return 有序分组
 */
function collectGroups(
  matches: readonly LiveMatch[],
  now: number,
): Array<{ group: string; items: Array<[string, string]> }> {
  const order: string[] = [];
  const buckets = new Map<string, Array<[string, string]>>();

  for (const match of matches) {
    for (const variant of match.variants) {
      const label = entryLabel(match, variant.line, now);
      const group = groupLabel(match);
      let bucket = buckets.get(group);
      if (bucket === undefined) {
        bucket = [];
        buckets.set(group, bucket);
        order.push(group);
      }
      bucket.push([label, variant.url]);
    }
  }

  return order.map((group) => ({ group, items: buckets.get(group) ?? [] }));
}

/**
 * 渲染 TXT（可直接当直播源导入影视仓 / DIYP）。
 *
 * @param matches 赛事列表
 * @return TXT 文本（以单个 `\n` 结尾）
 */
export function renderLiveTxt(matches: readonly LiveMatch[], now: number = Date.now()): string {
  const groups = collectGroups(matches, now);
  const lines: string[] = [];
  let isFirst = true;

  for (const { group, items } of groups) {
    if (!isFirst) {
      lines.push('');
    }
    isFirst = false;
    lines.push(`${group},${GENRE_MARKER}`);
    for (const [label, url] of items) {
      lines.push(`${label},${url}`);
    }
  }

  if (lines.length === 0) {
    return '';
  }
  return `${lines.join('\n')}\n`;
}

/**
 * 渲染 M3U（带台标与分组，播放器识别更准）。
 *
 * @param matches 赛事列表
 * @return M3U 文本
 */
export function renderLiveM3u(matches: readonly LiveMatch[], now: number = Date.now()): string {
  const lines: string[] = ['#EXTM3U'];
  for (const match of matches) {
    for (const variant of match.variants) {
      const attributes = [`group-title="${groupLabel(match)}"`];
      if (match.logo !== undefined && match.logo.length > 0) {
        attributes.unshift(`tvg-logo="${match.logo}"`);
      }
      lines.push(`#EXTINF:-1 ${attributes.join(' ')},${entryLabel(match, variant.line, now)}`);
      lines.push(variant.url);
    }
  }
  return `${lines.join('\n')}\n`;
}

/**
 * 判断基址是否只是回环地址（只有本机能播）。
 *
 * @param base 形如 `http://192.168.1.7:18765`
 * @return true 表示回环
 */
function isLoopbackBase(base: string): boolean {
  try {
    const host = new URL(base).hostname.toLowerCase();
    return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
  } catch {
    return true;
  }
}

/**
 * 生成并落盘赛事直播产物。
 *
 * @param options 路径与注入依赖
 * @return 抓取结果（含是否写出）
 */
export async function emitLive(
  options: {
    txtPath?: string;
    m3uPath?: string;
    fetchImpl?: typeof fetch;
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<{ ok: boolean; matches: LiveMatch[]; error?: string }> {
  const txtPath = options.txtPath ?? PATHS.liveTxt;
  const m3uPath = options.m3uPath ?? PATHS.liveM3u;

  const outcome = await fetchLiveMatches({
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    ...(options.env === undefined ? {} : { env: options.env }),
  });
  if (!outcome.ok) {
    return { ok: false, matches: [], ...(outcome.error === undefined ? {} : { error: outcome.error }) };
  }

  // 没探到局域网地址时产物里只会是 127.0.0.1，推到线上等于把已经能用的清单弄坏。
  // 这种情况下宁可不动，等手机连回 Wi-Fi / 开热点后重新构建。
  //
  // 例外：**手机自己用影视仓播放**时，127.0.0.1 恰恰是最稳的地址（不依赖 Wi-Fi）。
  // 这种情况用 IPTV_ALLOW_LOOPBACK_BASE=1 显式放行，默认行为保持不变。
  // 注意：这里必须默认读 **process.env**。流水线（liveOnly.ts）调用 emitLive 时不传
  // env，只写在命令行前缀上的 IPTV_ALLOW_LOOPBACK_BASE 会被漏掉，开关等于失效。
  const env = options.env ?? process.env;
  const allowLoopback = (env.IPTV_ALLOW_LOOPBACK_BASE ?? '').trim() === '1';
  if (!allowLoopback && isLoopbackBase(outcome.publicBase)) {
    return {
      ok: false,
      matches: [],
      error: '没有可用的局域网地址（手机只连了蜂窝网？），为避免覆盖线上可用清单，本次不写产物'
        + '；若是手机自己播放，加 IPTV_ALLOW_LOOPBACK_BASE=1 放行',
    };
  }

  // 赛程回填：只查当前清单里真出现过的大联赛（免费接口有频率限制，别乱打）
  const leagues = [...new Set(outcome.matches.map((match) => match.league))]
    .filter((league) => LEAGUE_IDS[league] !== undefined);
  let scheduleHit = 0;
  if (leagues.length > 0) {
    const events = await fetchSchedule(leagues, {
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    });
    scheduleHit = attachSchedule(outcome.matches, events);
    if (scheduleHit > 0) {
      // 补上时间后顺序会变（同状态内按开赛时间排），重排一次
      outcome.matches.sort(compareMatches);
    }
  }

  const txt = renderLiveTxt(outcome.matches);
  const m3u = renderLiveM3u(outcome.matches);
  if (txt.length === 0) {
    return { ok: false, matches: [], error: '渲染结果为空' };
  }

  await writeTextFile(txtPath, txt);
  await writeTextFile(m3uPath, m3u);

  // 影视仓 / TVBox 的「配置地址」要的是 **JSON**，直接填 m3u 会解析失败（表现为超时/加载失败）。
  // 这里顺手产出一份最小可用配置：lives 指向本机网页服务上的 m3u。
  const servePort = (env.SERVE_PORT ?? '18080').trim() || '18080';
  const webBase = `${outcome.publicBase.replace(/:\d+$/, '')}:${servePort}`;
  const tvboxConfig = {
    sites: [],
    lives: [
      {
        name: '赛事',
        type: 0,
        url: `${webBase}/live/live.m3u`,
        playerType: 1,
        ua: '',
        epg: '',
      },
    ],
  };
  const configPath = m3uPath.replace(/live\.m3u$/, 'config.json');
  await writeTextFile(configPath, `${JSON.stringify(tvboxConfig, null, 2)}\n`);

  const variantCount = outcome.matches.reduce((total, match) => total + match.variants.length, 0);
  const liveCount = outcome.matches.filter((match) => match.status === 'live').length;
  log.info(
    'live',
    `写出 ${txtPath}，${outcome.matches.length} 场赛事 / ${variantCount} 条线路（直播中 ${liveCount} 场，`
      + `赛程命中 ${scheduleHit} 场），对外地址 ${outcome.publicBase}，影视仓配置 ${configPath}`,
  );
  return { ok: true, matches: outcome.matches };
}