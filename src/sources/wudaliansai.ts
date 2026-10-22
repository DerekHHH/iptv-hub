/**
 * @file wudaliansai 赛事聚合源（可选上游，只在手机本地构建时存在）。
 *
 * 它是跑在手机上的闭源服务：`/live.m3u` 给出当前赛事列表，`/play/{key}` 302
 * 跳到带时效签名的真实 m3u8。链接本身只能现取现用（auth_key 约 10 分钟过期），
 * 但 `/play/{key}` 入口是长期有效的，所以产物里写入口地址、让播放器每次重新跳转。
 *
 * 三条硬约束：
 *   1. **不进 `UPSTREAMS`**：GitHub Actions 上必然连不上，不能污染失败率统计；
 *      连不上就静默跳过，日志用 info 而不是 warn。
 *   2. **绝不写公网地址**：产物是公开仓库里的文件，只允许写局域网 IPv4
 *      （`192.168.x` / `10.x` / `172.16-31.x`）或回环地址，否则等于把手机暴露出去。
 *   3. **不做测活**：条目本身就是"正在直播"的列表，用户要的是全量；测活会额外
 *      打 168 次请求，还会因为网络抖动误删条目。
 */

import { networkInterfaces } from 'node:os';

import { WUDALIANSAI } from '../config';
import { parseM3U } from '../parse/parseM3U';
import type { Stream } from '../types';
import { describeError, fetchText } from '../util/http';
import { log } from '../util/logger';

/** 赛事状态：直播中 / 未开赛 / 暂无直播 / 已结束。 */
export type LiveStatus = 'live' | 'upcoming' | 'unavailable' | 'ended';

/** 同一场比赛的一条线路。 */
export interface LiveVariant {
  /** 线路名（`高清` / `赛场原声` / `英文解说` / `海外`），无线路名时为空串 */
  line: string;
  /** 播放地址（已改写成对外可达的主机） */
  url: string;
}

/** 一场赛事（多条线路合并成一条）。 */
export interface LiveMatch {
  /** 分类，即上游 `group-title`：足球 / 篮球 / 电竞 */
  category: string;
  /** 赛事标题，如 `湖人 vs 勇士` */
  title: string;
  /** 综合状态：任一条线在直播就算直播中 */
  status: LiveStatus;
  /** 台标 */
  logo?: string;
  /** 线路（已按画质优先排序） */
  variants: LiveVariant[];
}

/** 抓取结果。 */
export interface LiveFetchOutcome {
  ok: boolean;
  matches: LiveMatch[];
  /** 写进产物的基址（便于日志里核对） */
  publicBase: string;
  error?: string;
}

/** 基址解析结果。 */
export interface PublicBaseOutcome {
  base: string;
  /** 来源：环境变量 / 自动探测的局域网地址 / 回环兜底 */
  source: 'env' | 'lan' | 'loopback';
  /** 需要提醒用户的情况（如没探到局域网） */
  warning?: string;
}

/** 状态优先级：数字越小越靠前。 */
const STATUS_WEIGHT: Readonly<Record<LiveStatus, number>> = {
  live: 0,
  upcoming: 1,
  unavailable: 2,
  ended: 3,
};

/** 线路优先级（`高清` 排第一，播放器默认选它）。 */
const LINE_WEIGHT: Readonly<Record<string, number>> = {
  高清: 0,
  赛场原声: 1,
  英文解说: 2,
  海外: 3,
};

/**
 * 蜂窝接口名前缀。
 *
 * 实测手机在纯流量下会出现 `ccmni1 inet 10.2.6.86/8` —— 它落在 `10/8`，看起来
 * 像局域网地址，实际是运营商内网，同一个 Wi-Fi 里的电视**根本路由不到**。
 * 所以这类网卡必须整体排除，不能靠 IP 段判断。
 */
const CELLULAR_PREFIXES: readonly string[] = ['ccmni', 'rmnet', 'pdp', 'clat', 'qmi', 'wwan', 'usb'];

/**
 * 网卡优先级：Wi-Fi 客户端 → 手机热点 → 其它；蜂窝返回 null 表示排除。
 *
 * 手机开热点时地址挂在 `ap0` 上（实测 `192.168.x.x`），电视连的就是这个热点，
 * 所以它比「其它」网卡优先，但低于真正的 Wi-Fi 客户端地址。
 *
 * @param name 网卡名
 * @return 权重（越小越优先），null 表示不可用
 */
