/**
 * @file NBA 每日赛程产物（dist/nba/today.txt 与 today.m3u）。
 *
 * 做两件事：
 *   1. 从 ESPN scoreboard 取比赛（对阵、北京时间开赛时间、美东赛程日、转播台）；
 *   2. 把每场比赛里「本仓库确实有存活源」的转播台，映射成可直接播放的地址。
 *
 * 时间口径（实测确认，别混淆）：
 *   ESPN 的 `?dates=YYYYMMDD` 是**美东赛程日**。传 `20261021` 返回的比赛，北京时间
 *   全部落在 10/22（北京上午 = 美东前一天晚上）。所以第 1 步要按美东日期请求，
 *   第 2 步展示时把美东日期一并写出来，避免「北京 10-22 到底是美东哪天的比赛」的歧义。
 *
 * 产出的 TXT 可当直播源直接导入影视仓：每场比赛是一个频道，名字形如
 * `10-23 07:00 骑士 @ 76 人（美东 10-22）`，并按「直播中 / 待播 / 已结束」分组；
 * 没有匹配到源的比赛只列转播台名、不挂地址（避免导入一个点开没反应的死条目）。
 *
 * 失败策略：赛程接口不可达时**不写产物**（保留上一版），只打日志，绝不影响主列表。
 */

import { NBA, PATHS } from '../config';
import type { Channel } from '../types';
import { writeTextFile } from '../util/fsx';
import { log } from '../util/logger';
import { CST_OFFSET_MS, formatEasternDate, toCstParts, toCompactDate } from '../util/time';

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
  /** 北京时间日期 `MM-DD` */
  dayCst: string;
  /** 该场比赛所属的**美东赛程日** `MM-DD`（ESPN 的 dates 口径） */
  usDayCst: string;
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

/** 比赛所属的美东赛程日（`YYYYMMDD`）。 */
interface DatedEvent {
  event: EspnEvent;
  /** ESPN 的 dates 口径：美东赛程日 `YYYYMMDD` */
  usDateKey: string;
}

/** 单日赛程的原始返回（还没打上美东赛程日标记）。 */
interface DayFetchOutcome {
  ok: boolean;
  events: EspnEvent[];
  error?: string;
}

/** 赛程获取结果。 */
interface FetchOutcome {
  ok: boolean;
  events: DatedEvent[];
  error?: string;
}

const pad2 = (value: number): string => String(value).padStart(2, '0');

/** 毫秒形式的「一天」。 */
const DAY_MS = 24 * 60 * 60 * 1000;

/** 美东赛程日 `YYYYMMDD`（ESPN 的 dates 口径）。 */
function easternDateKey(ms: number): string {
  return toCompactDate(formatEasternDate(ms));
}

/** 在 `YYYYMMDD` 上加减天数。 */
function addDays(key: string, days: number): string {
  const base = Date.UTC(
    Number(key.slice(0, 4)),
    Number(key.slice(4, 6)) - 1,
    Number(key.slice(6, 8)),
  );
  const shifted = new Date(base + days * DAY_MS);
  return `${shifted.getUTCFullYear()}${pad2(shifted.getUTCMonth() + 1)}${pad2(shifted.getUTCDate())}`;
}

/** `YYYYMMDD` → `MM-DD`。 */
function compactToDayText(key: string): string {
  return `${key.slice(4, 6)}-${key.slice(6, 8)}`;
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
async function fetchOneDay(fetchImpl: typeof fetch, dateKey: string): Promise<DayFetchOutcome> {
  let last: DayFetchOutcome = { ok: false, events: [], error: '未发起请求' };
  for (let attempt = 0; attempt <= NBA.retries; attempt += 1) {
    last = await fetchOneDayOnce(fetchImpl, dateKey);
    if (last.ok) {
      return last;
    }
  }
  return last;
}

/**
 * 把 fetch 异常压成一行可读文案。
 *
 * undici 只抛 `TypeError: fetch failed`，真实原因（ECONNRESET / UND_ERR_CONNECT_TIMEOUT 等）
 * 藏在 `cause` 里，不打出来就无法判断是国内网络抖动还是接口被限流。
 *
 * @param error 捕获到的异常
 * @return 一行错误描述
 */
function describeFetchError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const cause = error.cause as { code?: string; message?: string } | undefined;
  const detail = cause?.code ?? cause?.message;
  return detail === undefined ? error.message : `${error.message}（${detail}）`;
}

