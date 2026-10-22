/**
 * @file 分组相关的唯一辅助函数集合。
 *
 * 分组常量本体定义在 `src/config.ts`（全局唯一一处），此文件只做再导出与比较逻辑，
 * 避免出现第二份「分组顺序」定义。
 */

import { GROUP_ORDER, GROUP_WEIGHT } from '../config';
import type { Channel, GroupKey } from '../types';

export { GROUP_ORDER, GROUP_WEIGHT };

/** 分组是否合法。 */
export function isGroupKey(value: string): value is GroupKey {
  return (GROUP_ORDER as readonly string[]).includes(value);
}

/** 分组权重（0 最靠前；不在 `GROUP_ORDER` 里的分组排到所有已知分组之后）。 */
export function groupWeight(group: GroupKey): number {
  const index = GROUP_ORDER.indexOf(group);
  return index < 0 ? GROUP_ORDER.length : index;
}

/**
 * 频道排序比较器：先按分组权重升序，再按 channelId ASCII 升序。
 *
 * @param a 频道 A
 * @param b 频道 B
 * @return 负数表示 a 在前
 */
export function compareChannels(a: Channel, b: Channel): number {
  const weightDiff = groupWeight(a.group) - groupWeight(b.group);
  if (weightDiff !== 0) {
    return weightDiff;
  }
  if (a.id === b.id) {
    return 0;
  }
  return a.id < b.id ? -1 : 1;
}

/** 按分组把频道切成有序数组（保持 GROUP_ORDER）。 */
export function sortChannels(channels: readonly Channel[]): Channel[] {
  return [...channels].sort(compareChannels);
}

/** 生成空的分组计数表。 */
export function emptyGroupCount(): Record<GroupKey, number> {
  const result = {} as Record<GroupKey, number>;
  for (const group of GROUP_ORDER) {
    result[group] = 0;
  }
  return result;
}
