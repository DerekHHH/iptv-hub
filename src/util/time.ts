/**
 * @file 时区与时间格式化（约定 §4）。
 *
 * Actions runner 时区是 UTC，`Date#toLocaleString` / `Date#toISOString` 一律不可用于产物，
 * 全部走本文件：先把毫秒加 8 小时，再用 `getUTC*` 读"北京时间的墙上时钟"。
 */

/** 北京时间相对 UTC 的偏移（毫秒）。 */
export const CST_OFFSET_MS = 8 * 60 * 60 * 1000;

const pad2 = (value: number): string => String(value).padStart(2, '0');

/**
 * 把毫秒时间戳拆成北京时间的年月日时分秒。
 *
 * @param ms 毫秒时间戳
 * @return 北京时间各字段
 */
export function toCstParts(ms: number): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const shifted = new Date(ms + CST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  };
}

/**
 * XMLTV 时间戳：`YYYYMMDDHHmmss +0800`。
 *
 * @param ms 毫秒时间戳
 * @return 例 '20250101120000 +0800'
 */
export function formatXmltvTime(ms: number): string {
  const p = toCstParts(ms);
  const date = `${p.year}${pad2(p.month)}${pad2(p.day)}`;
  const time = `${pad2(p.hour)}${pad2(p.minute)}${pad2(p.second)}`;
  return `${date}${time} +0800`;
}

/**
 * ISO 8601 带 +08:00 偏移：`YYYY-MM-DDTHH:mm:ss+08:00`。
 *
 * @param ms 毫秒时间戳
 * @return 例 '2025-01-01T12:00:00+08:00'
 */
export function formatIsoCst(ms: number): string {
  const p = toCstParts(ms);
  const date = `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
  const time = `${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}`;
  return `${date}T${time}+08:00`;
}

/**
 * 人读格式：`YYYY-MM-DD HH:mm`（北京时间）。
 *
 * @param ms 毫秒时间戳
 * @return 例 '2025-01-01 12:00'
 */
export function formatHumanCst(ms: number): string {
  const p = toCstParts(ms);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)} ${pad2(p.hour)}:${pad2(p.minute)}`;
}

/**
 * 归档用紧凑时间戳（文件名/日志用）：`YYYYMMDD-HHmmss`。
 *
 * @param ms 毫秒时间戳
 * @return 例 '20250101-120000'
 */
export function formatCompactCst(ms: number): string {
  const p = toCstParts(ms);
  const date = `${p.year}${pad2(p.month)}${pad2(p.day)}`;
  const time = `${pad2(p.hour)}${pad2(p.minute)}${pad2(p.second)}`;
  return `${date}-${time}`;
}

/**
 * 把毫秒时长格式化为中文可读文案。
 *
 * @param ms 毫秒
 * @return 例 '3 分 20 秒'
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) {
    return `${seconds} 秒`;
  }
  return `${minutes} 分 ${seconds} 秒`;
}
