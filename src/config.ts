/**
 * @file 唯一配置中心。
 *
 * 约定 §6/§8：并发数、超时、阈值、路径等所有数值常量只在此处定义，
 * 业务文件禁止出现魔法数。
 */

import groupsConfig from '../data/groups.json';
import type { GroupKey } from './types';

/**
 * 分组顺序（即输出顺序，权重 = 数组下标，升序）。
 *
 * 权威来源是 `data/groups.json`：分组名与顺序必须放在**数据文件**里，
 * 因为管理后台可以在运行时改它，而纯静态站改不动 TypeScript 里的枚举。
 * 文件结构异常时退化为只保留兜底组「其他」，保证构建不炸。
 */
export const GROUP_ORDER: readonly GroupKey[] = readGroupOrder();

/** 分组权重：由 `GROUP_ORDER` 下标派生，未知分组在 `src/data/groups.ts` 里排到末尾。 */
export const GROUP_WEIGHT: Readonly<Record<GroupKey, number>> = Object.fromEntries(
  GROUP_ORDER.map((group, index) => [group, index] as const),
);

/**
 * 读取并清洗 `data/groups.json` 的分组顺序。
 *
 * @return 非空的分组名数组（异常时返回 `['其他']`）
 */
function readGroupOrder(): readonly GroupKey[] {
  const order: unknown = groupsConfig.order;
  if (!Array.isArray(order)) {
    return ['其他'];
  }
  const cleaned = order.filter((item): item is string => typeof item === 'string' && item.length > 0);
  return cleaned.length > 0 ? cleaned : ['其他'];
}

/** 单个上游的定义。 */
export interface UpstreamSource {
  /** 稳定短名，进 stats.upstream[].name */
  name: string;
  /** 展示名 */
  label: string;
  /** GitHub Raw 直链（首选） */
  rawUrl: string;
  /** jsDelivr 镜像（raw 失败后兜底） */
  jsdelivrUrl: string;
  /** 文档格式 */
  format: 'm3u' | 'txt';
  /** MOCK_MODE 下读取的 fixture 文件名（相对 tests/fixtures） */
  fixture: string;
}

/**
 * 默认 8 个公开上游（设计 §6-1），全部走 raw + jsDelivr 双通道。
 * 增删改只动这里，其它文件不感知。
 *
 * 顺序 = 抓取顺序（并发），也是 `stats.upstream[]` 的展示顺序。
 */
