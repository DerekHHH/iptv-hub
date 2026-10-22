/**
 * @file NBA 每日赛程产物（dist/nba/today.txt 与 today.m3u）。
 *
 * 做两件事：
 *   1. 从 ESPN scoreboard 取比赛（对阵、北京时间开赛时间、转播台）；
 *   2. 把每场比赛里「本仓库确实有存活源」的转播台，映射成可直接播放的地址。
 *
 * 产出的 TXT 可当直播源直接导入影视仓：每场比赛是一个频道，名字形如
 * `10-23 07:00 骑士 @ 76 人`，地址是 ESPN / ESPNU 的源；没有匹配到源的比赛
 * 只列转播台名、不挂地址（避免导入一个点开没反应的死条目）。
 *
 * 失败策略：赛程接口不可达时**不写产物**（保留上一版），只打日志，绝不影响主列表。
 */

import { NBA, PATHS } from '../config';
import type { Channel } from '../types';
import { writeTextFile } from '../util/fsx';
import { log } from '../util/logger';
import { CST_OFFSET_MS, toCstParts } from '../util/time';

/** 常见球队中文名（按 ESPN 的 shortDisplayName 索引）。 */
const TEAM_CN: Readonly<Record<string, string>> = {
  Cavaliers: '骑士',
  '76ers': '76人',
  Nuggets: '掘金',
  Thunder: '雷霆',
  Warriors: '勇士',
  Lakers: '湖人',
  Celtics: '凯尔特人',
  Knicks: '尼克斯',
  Heat: '热火',
  Bucks: '雄鹿',
  Bulls: '公牛',
  Mavericks: '独行侠',
  Rockets: '火箭',
  Suns: '太阳',
  Clippers: '快船',
  Kings: '国王',
  Spurs: '马刺',
  Grizzlies: '灰熊',
  Pelicans: '鹈鹕',
  Timberwolves: '森林狼',
  Pacers: '步行者',
  Hawks: '老鹰',
  Hornets: '黄蜂',
  Magic: '魔术',
  Wizards: '奇才',
  Raptors: '猛龙',
  Nets: '篮网',
  Pistons: '活塞',
  'Trail Blazers': '开拓者',
  Jazz: '爵士',
};

/** 一场比赛里匹配到的可播放源。 */
export interface GameSource {
  /** 转播台名（ESPN / ESPNU / ESPN2） */
  station: string;
  /** 本仓库里的频道名 */
  channelName: string;
  /** 播放地址 */
  url: string;
}

/** 一场比赛。 */
export interface NbaGame {
  /** 例 '骑士 @ 76人' */
  title: string;
  /** 北京时间 `MM-DD HH:mm`，缺失时为空串 */
  startCst: string;
  /** 北京时间日期 `MM-DD`，用于分组 */
  dayCst: string;
  /** pre / in / post */
  state: string;
  /** 全部转播台（含本仓库没有的） */
  stations: string[];
  /** 已匹配到本仓库存活源的条目 */
  sources: GameSource[];
}

/** ESPN 返回体里用到的字段。 */
interface EspnEvent {
  name?: string;
  date?: string;
  competitions?: Array<{
    status?: { type?: { state?: string } };
    competitors?: Array<{
      homeAway?: string;
      score?: string;
      team?: { displayName?: string; shortDisplayName?: string; abbreviation?: string };
    }>;
    broadcasts?: Array<{ names?: string[] }>;
  }>;
}

/** 赛程获取结果。 */
interface FetchOutcome {
  ok: boolean;
  events: EspnEvent[];
  error?: string;
}

const pad2 = (value: number): string => String(value).padStart(2, '0');

/** 北京时间 `YYYYMMDD`。 */
function cstDateKey(ms: number): string {
  const p = toCstParts(ms);
  return `${p.year}${pad2(p.month)}${pad2(p.day)}`;
}

/** 北京时间当天 00:00 对应的毫秒时间戳。 */
function cstDayStartMs(ms: number): number {
  const p = toCstParts(ms);
  return Date.UTC(p.year, p.month - 1, p.day) - CST_OFFSET_MS;
}

/** 单个球队的中文标签。 */
function teamLabel(competitor: {
  team?: { displayName?: string; shortDisplayName?: string; abbreviation?: string };
}): string {
  const team = competitor.team;
  const short = team?.shortDisplayName ?? team?.displayName ?? team?.abbreviation ?? '未知球队';
  return TEAM_CN[short] ?? short;
}