function interfaceRank(name: string): number | null {
  const lowered = name.toLowerCase();
  if (CELLULAR_PREFIXES.some((prefix) => lowered.startsWith(prefix))) {
    return null;
  }
  if (/^(wlan\d*|wi-?fi|无线)/.test(lowered)) {
    return 0;
  }
  if (/^(ap\d*|swlan\d*|softap)/.test(lowered)) {
    return 1;
  }
  return 2;
}

/**
 * 去掉基址末尾的斜杠。
 *
 * @param value 原始基址
 * @return 归一后的基址
 */
function trimBase(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

/**
 * 判断是否为保留/局域网 IPv4（不含回环）。
 *
 * @param ip 点分十进制地址
 * @return true 表示局域网地址
 */
export function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) {
    return false;
  }
  const [a, b] = parts.map(Number);
  if (![a, b].every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    return false;
  }
  if (a === 10) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  // 169.254/16 是链路本地地址，同一网段内仍可访问
  return a === 169 && b === 254;
}

/**
 * 取出基址里的主机名（解析失败返回 null）。
 *
 * @param base 形如 `http://192.168.1.7:18765` 的基址
 * @return 主机名
 */
function hostOf(base: string): string | null {
  try {
    return new URL(base).hostname;
  } catch {
    return null;
  }
}

/**
 * 判断是否为「公网 IPv4 字面量」（域名一律放行：用户用 DDNS 自建反代是合法需求）。
 *
 * @param host 主机名
 * @return true 表示公网 IP
 */
function isPublicIpv4Literal(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4) {
    return false;
  }
  const octets = parts.map(Number);
  if (!octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    return false;
  }
  if (isPrivateIpv4(host)) {
    return false;
  }
  // 回环也放行（只有本机能播，但至少没泄露什么）
  return !(octets[0] === 127);
}

/**
 * 判断是否为回环主机名。
 *
 * @param host 主机名
 * @return true 表示回环
 */
function isLoopbackHost(host: string): boolean {
  const lowered = host.toLowerCase();
  return (
    lowered === '127.0.0.1' ||
    lowered === 'localhost' ||
    lowered === '0.0.0.0' ||
    lowered === '::1' ||
    lowered === '[::1]'
  );
}

/**
 * 解析「拉列表」用的服务地址。
 *
 * @param env 环境变量（注入便于单测）
 * @return 基址（已去末尾斜杠）
 */
export function resolveServiceBase(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env[WUDALIANSAI.baseEnv];
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
    return trimBase(fromEnv);
  }
  return WUDALIANSAI.baseUrl;
}

/**
 * 免代理的对外基址安全闸：产物会进公开仓库，所以这里只肯产出
 * 「环境变量指定」或「本机局域网 IPv4」两类地址，公网地址永不放行。
 *
 * 残留风险（已告知用户）：局域网 IP 本身不可从公网路由，别人拿到也没法直连；
 * 但**同一 Wi-Fi 下的人**能访问到 18765 端口，所以服务只应在可信网络里开。
 *
 * @param options 注入的环境变量与网卡信息（便于单测）
 * @return 基址与来源
 */