export const UPSTREAMS: readonly UpstreamSource[] = [
  {
    name: 'iptv-org-cn',
    label: 'iptv-org 中国大陆',
    rawUrl: 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/cn.m3u',
    jsdelivrUrl: 'https://cdn.jsdelivr.net/gh/iptv-org/iptv@master/streams/cn.m3u',
    format: 'm3u',
    fixture: 'upstream-iptv-org-cn.m3u',
  },
  {
    name: 'iptv-org-hk',
    label: 'iptv-org 香港',
    rawUrl: 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/hk.m3u',
    jsdelivrUrl: 'https://cdn.jsdelivr.net/gh/iptv-org/iptv@master/streams/hk.m3u',
    format: 'm3u',
    fixture: 'upstream-iptv-org-hk.m3u',
  },
  {
    name: 'iptv-org-tw',
    label: 'iptv-org 台湾',
    rawUrl: 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/tw.m3u',
    jsdelivrUrl: 'https://cdn.jsdelivr.net/gh/iptv-org/iptv@master/streams/tw.m3u',
    format: 'm3u',
    fixture: 'upstream-iptv-org-tw.m3u',
  },
  {
    name: 'fanmingming-live',
    label: 'fanmingming/live',
    rawUrl: 'https://raw.githubusercontent.com/fanmingming/live/main/tv/m3u/ipv4.m3u',
    jsdelivrUrl: 'https://cdn.jsdelivr.net/gh/fanmingming/live@main/tv/m3u/ipv4.m3u',
    format: 'm3u',
    fixture: 'upstream-fanmingming-live.m3u',
  },
  {
    name: 'vbskycn-iptv',
    label: 'vbskycn/iptv',
    rawUrl: 'https://raw.githubusercontent.com/vbskycn/iptv/master/tv/iptv4.m3u',
    jsdelivrUrl: 'https://cdn.jsdelivr.net/gh/vbskycn/iptv@master/tv/iptv4.m3u',
    format: 'm3u',
    fixture: 'upstream-vbskycn-iptv.m3u',
  },
  {
    name: 'free-tv-china',
    label: 'Free-TV/IPTV 中国',
    rawUrl: 'https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_china.m3u8',
    jsdelivrUrl: 'https://cdn.jsdelivr.net/gh/Free-TV/IPTV@master/playlists/playlist_china.m3u8',
    format: 'm3u',
    fixture: 'upstream-free-tv-china.m3u',
  },
  {
    name: 'iptv-org-mo',
    label: 'iptv-org 澳门',
    // 实测 10 个澳门频道；raw 偶发 TLS 抖动，jsDelivr 稳定，故双通道都要配
    rawUrl: 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/mo.m3u',
    jsdelivrUrl: 'https://cdn.jsdelivr.net/gh/iptv-org/iptv@master/streams/mo.m3u',
    format: 'm3u',
    fixture: 'upstream-iptv-org-mo.m3u',
  },
  {
    name: 'guovin-iptv-api',
    label: 'guovin/iptv-api 聚合',
    // ⚠️ 产物在 **gd 分支**（不是默认分支 master），这是实测可用的地址，别改成 master
    // 实测 1619 条，自带测速与分组（group-title 形如 `☘️广东频道`），价值最高
    rawUrl: 'https://raw.githubusercontent.com/guovin/iptv-api/gd/output/result.m3u',
    jsdelivrUrl: 'https://cdn.jsdelivr.net/gh/guovin/iptv-api@gd/output/result.m3u',
    format: 'm3u',
    fixture: 'upstream-guovin-iptv-api.m3u',
  },
  {
    name: 'akira-curated',
    label: 'akiralereal/iptv 精选',
    // 实测 34 条，人工精选 + 可用性复核，含翡翠台 / 公视 / 民视 / 台视 / TVBS / 凤凰
    rawUrl: 'https://raw.githubusercontent.com/akiralereal/iptv/main/IPTV.m3u',
    jsdelivrUrl: 'https://cdn.jsdelivr.net/gh/akiralereal/iptv@main/IPTV.m3u',
    format: 'm3u',
    fixture: 'upstream-akira-curated.m3u',
  },
  {
    name: 'akira-overseas',
    label: 'akiralereal/iptv 海外',
    // 42 个海外免费台（体育 13 / 娱乐时尚 12 / 国际 9 / 文旅 7 / 韩国 1），
    // 来自 Samsung TV Plus、Plex、Rakuten、LG Channels 等 FAST 平台及各家官方入口。
    // ⚠️ 作者自己标注「在大陆常卡顿或连不上」，实测能活下来的一般是个位数。
    rawUrl: 'https://raw.githubusercontent.com/akiralereal/iptv/main/IPTV-overseas.m3u',
    jsdelivrUrl: 'https://cdn.jsdelivr.net/gh/akiralereal/iptv@main/IPTV-overseas.m3u',
    format: 'm3u',
    fixture: 'upstream-akira-overseas.m3u',
  },
];

/**
 * NBA 赛程源。
 *
 * 注意 ESPN 的 `dates` 参数按**美东赛程日**分组：实测传 20261021 返回的比赛，
 * 北京时间全部落在 10/22（因为北京上午 = 美东前一天晚上）。
 * 所以按「北京时间窗口起点当天的美东日期」起算，逐日并发拉 windowDays + 1 天，
 * 合并后按北京时间窗口过滤——这样夏令时/冬令时切换都不会漏场次。
 */
