/**
 * @file 全局数据类型定义。
 *
 * 与 `docs/system_design.md` §3 逐字段保持一致；只允许新增可选字段，
 * 不允许改名或删字段（网页端只读 `stats.json`，改字段会导致首页炸掉）。
 */

/**
 * 分组名。
 *
 * 分组**不再是固定枚举**：顺序与名称由 `data/groups.json` 的 `order` 决定
 * （见 `src/config.ts` 的 `GROUP_ORDER`），网页端与管理后台可以新增分组，
 * 所以这里退化成 `string`，唯一权威是 `data/groups.json`。
 */
export type GroupKey = string;

/** 流的封装类型（由 content-type / 后缀嗅探得出）。 */
export type StreamKind = 'hls' | 'flv' | 'ts' | 'mp4' | 'other';

/** 一条待测活的播放地址（未归一到频道之前的状态）。 */
export interface Stream {
  /** 原始 URL，原样输出给播放器，不做任何改写 */
  url: string;
  /** 去重键：scheme + host(小写) + path(去末尾 '/') + query */
  urlKey: string;
  /** 上游原始频道名（归一前的写法），纯 URL 行为空串 */
  rawName: string;
  /** 归一后的频道 slug，如 'cctv1' | 'tvb-jade' | 'gd-zhujiang' */
  channelId: string;
  /** 分组 */
  group: GroupKey;
  /** 台标，缺失时为空 */
  logo?: string;
  /** 来源标识，如 'iptv-org-cn' | 'custom' */
  origin: string;
  /** 来自 custom/sources.txt 的用户自填源，优先级最高 */
  userAdded?: boolean;
  /**
   * 上游自带的分组名（M3U 的 `group-title="☘️广东频道"` / TXT 的 `分组名,#genre#`）。
   *
   * 只作为**分类提示**使用：规则表命中时忽略它，规则表未命中时优先于名称关键词推断
   * （见 `normalize/group.ts` 的判定优先级）。缺失表示该行没有分组信息。
   */
  upstreamGroup?: string;
}

/** 归一后的频道，是产物生成的基本单位。 */
export interface Channel {
  /** === channelId，唯一标识，ASCII slug */
  id: string;
  /** 标准中文名，如 'CCTV-1 综合' */
  name: string;
  /** 命中过的原始写法（去重后） */
  aliases: string[];
  /** 分组 */
  group: GroupKey;
  /** 台标 */
  logo?: string;
  /** 上游 XMLTV 的 channel id，用于 EPG 匹配 */
  epgId?: string;
  /** 该频道的全部候选源（未经测活筛选） */
  streams: Stream[];
}

/** 单源测活结论。 */
export type ProbeStatus = 'alive' | 'dead' | 'timeout' | 'skipped' | 'unknown';

/** 单源测活结果。 */
export interface ProbeResult {
  urlKey: string;
  status: ProbeStatus;
  /** status === 'alive' 的便捷布尔值 */
  alive: boolean;
  httpStatus?: number;
  /** 首字节耗时（ms） */
  latencyMs?: number;
  contentType?: string;
  kind?: StreamKind;
  width?: number;
  height?: number;
  /** '1920x1080'（来自 EXT-X-STREAM-INF 或内容嗅探） */
  resolution?: string;
  /** 码率 bps */
  bandwidth?: number;
  error?: string;
  /** ISO 8601 +08:00，如 '2025-01-01T12:00:00+08:00' */
  checkedAt: string;
}

/** 单个上游的抓取统计。 */
export interface UpstreamStat {
  name: string;
  ok: boolean;
  items: number;
  channel: 'raw' | 'jsdelivr' | 'custom';
  error?: string;
}

/** `dist/stats.json` 的结构，网页首页只读它。 */
export interface BuildStats {
  version: 1;
  /** '2025-01-01T12:00:00+08:00' */
  updated_at: string;
  channel_count: number;
  /** 输出的源条数 */
  source_count: number;
  groups: Record<GroupKey, number>;
  upstream: UpstreamStat[];
  /** 0~1 */
  fetch_fail_rate: number;
  probe: {
    total: number;
    alive: number;
    dead: number;
    timeout: number;
    skipped: number;
    duration_ms: number;
  };
  epg: { ok: boolean; programmes: number; error?: string };
  build_duration_ms: number;
  /** 被 `data/hidden-channels.json` 屏蔽掉的频道数（新增字段，只加不改名） */
  hidden_count?: number;
  stale: boolean;
  stale_reason?: string;
}

/** 黑名单条目。 */
export interface BlacklistEntry {
  fail_count: number;
  last_checked: string;
}

/** `data/blacklist.json`。 */
export interface BlacklistFile {
  version: 1;
  entries: Record<string, BlacklistEntry>;
}

/** `data/history.json`（最近 7 次构建摘要）。 */
export interface HistoryFile {
  version: 1;
  items: Array<
    Pick<BuildStats, 'updated_at' | 'channel_count' | 'source_count' | 'stale'> & {
      /** 降级时的原因（新增字段，只加不改名；正常构建缺省） */
      stale_reason?: string;
    }
  >;
}

/**
 * 依赖注入点 —— 让所有触网函数在单测里可以离线跑。
 * 生产环境不传，直接落到 Node 全局 fetch / Date.now。
 */
export interface ProbeDeps {
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/** 抓取层的原始文档（L1 输出）。 */
export interface RawDoc {
  /** 上游名，如 'iptv-org-cn' */
  origin: string;
  /** 文档格式，决定用哪个解析器 */
  format: 'm3u' | 'txt';
  /** 原始文本（可能带 BOM / CRLF，由解析器负责清洗） */
  text: string;
  /** 抓取是否成功 */
  ok: boolean;
  /** 该文档解析出的条目数（抓取失败时为 0） */
  items: number;
  /** 实际命中的通道 */
  channel: 'raw' | 'jsdelivr' | 'custom';
  error?: string;
}

/** 测活目标的精简结构。 */
export interface ProbeTarget {
  urlKey: string;
  url: string;
  /**
   * 来源标识（`Stream.origin`）。海外上游在网络抖动时容易被误判为死源，
   * `main.ts` 据此对海外目标做额外重试（见 `PROBE.overseasRetries`）。
   */
  origin?: string;
}

/** `dist/stats.json` 之外的历史条目别名，语义化用。 */
export type HistoryItem = HistoryFile['items'][number];
