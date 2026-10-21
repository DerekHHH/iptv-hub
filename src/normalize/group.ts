/**
 * @file 分组判定（约定 §2）。
 *
 * 判定优先级（从强到弱，实现见 `resolveGroup`）：
 *   ① 归一规则表里显式声明的分组（`identifyChannel` 命中规则 → 最高权威）
 *   ② 上游 `group-title` / `#genre#` 分组名提示（`hintGroupFromTitle`，去掉 emoji 后匹配）
 *   ③ 频道名关键词推断（`inferGroup`：港澳台 → 广东 → 央视 → 卫视）
 *   ④ 兜底「其他」
 *
 * 为什么规则表压过上游分组：上游分组经常是「转发源所在地区」而不是频道归属
 * （香港源里转发 CCTV-1 会被标成"香港"），而规则表是本仓库对频道归属的确定性结论。
 */

import {
  CCTV_KEYWORDS,
  GUANGDONG_KEYWORDS,
  HMT_KEYWORDS,
  hintGroupFromTitle,
} from '../data/channel-rules';
import { compareChannels, groupWeight, sortChannels } from '../data/groups';
import type { GroupKey } from '../types';

export { compareChannels, groupWeight, sortChannels };
export { hintGroupFromTitle };

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
 * 关键词推断分组（规则表与上游提示都未命中时的兜底）。
 *
 * @param normalizedName 归一化后的名字（大写无空格）
 * @return 分组
 */
export function inferGroup(normalizedName: string): GroupKey {
  if (hitsKeyword(normalizedName, HMT_KEYWORDS)) {
    return '港澳台';
  }
  if (hitsKeyword(normalizedName, GUANGDONG_KEYWORDS)) {
    return '广东';
  }
  if (hitsKeyword(normalizedName, CCTV_KEYWORDS)) {
    return '央视';
  }
  if (normalizedName.includes('卫视')) {
    return '卫视';
  }
  return '其他';
}

/**
 * 分组判定输入。
 *
 * `nameGroup` 是 `identifyChannel` 给出的分组：规则命中时它是规则表里显式声明的分组，
 * 未命中时它是 `inferGroup` 的关键词推断结果。
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
 * 按「① 规则表 → ② 上游分组提示 → ③ 名称关键词 → ④ 其他」判定分组。
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
  // ③ 名称关键词（`identifyChannel` 已算好）+ ④ 其他
  return input.nameGroup;
}