export const NBA = {
  /** 赛程接口前缀，拼接 `?dates=YYYYMMDD` */
  scoreboardUrl: 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard',
  /** 单次请求超时（接口冷启动实测约 13 秒） */
  timeoutMs: 20000,
  /**
   * 单日请求失败后的重试次数（原地重试）。
   *
   * 另外 `fetchNbaEvents` 在所有天拉完之后还会对失败的天补跑一轮，
   * 那个「暖连接后补跑」才是兜住构建期冷启动失败的主力。
   */
  retries: 1,
  /** 展示窗口：北京时间今天起算的天数（1 天只有今天，7 天含未来一周） */
  windowDays: 7,
  /** 单个比赛最多附带的转播源数 */
  maxSourcesPerGame: 3,
  /**
   * 本仓库频道名 → ESPN 转播台名（用于把比赛和可用源对上）。
   *
   * 说明：2025-26 赛季起 NBA 全国转播方是 ESPN/ABC（迪士尼）、NBC/Peacock、Prime Video，
   * TNT 已无转播权，所以这里不再收录 TNT。ESPN 返回的台名实测含
   * `ESPN`、`NBA TV`、`NBCSN` 等；只有本仓库确有存活源的台才列在这里。
   */
  channelAliases: {
    ESPN: ['ESPN'],
    ESPNU: ['ESPNU'],
    ESPN2: ['ESPN2'],
    'NBA TV': ['NBA TV'],
    ABC: ['ABC'],
    'YES Network': ['DAZN (YES)'],
  } as Readonly<Record<string, readonly string[]>>,
} as const;

/** 公开 XMLTV 节目单源（失败不影响列表）。 */
export const EPG_SOURCES: readonly string[] = [
  'https://raw.githubusercontent.com/fanmingming/live/main/tv/xmltv.xml',
  'https://raw.githubusercontent.com/iptv-org/epg/master/epg.xml',
];

/** EPG 抓取参数。 */
export const EPG = {
  /** 单个 EPG 源超时 */
  timeoutMs: 12000,
  /** 最多尝试几个 EPG 源 */
  maxSources: 2,
  /** 每个频道最多保留的节目条数（防止产物膨胀） */
  maxProgrammesPerChannel: 200,
  /** 单个 EPG 文档最大解析长度（字符），超出截断避免正则回溯爆炸 */
  maxDocumentChars: 4_000_000,
} as const;

/** 全部路径常量。 */
export const PATHS = {
  distDir: 'dist',
  txtDir: 'dist/txt',
  m3uDir: 'dist/m3u',
  epgDir: 'dist/epg',
  nbaDir: 'dist/nba',
  txt: 'dist/txt/all.txt',
  m3u: 'dist/m3u/all.m3u',
  epg: 'dist/epg/epg.xml',
  /** NBA 赛程清单（TXT，可直接当直播源导入） */
  nbaTxt: 'dist/nba/today.txt',
  /** NBA 赛程清单（M3U） */
  nbaM3u: 'dist/nba/today.m3u',
  /** 网页端频道目录（分组 + 频道 + 源地址），供频道浏览页 / 播放页读取 */
  channelsJson: 'dist/channels.json',
  stats: 'dist/stats.json',
  dataDir: 'data',
  blacklist: 'data/blacklist.json',
  history: 'data/history.json',
  custom: 'custom/sources.txt',
  fixturesDir: 'tests/fixtures',
} as const;

/** 抓取层参数。 */
export const FETCH = {
  /** 单上游超时 */
  timeoutMs: 8000,
  /** 单上游最大重试次数（同一通道内） */
  retries: 1,
  /** 流水线允许的最大上游失败率，超过则判定降级 */
  failRateLimit: 0.5,
  /** User-Agent，方便上游日志识别 */
  userAgent: 'IPTVHub/1.0 (+https://github.com)',
} as const;

/** 测活层参数（25 分钟预算，见设计 §1.5）。 */
export const PROBE = {
  /** 并发池大小 */
  concurrency: 64,
  /** 首跳超时 */
  timeoutMs: 8000,
  /** HLS 子请求（变体/首片）超时 */
  subTimeoutMs: 4000,
  /** 全局 deadline：测活开始 + 17 分钟 */
  deadlineMs: 17 * 60 * 1000,
  /** 剩余时间不足此值则放弃黑名单复测 */
  retryWindowMs: 3 * 60 * 1000,
  /** 首跳请求的 Range 字节数 */
  firstRangeBytes: 65536,
  /** 子请求 Range 字节数 */
  subRangeBytes: 2048,
  /** TS 包长度，>=188 字节视为有真实流数据 */
  tsPacketBytes: 188,
  /**
   * 海外上游源的额外重试轮数。
   *
   * 动机：`akira-overseas` 这类 FAST 平台的源普遍在境外，国内网络下首连失败率极高，
   * 且高并发会互相挤占连接放大误判（实测并发 64 时存活数会在 1~29 之间乱跳）。
   * 所以第一轮测活结束后，对海外源的**失败项**再跑一轮单独重试，给它们第二次机会。
   */
  overseasRetries: 1,
} as const;

