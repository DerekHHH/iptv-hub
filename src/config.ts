/**
 * @file 唯一配置中心。
 *
 * 约定 §6/§8：并发数、超时、阈值、路径等所有数值常量只在此处定义，
 * 业务文件禁止出现魔法数。
 */

import type { GroupKey } from './types';

/** 分组顺序即输出顺序，权重 = 数组下标（0~4，升序）。 */
export const GROUP_ORDER: readonly GroupKey[] = ['港澳台', '广东', '央视', '卫视', '其他'];

/** 分组权重：港澳台最前（电视端首屏可见）。 */
export const GROUP_WEIGHT: Readonly<Record<GroupKey, number>> = {
  港澳台: 0,
  广东: 1,
  央视: 2,
  卫视: 3,
  其他: 4,
};

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
];

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
  txt: 'dist/txt/all.txt',
  m3u: 'dist/m3u/all.m3u',
  epg: 'dist/epg/epg.xml',
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
} as const;

/** 优选层参数。 */
export const SELECT = {
  /** 每频道最多保留的源数 */
  maxPerChannel: 3,
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