export function resolvePublicBase(
  options: {
    env?: NodeJS.ProcessEnv;
    interfaces?: NodeJS.Dict<readonly { address: string; family: string | number; internal: boolean }[]>;
    port?: number;
  } = {},
): PublicBaseOutcome {
  const env = options.env ?? process.env;
  const port = options.port ?? (new URL(WUDALIANSAI.baseUrl).port || '18765');
  const loopback = `http://127.0.0.1:${port}`;

  const fromEnv = env[WUDALIANSAI.publicBaseEnv];
  const envBase = typeof fromEnv === 'string' ? fromEnv.trim() : '';
  if (envBase.length > 0) {
    const host = hostOf(envBase);
    // 显式填了公网 IP 字面量 → 拒绝，改走自动探测（产物是公开的，这类地址不该出现）
    if (host !== null && isPublicIpv4Literal(host)) {
      log.warn(
        'live',
        `忽略 ${WUDALIANSAI.publicBaseEnv}=${envBase}：这是公网地址，而产物会推到公开仓库，已改为自动探测局域网地址`,
      );
    } else {
      return { base: trimBase(envBase), source: 'env' };
    }
  }

  const interfaces =
    options.interfaces ??
    (networkInterfaces() as NodeJS.Dict<readonly { address: string; family: string | number; internal: boolean }[]>);

  const candidates: Array<{ name: string; address: string; rank: number }> = [];
  for (const [name, entries] of Object.entries(interfaces)) {
    const rank = interfaceRank(name);
    if (rank === null) {
      continue;
    }
    for (const entry of entries ?? []) {
      const isV4 = entry.family === 'IPv4' || entry.family === 4;
      if (!isV4 || entry.internal || !isPrivateIpv4(entry.address)) {
        continue;
      }
      candidates.push({ name, address: entry.address, rank });
    }
  }

  // 手机上是 wlan0 / ap0，PC 上是 WLAN / 以太网：按 网卡类型 再按名称排序，
  // 保证同一台机器多次构建结果稳定（不会因为网卡枚举顺序变化导致产物反复跳动）。
  candidates.sort((left, right) => {
    const diff = left.rank - right.rank;
    if (diff !== 0) {
      return diff;
    }
    const nameDiff = left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
    return nameDiff !== 0 ? nameDiff : left.address < right.address ? -1 : 1;
  });

  const picked = candidates[0];
  if (picked === undefined) {
    return {
      base: loopback,
      source: 'loopback',
      warning:
        '没探测到可用的局域网 IPv4（手机只连了蜂窝网络、或没连 Wi-Fi / 没开热点？），' +
        '产物里的地址退回 127.0.0.1，电视端播不了，只有手机自己能播',
    };
  }
  return { base: `http://${picked.address}:${port}`, source: 'lan' };
}

/**
 * 把列表里的回环地址改写成对外基址。
 *
 * 只改写回环主机：服务产出的地址恒为它自己的 `BIND`（实测是 `127.0.0.1:18765`），
 * 但若某天上游直接给了真实地址，原样保留即可。
 *
 * @param url 原始地址
 * @param publicBase 对外基址
 * @return 改写后的地址
 */
