/**
 * @file 分组判定（约定 §2）。
 *
 * 判定优先级：
 *   1. 归一规则表里显式声明的分组
 *   2. 港澳台关键词
 *   3. 广东地市关键词
 *   4. 央视关键词
 *   5. 名称含 `卫视`
 *   6. 兜底「其他」
 */

import { CCTV_KEYWORDS, GUANGDONG_KEYWORDS, HMT_KEYWORDS } from '../data/channel-rules';
import { compareChannels, groupWeight, sortChannels } from '../data/groups';
import type { GroupKey } from '../types';

export { compareChannels, groupWeight, sortChannels };

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
 * 关键词推断分组（规则表未命中时的兜底）。
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