/**
 * 请求某一天（ESPN 口径）的赛程，失败按 `NBA.retries` 重试。
 *
 * @param fetchImpl 注入的 fetch
 * @param dateKey `YYYYMMDD`
 * @return 当天的 event 列表
 */
async function fetchOneDay(fetchImpl: typeof fetch, dateKey: string): Promise<FetchOutcome> {
  let last: FetchOutcome = { ok: false, events: [], error: '未发起请求' };
  for (let attempt = 0; attempt <= NBA.retries; attempt += 1) {
    last = await fetchOneDayOnce(fetchImpl, dateKey);
    if (last.ok) {
      return last;
    }
  }
  return last;
}

/**
 * 单次请求某一天的赛程。
 *
 * @param fetchImpl 注入的 fetch
 * @param dateKey `YYYYMMDD`
 * @return 当天的 event 列表
 */
async function fetchOneDayOnce(fetchImpl: typeof fetch, dateKey: string): Promise<FetchOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NBA.timeoutMs);
  try {
    const response = await fetchImpl(`${NBA.scoreboardUrl}?dates=${dateKey}`, {
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, events: [], error: `HTTP ${response.status}` };
    }
    const payload = (await response.json()) as { events?: EspnEvent[] };
    return { ok: true, events: payload.events ?? [] };
  } catch (error) {
    return {
      ok: false,
      events: [],
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 取窗口内的比赛：并发拉 D-1 / D / D+1 三天，按 `date + name` 去重。
 *
 * 为什么是三天：ESPN 的 `dates` 按美东日期分组，北京上午的比赛属于美东前一天；
 * 多拉一天可以覆盖夏令时切换与跨日边界。
 *
 * @param fetchImpl 注入的 fetch
 * @param nowMs 当前时间
 * @return 合并后的 event 列表
 */
export async function fetchNbaEvents(fetchImpl: typeof fetch, nowMs: number): Promise<FetchOutcome> {
  const dayMs = 24 * 60 * 60 * 1000;
  const keys = [
    cstDateKey(nowMs - dayMs),
    cstDateKey(nowMs),
    cstDateKey(nowMs + dayMs),
  ];
  const outcomes = await Promise.all(keys.map((key) => fetchOneDay(fetchImpl, key)));

  const errors = outcomes.filter((item) => !item.ok).map((item) => item.error ?? '未知错误');
  if (outcomes.every((item) => !item.ok)) {
    return { ok: false, events: [], error: errors.join('；') };
  }

  const seen = new Set<string>();
  const merged: EspnEvent[] = [];
  for (const outcome of outcomes) {
    for (const event of outcome.events) {
      const key = `${event.date ?? ''}|${event.name ?? ''}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(event);
    }
  }
  return { ok: true, events: merged };
}

/**
 * 建「转播台名 → 本仓库频道」索引，只收录已测活通过的频道。
 *
 * @param channels 优选后的频道
 * @return 大写转播台名 → 频道
 */
export function buildStationIndex(channels: readonly Channel[]): Map<string, Channel> {
  const index = new Map<string, Channel>();
  for (const channel of channels) {
    const normalized = channel.name.replace(/\s/g, '').toUpperCase();
    for (const [alias, stations] of Object.entries(NBA.channelAliases)) {
      if (normalized !== alias.toUpperCase()) {
        continue;
      }
      const renamed: Channel = { ...channel, name: alias };
      for (const station of stations) {
        index.set(station.toUpperCase(), renamed);
      }
    }
  }
  return index;
}

/**
 * 把 ESPN event 转成比赛对象。
 *
 * @param event ESPN event
 * @param stationIndex 转播台索引
 * @param windowStartMs 窗口起点（北京时间今天 00:00）
 * @param windowEndMs 窗口终点
 * @return 比赛对象；不在窗口内或结构异常时返回 null
 */
export function toGame(
  event: EspnEvent,
  stationIndex: Map<string, Channel>,
  windowStartMs: number,
  windowEndMs: number,
): NbaGame | null {
  const competition = event.competitions?.[0];
  if (competition === undefined || event.date === undefined) {
    return null;
  }
  const startMs = Date.parse(event.date);
  if (Number.isNaN(startMs) || startMs < windowStartMs || startMs >= windowEndMs) {
    return null;
  }

  const home = competition.competitors?.find((item) => item.homeAway === 'home');
  const away = competition.competitors?.find((item) => item.homeAway === 'away');
  const awayName = away === undefined ? '客队' : teamLabel(away);
  const homeName = home === undefined ? '主队' : teamLabel(home);

  const stations: string[] = [];
  for (const broadcast of competition.broadcasts ?? []) {
    for (const name of broadcast.names ?? []) {
      if (!stations.includes(name)) {
        stations.push(name);
      }
    }
  }

  const sources: GameSource[] = [];
  for (const station of stations) {
    const channel = stationIndex.get(station.toUpperCase());
    if (channel === undefined) {
      continue;
    }
    for (const stream of channel.streams.slice(0, NBA.maxSourcesPerGame)) {
      sources.push({ station, channelName: channel.name, url: stream.url });
    }
  }

  const p = toCstParts(startMs);
  const timeText = `${pad2(p.hour)}:${pad2(p.minute)}`;
  const dayText = `${pad2(p.month)}-${pad2(p.day)}`;

  return {
    title: `${awayName} @ ${homeName}`,
    startCst: `${dayText} ${timeText}`,
    dayCst: dayText,
    state: competition.status?.type?.state ?? 'pre',
    stations,
    sources,
  };
}

/**
 * 渲染 TXT（可直接当直播源导入）。
 *
 * @param games 比赛列表
 * @return TXT 文本
 */
export function renderNbaTxt(games: readonly NbaGame[]): string {
  if (games.length === 0) {
    return '';
  }
  const lines: string[] = ['NBA 赛程,#genre#'];
  for (const game of games) {
    const label = `${game.startCst} ${game.title}`;
    if (game.sources.length > 0) {
      lines.push(`${label},${game.sources.map((source) => source.url).join('#')}`);
      continue;
    }
    const stations = game.stations.length > 0 ? game.stations.join('/') : '暂无转播信息';
    lines.push(`${label}（${stations}，本仓库暂无对应源）`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * 渲染 M3U。
 *
 * @param games 比赛列表
 * @return M3U 文本
 */
export function renderNbaM3u(games: readonly NbaGame[]): string {
  const lines: string[] = ['#EXTM3U'];
  for (const game of games) {
    for (const source of game.sources) {
      lines.push(
        `#EXTINF:-1 group-title="NBA",${game.startCst} ${game.title} (${source.station})`,
      );
      lines.push(source.url);
    }
  }
  return `${lines.join('\n')}\n`;
}

/**
 * 生成并落盘 NBA 产物。
 *
 * @param channels 优选后的频道（已测活）
 * @param options 路径与注入依赖
 * @return 比赛列表与结果
 */
export async function emitNba(
  channels: readonly Channel[],
  options: {
    txtPath?: string;
    m3uPath?: string;
    fetchImpl?: typeof fetch;
    now?: () => number;
  } = {},
): Promise<{ ok: boolean; games: NbaGame[]; error?: string }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const nowMs = (options.now ?? Date.now)();
  const txtPath = options.txtPath ?? PATHS.nbaTxt;
  const m3uPath = options.m3uPath ?? PATHS.nbaM3u;

  const fetched = await fetchNbaEvents(fetchImpl, nowMs);
  if (!fetched.ok) {
    return { ok: false, games: [], error: fetched.error };
  }

  const windowStartMs = cstDayStartMs(nowMs);
  const windowEndMs = windowStartMs + NBA.windowDays * 24 * 60 * 60 * 1000;
  const stationIndex = buildStationIndex(channels);

  const games: NbaGame[] = [];
  for (const event of fetched.events) {
    const game = toGame(event, stationIndex, windowStartMs, windowEndMs);
    if (game !== null) {
      games.push(game);
    }
  }
  games.sort((left, right) => (left.startCst < right.startCst ? -1 : left.startCst > right.startCst ? 1 : 0));

  const withSources = games.filter((game) => game.sources.length > 0).length;
  log.info(
    'nba',
    `写出 ${txtPath}，${games.length} 场比赛中 ${withSources} 场有可用源`,
  );
  await writeTextFile(txtPath, renderNbaTxt(games));
  await writeTextFile(m3uPath, renderNbaM3u(games));
  return { ok: true, games };
}
