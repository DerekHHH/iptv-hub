/**
 * @file 文件读写封装。
 *
 * 约定 §3：产物必须 UTF-8 无 BOM + LF 换行。
 * 这里统一收敛：所有写文本的路径都经过 `writeTextFile`，它会把 CRLF 归一成 LF，
 * 并且绝不写 BOM（Node 的 'utf8' 编码天然不写 BOM）。
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * 递归创建目录（幂等）。
 *
 * @param dir 目标目录
 */
export async function ensureDir(dir: string): Promise<void> {
  if (dir.length === 0) {
    return;
  }
  await mkdir(dir, { recursive: true });
}

/**
 * 写文本文件：UTF-8、无 BOM、强制 LF。
 *
 * @param filePath 目标路径（相对项目根或绝对路径）
 * @param text 文件内容
 */
export async function writeTextFile(filePath: string, text: string): Promise<void> {
  await ensureDir(dirname(filePath));
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  await writeFile(filePath, normalized, 'utf8');
}

/**
 * 写 JSON 文件：2 空格缩进 + 末尾换行 + LF。
 *
 * @param filePath 目标路径
 * @param value 可序列化对象
 */
export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  await writeTextFile(filePath, text);
}

/**
 * 读文本文件；不存在或读取失败时返回 null（调用方决定降级策略）。
 *
 * @param filePath 目标路径
 * @return 文件内容或 null
 */
export async function readTextFileOrNull(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * 读 JSON 文件；缺失、损坏、结构不符时返回兜底值（绝不抛错）。
 *
 * @param filePath 目标路径
 * @param fallback 兜底值
 * @return 解析结果或兜底值
 */
export async function readJsonOr<T>(filePath: string, fallback: T): Promise<T> {
  const text = await readTextFileOrNull(filePath);
  if (text === null) {
    return fallback;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}
