/**
 * @file 频道名归一（约定 §1）：任意写法 → `{ id(slug), name(中文名), group }`。
 *
 * 归一三部曲：
 *   1. `normalizeAliasKey()` 把名字压成比对键（大写、去空格、去标点、去画质后缀）
 *   2. CCTV 编号正则（覆盖 `CCTV-1` / `中央1台` / `中央一台` / `CCTV5+` 等无限写法）
 *   3. 静态规则表查表；仍未命中 → 关键词推断分组 + 哈希 slug（绝不丢源）
 */

import {
  CCTV_CHANNELS,
  CHANNEL_RULES,
  CN_NUMERALS,
  MIN_RULE_COUNT,
  type ChannelRule,
} from '../data/channel-rules';
import { sortChannels } from '../data/groups';
import { inferGroup, resolveGroup } from './group';
import { toSimplified } from './traditional';
import type { Channel, GroupKey, Stream } from '../types';
import { hashSlug } from '../util/slug';

/** 归一结果。 */
export interface ChannelIdentity {
  /** ASCII slug */
  id: string;
  /** 标准中文名 */
  name: string;
  /** 分组 */
  group: GroupKey;
  /**
   * 是否命中了归一规则表（含 CCTV 编号正则）。
   *
   * 命中意味着 `group` 是规则表里**显式声明**的分组，上游 `group-title` 不得覆盖它
   * （见 `normalize/group.ts` 的判定优先级）；未命中时 `group` 只是关键词推断结果，
   * 允许被上游提示修正。放在这里而不是单独函数，是因为它和 `group` 同源同缓存。
   */
  ruleMatched: boolean;
  /** 台标 */
  logo?: string;
  /** XMLTV channel id */
  epgId?: string;
}

