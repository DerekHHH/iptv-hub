/**
 * @file 第三方赛程回填（给大联赛的赛事补开赛时间/比分）。
 *
 * ## 为什么需要这个模块
 * 上游 `wudaliansai` 的 `/live.m3u` **只有队名和台标**，没有开赛时间（已挖过二进制：
 * 它只有 `/live.m3u`、`/play/{key}`、`/health` 三条路由，`RUST_LOG=trace` 也不输出
 * 任何比赛数据）。所以时间只能从**外部赛程源**补。
 *
 * ## 数据源
 * TheSportsDB 免费接口（key `123`）：
 *   `eventsday.php?d=YYYY-MM-DD&l=<联赛ID>`
 * 返回里 `strTimestamp` 是 **UTC**（不带 Z），加分换算成北京时间即可；
 * 另外还带 `intHomeScore` / `intAwayScore`，完场能顺手显示比分。
 *
 * ## 只补大联赛（用户拍板的取舍）
 * 小联赛（拉美、东南亚、澳洲…）第三方基本没有，硬套会张冠李戴。
 * 所以只在 `LEAGUE_IDS` 里的联赛才去查，认不出的队就不填时间 ——
 * **宁可没时间，也不要错时间**。
 *
 * ## 失败策略
 * 任何请求失败都静默跳过（只记 info 日志）。赛程是锦上添花，
 * 绝不能因为它让整个赛事清单构建失败。
 */

import { TEAM_ALIASES, toEnglishKeyword } from '../data/team-names';
import type { LiveMatch } from './wudaliansai';
import { log } from '../util/logger';

/** 赛程源基址（免费 key 123）。 */
const API_BASE = 'https://www.thesportsdb.com/api/v1/json/123';

/** 我们的联赛名 → TheSportsDB 联赛 ID。 */
export const LEAGUE_IDS: Readonly<Record<string, number>> = {
  NBA: 4387,
  CBA: 4442,
  英超: 4328,
  西甲: 4335,
  意甲: 4332,
  德甲: 4331,
  法甲: 4334,
  中超: 4359,
  欧冠: 4480,
};

/** 北京时间相对 UTC 的毫秒偏移。 */
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 一条赛程事件。 */
export interface ScheduleEvent {
  /** 我们的联赛名（NBA / 英超 / …） */
  league: string;
  /** 主队英文名（原样保留，用于匹配） */
  homeEn: string;
  /** 客队英文名 */
  awayEn: string;
  /** 开赛时间（epoch 毫秒，UTC 基准） */
  startAt: number;
  /** 主队得分（拿不到则无） */
  homeScore?: number;
  /** 客队得分 */
  awayScore?: number;
  /** 是否已完场 */
  ended: boolean;
}

/**
 * 把 epoch 毫秒格式化成北京时间 `YYYY-MM-DD`。
 *
 * @param epochMs epoch 毫秒
 * @return 日期串
 */
export function beijingDate(epochMs: number): string {
  const local = new Date(epochMs + BEIJING_OFFSET_MS);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
}

/**
 * 解析 TheSportsDB 的 `strTimestamp`（UTC，不带 Z）。
 *
 * @param text 形如 `2026-10-26T01:00:00`
 * @return epoch 毫秒；解析失败返回 undefined
 */
export function parseTimestamp(text: unknown): number | undefined {
  if (typeof text !== 'string' || text.length === 0) {
    return undefined;
  }
  // 不带时区标记时按 UTC 解释
  const normalized = /[zZ]|[+-]\d{2}:?\d{2}$/.test(text) ? text : `${text}Z`;
  const value = Date.parse(normalized);
  return Number.isNaN(value) ? undefined : value;
}

/**
 * 把 API 返回的一条 event 转成内部结构。
 *
 * @param raw 原始对象
 * @param league 我们的联赛名
 * @return 赛程事件；字段不全返回 undefined
 */
function toEvent(raw: Record<string, unknown>, league: string): ScheduleEvent | undefined {
  const startAt = parseTimestamp(raw.strTimestamp);
  const homeEn = typeof raw.strHomeTeam === 'string' ? raw.strHomeTeam : '';
  const awayEn = typeof raw.strAwayTeam === 'string' ? raw.strAwayTeam : '';
  if (startAt === undefined || homeEn.length === 0 || awayEn.length === 0) {
    return undefined;
  }
  const toScore = (value: unknown): number | undefined => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && /^\d+$/.test(value)) {
      return Number(value);
    }
    return undefined;
  };
  const status = typeof raw.strStatus === 'string' ? raw.strStatus.toUpperCase() : '';
  const homeScore = toScore(raw.intHomeScore);
  const awayScore = toScore(raw.intAwayScore);
  const event: ScheduleEvent = {
    league,
    homeEn,
    awayEn,
    startAt,
    ended: status === 'FT' || status === 'AET' || status === 'PEN' || homeScore !== undefined,
  };
  if (homeScore !== undefined) {
    event.homeScore = homeScore;
  }
  if (awayScore !== undefined) {
    event.awayScore = awayScore;
  }
  return event;
}