export function rewriteOrigin(url: string, publicBase: string): string {
  try {
    const parsed = new URL(url);
    if (!isLoopbackHost(parsed.hostname)) {
      return url;
    }
    return `${trimBase(publicBase)}${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

/**
 * 把上游原始标题拆成「赛事名 + 后缀」。
 *
 * 后缀可能是状态（`完场` / `未开赛` / `暂无直播`）也可能是线路（`高清` 等）。
 *
 * @param raw 原始标题，如 `湖人 vs 勇士|高清`
 * @return 赛事名与后缀
 */
export function splitTitle(raw: string): { title: string; suffix: string } {
  const trimmed = raw.trim();
  const index = trimmed.lastIndexOf('|');
  if (index <= 0) {
    return { title: trimmed, suffix: '' };
  }
  return { title: trimmed.slice(0, index).trim(), suffix: trimmed.slice(index + 1).trim() };
}

/**
 * 后缀 → 状态。
 *
 * @param suffix 标题后缀
 * @return 状态
 */
export function toStatus(suffix: string): LiveStatus {
  if (suffix === '完场') {
    return 'ended';
  }
  if (suffix === '未开赛') {
    return 'upcoming';
  }
  if (suffix === '暂无直播') {
    return 'unavailable';
  }
  return 'live';
}

/**
 * 线路排序权重。
 *
 * @param line 线路名
 * @return 权重，越小越优先
 */
function lineWeight(line: string): number {
  return LINE_WEIGHT[line] ?? 10;
}

/**
 * 解析 `/live.m3u` 文本。
 *
 * @param text 列表原文
 * @param publicBase 写进产物的对外基址
 * @return 合并同名赛事后的条目
 */
export function parseLiveM3u(text: string, publicBase: string): LiveMatch[] {
  const streams: Stream[] = parseM3U(text, 'wudaliansai');
  const byKey = new Map<string, LiveMatch>();

  for (const stream of streams) {
    const category = stream.upstreamGroup ?? '';
    if (category === WUDALIANSAI.noticeGroup) {
      // 公告视频不是赛事
      continue;
    }
    const { title, suffix } = splitTitle(stream.rawName);
    if (title.length === 0) {
      continue;
    }

    const status = toStatus(suffix);
    // 后缀是状态词时不当作线路名
    const line = WUDALIANSAI.deadSuffixes.includes(suffix) ? '' : suffix;
    const key = `${category}\u0000${title}`;

    let match = byKey.get(key);
    if (match === undefined) {
      match = { category, title, status, variants: [] };
      if (stream.logo !== undefined && stream.logo.length > 0) {
        match.logo = stream.logo;
      }
      byKey.set(key, match);
    } else if (STATUS_WEIGHT[status] < STATUS_WEIGHT[match.status]) {
      // 同一场有多条线路、状态不一致时取"更能看"的那个
      match.status = status;
    }

    if (match.logo === undefined && stream.logo !== undefined && stream.logo.length > 0) {
      match.logo = stream.logo;
    }

    match.variants.push({ line, url: rewriteOrigin(stream.url, publicBase) });
  }

  const matches = [...byKey.values()];
  for (const match of matches) {
    match.variants.sort((left, right) => {
      const diff = lineWeight(left.line) - lineWeight(right.line);
      return diff !== 0 ? diff : left.url < right.url ? -1 : 1;
    });
  }

  return matches.sort(compareMatches);
}

/**
 * 赛事排序：分类顺序 → 状态（直播中优先）→ 标题。
 *
 * @param left 赛事 A
 * @param right 赛事 B
 * @return 比较结果
 */
export function compareMatches(left: LiveMatch, right: LiveMatch): number {
  const categoryRank = (category: string): number => {
    const index = WUDALIANSAI.categoryOrder.indexOf(category);
    return index < 0 ? WUDALIANSAI.categoryOrder.length : index;
  };
  const diff = categoryRank(left.category) - categoryRank(right.category);
  if (diff !== 0) {
    return diff;
  }
  if (left.category !== right.category) {
    return left.category < right.category ? -1 : 1;
  }
  const statusDiff = STATUS_WEIGHT[left.status] - STATUS_WEIGHT[right.status];
  if (statusDiff !== 0) {
    return statusDiff;
  }
  return left.title < right.title ? -1 : left.title > right.title ? 1 : 0;
}

/**
 * 拉取并解析赛事列表。
 *
 * 服务没起（或不在手机上）时返回 `ok:false`，调用方只记一条 info 日志即可，
 * **不得**当成构建失败。
 *
 * @param options 注入的 fetch 与环境变量
 * @return 抓取结果
 */
export async function fetchLiveMatches(
  options: { fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv } = {},
): Promise<LiveFetchOutcome> {
  const env = options.env ?? process.env;
  const serviceBase = resolveServiceBase(env);
  const publicOutcome = resolvePublicBase({ env });
  if (publicOutcome.warning !== undefined) {
    log.warn('live', publicOutcome.warning);
  }
  if (publicOutcome.source === 'lan') {
    log.warn(
      'live',
      `产物里的赛事地址是局域网地址 ${publicOutcome.base}，会随产物推到公开仓库。` +
        '私网地址从公网访问不到，但同一 Wi-Fi 下的设备能直连 18765 端口——服务只应在可信网络里开。',
    );
  }

  const url = `${serviceBase}${WUDALIANSAI.livePath}`;
  let response;
  try {
    response = await fetchText(url, {
      timeoutMs: WUDALIANSAI.timeoutMs,
      retries: 0,
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    });
  } catch (error) {
    return {
      ok: false,
      matches: [],
      publicBase: publicOutcome.base,
      error: describeError(error),
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      matches: [],
      publicBase: publicOutcome.base,
      error: `HTTP ${response.status}`,
    };
  }
  if (response.text.trim().length === 0) {
    return { ok: false, matches: [], publicBase: publicOutcome.base, error: '列表为空' };
  }

  const matches = parseLiveM3u(response.text, publicOutcome.base);
  if (matches.length === 0) {
    return { ok: false, matches: [], publicBase: publicOutcome.base, error: '解析出 0 场赛事' };
  }
  return { ok: true, matches, publicBase: publicOutcome.base };
}