/** 需要整体剔除的标点（含全角）。 */
const PUNCTUATION_PATTERN = /[\s\u3000\-_·・.,，、;；:：!！?？'"“”‘’/\\()（）【】\[\]{}<>《》]/g;

/**
 * 括号段匹配：`(1080p)` / `（720P）` / `[576i]` / `【备用】`。
 *
 * 单次匹配出来的是「一个完整括号段 + 它的内容」，内容交给 {@link META_INNER_PATTERN} 判定，
 * 只有纯元信息才整段删除 —— 否则 `CCTV-5+ (体育赛事)`、`凤凰卫视(中文台)`
 * 会把有含义的后缀删掉，反而丢信息。
 */
const BRACKET_SEGMENT_PATTERN = /[(（[【]\s*([^()（）[\]【】]*?)\s*[)）\]】]/g;

/**
 * 括号内容 == 纯元信息 的判定（命中则整段括号删除）。
 *
 * 覆盖：分辨率（`1080p` / `720P` / `576i` / `2160p` / `1080p50` / `4K` / `8K`）、
 * 状态标记（`Geo-blocked` / `Not 24/7` / `Offline` / `无插件` / `备用` / `测试`）、
 * 编码（`H.264` / `H265` / `HEVC` / `AVC`）、画质档位（`HD` / `SD` / `FHD` / `UHD`）。
 */
const META_INNER_PATTERN =
  /^(?:\d{3,4}\s*[pi]|\d{3,4}p\d+|4k|8k|geo-?blocked|not\s*24\s*[/／]\s*7|offline|hd|sd|fhd|uhd|h\.?26[45]|hevc|avc|无插件|备用|测试)$/i;

/**
 * 画质/版本后缀（循环剥离，最多 3 轮防止死循环）。
 *
 * `\d{3,4}P\d+` / `\d{3,4}[PI]` 是本次补的裸后缀形式：上游真实写法
 * `翡翠台 (1080p)` 去掉括号与标点后会变成 `翡翠台1080P`，旧规则不认 `1080P`
 * 就会整条落到哈希 slug（同一台被拆成多条、分类也错），故必须补上。
 */
const QUALITY_SUFFIX_PATTERN =
  /(超高清|高清|超清|蓝光|标清|测试|体验|备用源|备用|移动版|电信版|联通版|IPV4|IPV6|H265|H264|HEVC|AVC|FHD|UHD|HD|SD|[456]0FPS|\d{3,4}P\d+|\d{3,4}[PI])$/;

/** CCTV 前缀。 */
const CCTV_PREFIX_PATTERN = /^(?:CCTV|央视|中央电视台|中央电视|中央台|中央)/;

/** CCTV 中文数字后缀形式：`一台` / `十一台` / `四套`。 */
const CCTV_CN_PATTERN = /^(十[一二三四五六七]?|[一二三四五六七八九])(?:套|台|频道)?$/;

/** 归一化缓存：同一个原始写法只算一次。 */
const identityCache = new Map<string, ChannelIdentity | null>();

/**
 * 剥掉"纯元信息"括号段（分辨率 / 状态标记 / 编码），并压平多余空白。
 *
 * 这是归一前的**前置清洗**，`normalizeAliasKey()` 与 `toDisplayName()` 共用同一套逻辑，
 * 保证"比对键干净"和"展示名干净"永远一致。
 *
 * @param raw 原始频道名
 * @return 去掉元信息括号后的名字（保留有实际含义的括号内容）
 */
export function stripMetaSegments(raw: string): string {
  const normalized = raw.normalize('NFKC');
  const stripped = normalized.replace(BRACKET_SEGMENT_PATTERN, (segment: string, inner: string) =>
    META_INNER_PATTERN.test(inner.trim()) ? '' : segment,
  );
  return stripped.replace(/[\s\u3000]+/g, ' ').trim();
}

/**
 * 把频道名压成比对键。
 *
 * 顺序：NFKC（全角→半角）→ **剥元信息括号段** → **繁→简**（`無綫翡翠台` → `无线翡翠台`）
 * → 大写 → 去标点 → 去画质后缀。
 * 繁简转换只作用于比对键，展示名不受影响（见 `toDisplayName`）。
 *
 * @param raw 原始频道名
 * @return 比对键（简体、大写、无空格、无标点、无画质后缀）
 */
export function normalizeAliasKey(raw: string): string {
  let key = toSimplified(stripMetaSegments(raw)).toUpperCase().replace(PUNCTUATION_PATTERN, '');
  for (let round = 0; round < 3; round += 1) {
    const next = key.replace(QUALITY_SUFFIX_PATTERN, '');
    if (next === key || next.length === 0) {
      break;
    }
    key = next;
  }
  return key;
}

/** 把规则表编成「比对键 → 规则」的索引。 */
function buildAliasIndex(): Map<string, ChannelRule> {
  const index = new Map<string, ChannelRule>();
  for (const rule of CHANNEL_RULES) {
    const keys = [rule.id, rule.name, ...rule.aliases];
    for (const key of keys) {
      const normalized = normalizeAliasKey(key);
      if (normalized.length === 0) {
        continue;
      }
      if (!index.has(normalized)) {
        index.set(normalized, rule);
      }
    }
  }
  return index;
}

const ALIAS_INDEX = buildAliasIndex();

/** 规则表容量自检：低于下限说明有人误删（测试里也会断言）。 */
export const RULE_COUNT = CHANNEL_RULES.length;

if (RULE_COUNT < MIN_RULE_COUNT) {
  throw new Error(`频道规则表只剩 ${RULE_COUNT} 条，低于下限 ${MIN_RULE_COUNT}`);
}

/**
 * 把 CCTV 名字映射成 slug（覆盖数字、中文数字、5+、4K 等写法）。
 *
 * @param key 归一化后的比对键
 * @return 命中时返回规则，否则 null
 */
function matchCctvRule(key: string): ChannelRule | null {
  if (key.length === 0) {
    return null;
  }

  // CCTV-4K / CCTV8K
  if (/^(?:CCTV|央视|中央)?(?:4K|8K)/.test(key)) {
    return {
      id: 'cctv4k',
      name: 'CCTV-4K 超高清',
      group: '央视',
      aliases: [],
      epgId: 'CCTV4K',
    };
  }

  // CCTV5+ / CCTV5PLUS（允许带后缀，如 `CCTV-5+ 体育赛事`）
  if (/^(?:CCTV|央视|中央)?5(?:\+|PLUS)/.test(key)) {
    return {
      id: 'cctv5plus',
      name: 'CCTV-5+ 体育赛事',
      group: '央视',
      aliases: [],
      epgId: 'CCTV5Plus',
    };
  }

  const prefixed = CCTV_PREFIX_PATTERN.test(key);
  const rest = prefixed ? key.replace(CCTV_PREFIX_PATTERN, '') : key;
  if (rest.length === 0) {
    return null;
  }

  if (prefixed) {
    const digitMatch = rest.match(/^(\d{1,2})(?!\d)/);
    if (digitMatch !== null) {
      const no = Number(digitMatch[1]);
      const hit = CCTV_CHANNELS.find((item) => item.no === no);
      if (hit !== undefined) {
        return {
          id: hit.id,
          name: hit.name,
          group: '央视',
          aliases: [],
          epgId: `CCTV${hit.no}`,
        };
      }
    }
  }

  const cnMatch = rest.match(CCTV_CN_PATTERN);
  if (cnMatch !== null) {
    const numeral = cnMatch[1] ?? '';
    const no = CN_NUMERALS[numeral];
    if (no !== undefined) {
      const hit = CCTV_CHANNELS.find((item) => item.no === no);
      if (hit !== undefined) {
        return {
          id: hit.id,
          name: hit.name,
          group: '央视',
          aliases: [],
          epgId: `CCTV${hit.no}`,
        };
      }
    }
  }

  return null;
}

/**
 * 展示名清洗：剥掉元信息括号段、合并连续空格、去掉画质后缀。
 *
 * 与 `normalizeAliasKey` 共用同一套剥除逻辑，因此不会出现
 * `翡翠台 (1080p)` 这种带噪声的展示名。
 *
 * @param raw 原始频道名
 * @return 清爽的展示名
 */
function toDisplayName(raw: string): string {
  const collapsed = stripMetaSegments(raw);
  const stripped = collapsed.replace(QUALITY_SUFFIX_PATTERN, '').trim();
  return stripped.length > 0 ? stripped : collapsed;
}

/**
 * 识别一个频道名。
 *
 * @param rawName 原始频道名；空串返回 null（约定 §8-4：纯 URL 无频道名直接丢弃）
 * @return 归一身份或 null
 */
export function identifyChannel(rawName: string): ChannelIdentity | null {
  const trimmed = rawName.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const cached = identityCache.get(trimmed);
  if (cached !== undefined) {
    return cached;
  }

  const key = normalizeAliasKey(trimmed);
  if (key.length === 0) {
    identityCache.set(trimmed, null);
    return null;
  }

  const rule = matchCctvRule(key) ?? ALIAS_INDEX.get(key) ?? null;
  let identity: ChannelIdentity;
  if (rule !== null) {
    identity = { id: rule.id, name: rule.name, group: rule.group, ruleMatched: true };
    if (rule.logo !== undefined && rule.logo.length > 0) {
      identity.logo = rule.logo;
    }
    if (rule.epgId !== undefined && rule.epgId.length > 0) {
      identity.epgId = rule.epgId;
    }
  } else {
    identity = {
      id: hashSlug(key),
      name: toDisplayName(trimmed),
      group: inferGroup(key),
      ruleMatched: false,
    };
  }

  identityCache.set(trimmed, identity);
  return identity;
}

/**
 * 台标取值优先级：已有的（规则表显式给的）优先，否则用候选（上游 tvg-logo）。
 *
 * 抽成纯函数是为了让「规则表优先、上游兜底」这条规则可以被单测直接钉住。
 *
 * @param current 当前已确定的台标（可能为空）
 * @param candidate 上游提供的台标（可能为空）
 * @return 最终台标（都为空时返回 undefined）
 */
export function pickLogo(current: string | undefined, candidate: string | undefined): string | undefined {
  if (current !== undefined && current.length > 0) {
    return current;
  }
  if (candidate !== undefined && candidate.length > 0) {
    return candidate;
  }
  return undefined;
}

/**
 * 把未归一的 Stream 列表聚合成 Channel 列表。
 *
 * - 丢弃无频道名的行（纯 URL）
 * - 同频道内按 `urlKey` 去重
 * - 用户自填源（custom/sources.txt）排在最前，天然获得高优先级
 * - 分组按「① 规则表 → ② 上游 group-title → ③ 名称关键词 → ④ 其他」判定
 *   （`resolveGroup`）：规则表命中的频道，上游提示**不得**覆盖
 * - 返回结果已按（分组权重 → channelId）排好序
 *
 * @param streams 未归一的源
 * @return 有序频道列表
 */
export function buildChannels(streams: readonly Stream[]): Channel[] {
  const channelMap = new Map<string, Channel>();
  const seen = new Set<string>();

  for (const stream of streams) {
    const identity = identifyChannel(stream.rawName);
    if (identity === null) {
      continue;
    }

    const group = resolveGroup({
      ruleMatched: identity.ruleMatched,
      nameGroup: identity.group,
      upstreamGroup: stream.upstreamGroup,
    });

    stream.channelId = identity.id;
    stream.group = group;
    if ((stream.logo === undefined || stream.logo.length === 0) && identity.logo !== undefined) {
      stream.logo = identity.logo;
    }

    const dedupeKey = `${identity.id}|${stream.urlKey}`;
    const duplicated = seen.has(dedupeKey);
    seen.add(dedupeKey);

    let channel = channelMap.get(identity.id);
    if (channel === undefined) {
      channel = {
        id: identity.id,
        name: identity.name,
        aliases: [],
        group,
        streams: [],
      };
      if (identity.logo !== undefined && identity.logo.length > 0) {
        channel.logo = identity.logo;
      }
      if (identity.epgId !== undefined && identity.epgId.length > 0) {
        channel.epgId = identity.epgId;
      }
      channelMap.set(identity.id, channel);
    } else if (!identity.ruleMatched && channel.group === identity.group) {
      // 该频道此前还没被任何上游提示改过分组（仍是关键词推断值）→ 允许本次提示修正
      channel.group = group;
    }

    // 台标：规则表显式给的最优先；否则从该频道第一个非空的上游 tvg-logo 提升上来
    // （否则 M3U 恒为空、EPG 无 <icon>，上游辛苦带的台标全丢）
    const pickedLogo = pickLogo(channel.logo, stream.logo);
    if (pickedLogo !== undefined) {
      channel.logo = pickedLogo;
    }

    // 别名先记录：即使这条 URL 重复，它的写法也是同一个频道的证据
    const alias = stream.rawName.trim();
    if (alias.length > 0 && !channel.aliases.includes(alias)) {
      channel.aliases.push(alias);
    }
    if (duplicated) {
      continue;
    }
    channel.streams.push(stream);
  }

  const channels = [...channelMap.values()];
  for (const channel of channels) {
    channel.streams.sort((left, right) => {
      const leftWeight = left.userAdded === true ? 0 : 1;
      const rightWeight = right.userAdded === true ? 0 : 1;
      return leftWeight - rightWeight;
    });
  }

  return sortChannels(channels);
}

/** 统计被丢弃的条目数（无频道名的行）。 */
export function countUnnamedStreams(streams: readonly Stream[]): number {
  let count = 0;
  for (const stream of streams) {
    if (identifyChannel(stream.rawName) === null) {
      count += 1;
    }
  }
  return count;
}