/**
 * 拉取指定联赛、指定日期的赛程。
 *
 * @param league 我们的联赛名
 * @param date 日期 `YYYY-MM-DD`
 * @param fetchImpl 注入的 fetch（测试用）
 * @return 赛程事件（失败返回空数组）
 */
async function fetchLeagueDay(
  league: string,
  date: string,
  fetchImpl: typeof fetch,
): Promise<ScheduleEvent[]> {
  const id = LEAGUE_IDS[league];
  if (id === undefined) {
    return [];
  }
  const url = `${API_BASE}/eventsday.php?d=${date}&l=${id}`;
  try {
    const response = await fetchImpl(url, {
      headers: { 'user-agent': 'iptv-hub/1.0' },
    });
    if (!response.ok) {
      return [];
    }
    const payload = (await response.json()) as { events?: Array<Record<string, unknown>> | null };
    const list = payload.events ?? [];
    const events: ScheduleEvent[] = [];
    for (const raw of list) {
      const event = toEvent(raw, league);
      if (event !== undefined) {
        events.push(event);
      }
    }
    return events;
  } catch {
    return [];
  }
}

/**
 * 拉取「今天（北京时间）」所有相关大联赛的赛程。
 *
 * 只查**当前清单里真的出现过**的联赛，避免无谓请求（免费接口有频率限制）。
 * 时区注意：UTC 的今天和北京时间的今天可能差一天，所以按北京日期前后各取一天。
 *
 * @param leagues 需要查的联赛集合
 * @param options 注入依赖
 * @return 赛程事件（按 idEvent 去重后）
 */
export async function fetchSchedule(
  leagues: readonly string[],
  options: { fetchImpl?: typeof fetch; now?: number } = {},
): Promise<ScheduleEvent[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now();
  const targets = leagues.filter((league) => LEAGUE_IDS[league] !== undefined);
  if (targets.length === 0) {
    return [];
  }

  // 北京时间今天的前一天 / 今天 / 后一天（UTC 与北京日期错位时也能覆盖）
  const dates = [beijingDate(now - 86400000), beijingDate(now), beijingDate(now + 86400000)];

  const tasks: Array<Promise<ScheduleEvent[]>> = [];
  for (const league of targets) {
    for (const date of dates) {
      tasks.push(fetchLeagueDay(league, date, fetchImpl));
    }
  }

  const results = await Promise.all(tasks);
  const merged = new Map<string, ScheduleEvent>();
  for (const event of results.flat()) {
    // 用「联赛 + 双方队名」当键做去重（同一天重复拉到同一条）
    merged.set(`${event.league}|${event.homeEn}|${event.awayEn}|${event.startAt}`, event);
  }
  const events = [...merged.values()];
  log.info('schedule', `赛程回填：查了 ${targets.length} 个联赛，拿到 ${events.length} 条事件`);
  return events;
}

/**
 * 用赛程事件给一场比赛找对应的时间。
 *
 * 匹配规则：两边队名各自翻成英文特征词，然后在赛程里找**同时包含两个特征词**的事件
 * （主客顺序不敏感 —— 上游和赛程源的主客顺序不一定一致）。
 *
 * @param category 分类（篮球 / 足球）
 * @param title 赛事标题，如 `雷霆 vs 掘金`
 * @param events 赛程事件
 * @return 命中的事件；找不到返回 undefined
 */
export function findSchedule(
  category: string,
  title: string,
  events: readonly ScheduleEvent[],
): ScheduleEvent | undefined {
  const teams = title
    .split(/\s*vs\.?\s*/i)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (teams.length < 2) {
    return undefined;
  }
  const keywords = teams
    .map((team) => toEnglishKeyword(category, team))
    .filter((keyword) => keyword.length > 0);
  if (keywords.length < 2) {
    return undefined;
  }

  for (const event of events) {
    const haystack = `${event.homeEn} ${event.awayEn}`.toLowerCase();
    if (keywords.every((keyword) => haystack.includes(keyword))) {
      return event;
    }
  }
  return undefined;
}

/**
 * 就地给比赛列表补开赛时间与比分。
 *
 * @param matches 赛事列表（会被就地修改）
 * @param events 赛程事件
 * @return 命中数量
 */
export function attachSchedule(
  matches: readonly LiveMatch[],
  events: readonly ScheduleEvent[],
): number {
  if (events.length === 0) {
    return 0;
  }
  let hit = 0;
  for (const match of matches) {
    if (match.category !== '篮球' && match.category !== '足球') {
      continue;
    }
    const event = findSchedule(match.category, match.title, events);
    if (event === undefined) {
      continue;
    }
    match.startAt = event.startAt;
    if (event.homeScore !== undefined && event.awayScore !== undefined) {
      match.score = `${event.homeScore}-${event.awayScore}`;
    }
    hit += 1;
  }
  return hit;
}

/**
 * 判断一个有队名表的分类是否可能参与赛程匹配（供调用方提前筛联赛）。
 *
 * @param category 分类
 * @return true 表示有大联赛队名映射
 */
export function hasTeamAliases(category: string): boolean {
  return TEAM_ALIASES[category] !== undefined;
}
