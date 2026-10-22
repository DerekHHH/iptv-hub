/**
 * @file 分组判定（约定 §2，数据驱动版）。
 *
 * 判定优先级（从强到弱，实现见 `resolveGroup`）：
 *   ① 归一规则表里显式声明的分组（规则命中的频道）
 *   ② 上游 `group-title` / `#genre#` 分组名提示（`hintGroupFromTitle`，去掉 emoji 后匹配）
 *   ③ 频道名关键字推断（`inferGroup`，规则来自 `data/group-keywords.json`）
 *   ④ 兜底「其他」
 *
 * 关键字规则**不再是硬编码 if 链**：分组名与关键字都在 `data/group-keywords.json`
 * （数组顺序即优先级，首条命中即返回），管理后台可以在运行时改它，
 * 所以这里只负责「读文件 → 校验 → 逐条比对」。
 *
 * 为什么规则表压过上游分组：上游分组经常是「转发源所在地区」而不是频道归属
 * （香港源里转发 CCTV-1 会被标成"香港"），而规则表是本仓库对频道归属的确定性结论。
 */

import keywordsConfig from '../../data/group-keywords.json';
import { hintGroupFromTitle } from '../data/channel-rules';
import { compareChannels, groupWeight, sortChannels } from '../data/groups';
import type { GroupKey } from '../types';

export { compareChannels, groupWeight, sortChannels };
export { hintGroupFromTitle };

/** 兜底分组：所有关键字都没命中时归到这里。 */
export const FALLBACK_GROUP: GroupKey = '其他';

/** 一条「关键字 → 分组」规则。 */
export interface GroupKeywordRule {
  /** 命中后落到的分组 */
  group: GroupKey;
  /** 命中关键字（比对时统一大写，大小写不敏感） */
  keywords: readonly string[];
}

/**
 * 读取并校验 `data/group-keywords.json`。
 *
 * 结构异常（不是数组 / 缺 group / keywords 为空）的条目一律跳过：
 * 宁可让频道落到「其他」，也不让一次手滑把整条构建打挂。
 *
 * @return 有序规则数组（数组顺序 = 判定优先级）
 */
function loadGroupKeywordRules(): readonly GroupKeywordRule[] {
  const raw: unknown = keywordsConfig;
  if (!Array.isArray(raw)) {
    return [];
  }
  const rules: GroupKeywordRule[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }
    const candidate = item as { group?: unknown; keywords?: unknown };
    if (typeof candidate.group !== 'string' || candidate.group.length === 0) {
      continue;
    }
    if (!Array.isArray(candidate.keywords)) {
      continue;
    }
    const keywords = candidate.keywords.filter(
      (keyword): keyword is string => typeof keyword === 'string' && keyword.length > 0,
    );
    if (keywords.length === 0) {
      continue;
    }
    rules.push({ group: candidate.group, keywords });
  }
  return rules;
}

/** 生效的分组关键字规则（数组顺序 = 优先级）。 */
export const GROUP_KEYWORD_RULES: readonly GroupKeywordRule[] = loadGroupKeywordRules();

/**
 * 判断归一化后的名字是否命中某组关键词。
 *
 * @param haystack 已大写的名字
 * @param keywords 关键词表
 * @return true 表示命中
 */
function hitsKeyword(haystack: string, keywords: readonly string[]): boolean {
  for (const keyword of keywords) {
    if (haystack.includes(keyword.toUpperCase())) {
      return true;
    }
  }
  return false;
}

/**
 * 关键字推断分组（规则表与上游提示都未命中时的兜底）。
 *
 * @param normalizedName 归一化后的名字（大写无空格）
 * @return 分组
 */
export function inferGroup(normalizedName: string): GroupKey {
  for (const rule of GROUP_KEYWORD_RULES) {
    if (hitsKeyword(normalizedName, rule.keywords)) {
      return rule.group;
    }
  }
  return FALLBACK_GROUP;
}

/**
 * 分组判定输入。
 *
 * `nameGroup` 是 `identifyChannel` 给出的分组：规则命中时它是规则表里显式声明的分组，
 * 未命中时它是 `inferGroup` 的关键字推断结果。
 */
export interface GroupDecisionInput {
  /** 名字是否命中了归一规则表（命中则上游提示不得覆盖） */
  ruleMatched: boolean;
  /** `identifyChannel` 给出的分组 */
  nameGroup: GroupKey;
  /** 上游分组名（`Stream.upstreamGroup`），没有则 undefined */
  upstreamGroup?: string;
}

/**
 * 按「① 规则表 → ② 上游分组提示 → ③ 名称关键字 → ④ 其他」判定分组。
 *
 * @param input 判定输入
 * @return 最终分组
 */
export function resolveGroup(input: GroupDecisionInput): GroupKey {
  // ① 规则表显式分组：最高权威，上游提示一律不得覆盖
  if (input.ruleMatched) {
    return input.nameGroup;
  }
  // ② 上游分组提示
  const hinted = hintGroupFromTitle(input.upstreamGroup);
  if (hinted !== undefined) {
    return hinted;
  }
  // ③ 名称关键字（`identifyChannel` 已算好）+ ④ 其他
  return input.nameGroup;
}