/**
 * 需要额外重试的海外上游名单（对应 `Stream.origin`）。
 */
export const OVERSEAS_ORIGINS: readonly string[] = ['akira-overseas'];

/** 优选层参数。 */
export const SELECT = {
  /** 每频道最多保留的源数（普通频道） */
  maxPerChannel: 5,
  /**
   * 重点频道最多保留的源数。
   *
   * 动机：用户点名的常看频道（广东本地 + 港澳台主力）一旦首选源当天失效，
   * 只留 3 个备用的容错偏窄。给这些频道翻倍冗余，播放器可以一路往下试。
   * 代价只是列表多几十行，不影响加载速度。
   */
  priorityMaxPerChannel: 10,
  /** 判活所需的至少 1 个存活源（0 存活则该频道剔除） */
  minAlivePerChannel: 1,
  /**
   * 候选源上限，超出按分组权重 + userAdded 截断。
   *
   * 从 3000 提到 5000 的原因：新增 `guovin/iptv-api`（实测 1619 条）后候选量到 2500~3000+，
   * 3000 会在「其他」组尾部被截断，白白丢掉可用源。
   *
   * 时间预算（`PROBE.deadlineMs` 保持 17 分钟不变）：
   *   5000 条 / 64 并发 = 78 批，最坏情况每条都吃满 `PROBE.timeoutMs` = 8 秒
   *   → 78 × 8s ≈ 625s ≈ 10.4 分钟 < 17 分钟 deadline，
   *   再叠加抓取（数秒）与 EPG（≤12s/源）仍在 25 分钟 workflow 预算内。
   */
  maxCandidates: 5000,
} as const;

/**
 * 重点频道 ID 白名单：命中则用 `priorityMaxPerChannel` 而不是 `maxPerChannel`。
 *
 * 选取标准 = 用户每天真会看的台：广东本地全系 + 港澳台主力 + 央视体育。
 * 新增台只需往这里加 slug（slug 见 `src/data/channel-rules.ts` 各规则的 id 字段）。
 */
export const PRIORITY_CHANNEL_IDS: readonly string[] = [
  // 广东本地
  'gd-sports', 'gd-zhujiang', 'gd-news', 'gd-public', 'gd-bayarea',
  'gd-tvs1', 'gd-tvs4', 'gd-tvs5',
  // 香港
  'tvb-jade', 'tvb-pearl', 'tvb-news', 'viutv', 'hoy-tv',
  // 澳门 / 凤凰
  'tdm-oumun', 'phoenix-chinese',
  // 央视体育
  'cctv5', 'cctv5plus',
];

/** 黑名单参数。 */
export const BLACKLIST = {
  /** 连续失败多少次进入"延后复测"队列 */
  maxFailBeforeDelay: 2,
  /** 条目过期天数（超过则清理，避免文件无限膨胀） */
  ttlDays: 7,
} as const;

/** 降级判定参数。 */
export const DEGRADE = {
  /** 候选源低于此值 → stale */
  minCandidates: 20,
  /** 输出频道数低于上次的此比例 → stale */
  channelDropRatio: 0.6,
  /** 输出频道数绝对下限 → stale（防止首发就产出空列表） */
  minChannels: 10,
  /** 输出存活源绝对下限 → stale */
  minSourceCount: 15,
} as const;

/** 历史记录保留条数。 */
export const HISTORY_KEEP = 7;

/** MOCK_MODE 环境变量名（离线验收用）。 */
export const MOCK_ENV = 'MOCK_MODE';

/** 判断是否离线 mock 模式。 */
export function isMockMode(): boolean {
  return process.env[MOCK_ENV] === '1';
}