/**
 * 单次请求某一天的赛程。
 *
 * @param fetchImpl 注入的 fetch
 * @param dateKey `YYYYMMDD`
 * @return 当天的 event 列表
 */
async function fetchOneDayOnce(fetchImpl: typeof fetch, dateKey: string): Promise<DayFetchOutcome> {
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
    return { ok: false, events: [], error: describeFetchError(error) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 取窗口内的比赛：按**美东赛程日**逐日请求 [窗口首日, 窗口首日+windowDays]，
 * 按 `date + name` 去重（实测同一场比赛只会出现在一个 dates 键下）。
 *
 * 为什么用美东日期而不是北京日期请求：ESPN 的 `dates` 是美东赛程日口径。
 * 窗口起点是「北京时间今天 00:00」，此时美东还停在前一天中午，所以直接用
 * 北京日期当 key 会整体错一天，展示出来的「美东日期」也会跟着错。
 *
 * 为什么逐日**串行**而不是 `Promise.all`：实测国内直连时并发 8 个请求会整批
 * `UND_ERR_CONNECT_TIMEOUT`（重试也救不回来），串行则 9 天全部 200、合计约 6 秒。
 * 并发在这里只省下几秒，却会让整份赛程凭空消失，不划算。
 *
 * @param fetchImpl 注入的 fetch
 * @param nowMs 当前时间
 * @return 合并后的 event 列表
 */
export async function fetchNbaEvents(fetchImpl: typeof fetch, nowMs: number): Promise<FetchOutcome> {
  const firstKey = easternDateKey(cstDayStartMs(nowMs));
  const keys: string[] = [];
  for (let offset = 0; offset <= NBA.windowDays; offset += 1) {
    keys.push(addDays(firstKey, offset));
  }
  const outcomes: DayFetchOutcome[] = [];
  for (const key of keys) {
    outcomes.push(await fetchOneDay(fetchImpl, key));
  }
  // 冷启动兜底：构建流程里测活（64 并发）刚结束时连接池很脏，赛程第一天经常整轮失败，
  // 而后面几天正常。所以等连接被暖起来之后，再对失败的那几天补一轮。
  for (let index = 0; index < keys.length; index += 1) {
    if (!outcomes[index].ok) {
      outcomes[index] = await fetchOneDay(fetchImpl, keys[index]);
    }
  }

  const failedKeys = keys.filter((_, index) => !outcomes[index].ok);
  if (failedKeys.length === keys.length) {
    return {
      ok: false,
      events: [],
      error: outcomes.map((item) => item.error ?? '未知错误').join('；'),
    };
  }
  // 部分失败必须告警：静默丢一整天会让人以为「那天没有比赛」。
  if (failedKeys.length > 0) {
    log.warn('nba', `美东 ${failedKeys.join('/')} 共 ${failedKeys.length} 天赛程拉取失败，这些天可能漏场次`);
  }

  const seen = new Set<string>();
  const merged: DatedEvent[] = [];
  for (let index = 0; index < keys.length; index += 1) {
    for (const event of outcomes[index].events) {
      const key = `${event.date ?? ''}|${event.name ?? ''}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      // 实测同一场比赛只会出现在一个 dates 键下，所以直接取请求它的那一天当美东赛程日。
      merged.push({ event, usDateKey: keys[index] });
    }
  }
  return { ok: true, events: merged };
}

/**
 * 建「转播台名 → 本仓库频道」索引，只收录已测活通过的频道。
 *
 * 比对时两侧都去掉空格，这样配置里可以写成人读的 `NBA TV`，
 * 而本仓库频道名 `NBA TV` 与 ESPN 台名 `NBA TV` 都能命中。
 *
 * @param channels 优选后的频道
 * @return 大写转播台名 → 频道
 */
export function buildStationIndex(channels: readonly Channel[]): Map<string, Channel> {
  const index = new Map<string, Channel>();
  for (const channel of channels) {
    const normalized = channel.name.replace(/\s/g, '').toUpperCase();
    for (const [alias, stations] of Object.entries(NBA.channelAliases)) {
      if (normalized !== alias.replace(/\s/g, '').toUpperCase()) {
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
 * @param dated ESPN event 与其所属美东赛程日
 * @param stationIndex 转播台索引
 * @param windowStartMs 窗口起点（北京时间今天 00:00）
 * @param windowEndMs 窗口终点
 * @return 比赛对象；不在窗口内或结构异常时返回 null
 */
export function toGame(
  dated: DatedEvent,
  stationIndex: Map<string, Channel>,
  windowStartMs: number,
  windowEndMs: number,
): NbaGame | null {
  const event = dated.event;
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
  const rawState = competition.status?.type?.state ?? 'pre';

  return {
    title: `${awayName} @ ${homeName}`,
    startCst: `${dayText} ${timeText}`,
    dayCst: dayText,
    usDayCst: compactToDayText(dated.usDateKey),
    // 只认三个取值，其余（接口新增状态、字段缺失）按未开赛处理，渲染层就不必再兜底。
    state: rawState === 'in' || rawState === 'post' ? rawState : 'pre',
    stations,
    sources,
  };
}

/**
 * 分组顺序：能看的排在最前，已经结束的沉到最底，方便电视端首屏就看到待播场次。
 */
const STATE_GROUPS: ReadonlyArray<readonly [string, string]> = [
  ['in', 'NBA 直播中'],
  ['pre', 'NBA 待播'],
  ['post', 'NBA 已结束'],
];

/** 单场比赛的 TXT 行（含美东赛程日，避免北京时间与美东日期混淆）。 */
function renderGameLine(game: NbaGame): string {
  const head = `${game.startCst} ${game.title}（美东 ${game.usDayCst}`;
  if (game.sources.length > 0) {
    return `${head}）,${game.sources.map((source) => source.url).join('#')}`;
  }
  const stations = game.stations.length > 0 ? game.stations.join('/') : '暂无转播信息';
  return `${head}｜${stations}，本仓库暂无对应源）`;
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
  const lines: string[] = [];
  let isFirstGroup = true;
  for (const [state, label] of STATE_GROUPS) {
    const group = games.filter((game) => game.state === state);
    if (group.length === 0) {
      continue;
    }
    if (!isFirstGroup) {
      lines.push('');
    }
    isFirstGroup = false;
    lines.push(`${label},#genre#`);
    for (const game of group) {
      lines.push(renderGameLine(game));
    }
  }
  return `${lines.join('\n')}\n`;
}

/**
 * 渲染 M3U：已经打完的比赛不写入，省得导入后点开是空。
 *
 * @param games 比赛列表
 * @return M3U 文本
 */
export function renderNbaM3u(games: readonly NbaGame[]): string {
  const lines: string[] = ['#EXTM3U'];
  for (const game of games) {
    if (game.state === 'post') {
      continue;
    }
    for (const source of game.sources) {
      lines.push(
        `#EXTINF:-1 group-title="NBA",${game.startCst} ${game.title}（美东 ${game.usDayCst}）(${source.station})`,
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
  for (const dated of fetched.events) {
    const game = toGame(dated, stationIndex, windowStartMs, windowEndMs);
    if (game !== null) {
      games.push(game);
    }
  }
  games.sort((left, right) => (left.startCst < right.startCst ? -1 : left.startCst > right.startCst ? 1 : 0));

  const withSources = games.filter((game) => game.sources.length > 0).length;
  const upcoming = games.filter((game) => game.state !== 'post').length;
  log.info(
    'nba',
    `写出 ${txtPath}，${games.length} 场比赛中 ${withSources} 场有可用源（未结束 ${upcoming} 场）`,
  );
  await writeTextFile(txtPath, renderNbaTxt(games));
  await writeTextFile(m3uPath, renderNbaM3u(games));
  return { ok: true, games };
}
