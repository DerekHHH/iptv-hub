/**
 * @file slug 与 URL 规范化工具（约定 §9）。
 */

/** 不参与测活的 scheme（播放器可能能播，但我们不探测也不输出）。 */
const SUPPORTED_SCHEMES = new Set(['http:', 'https:']);

/**
 * 计算 URL 去重键：小写 scheme+host、保留 path（去末尾 '/'）+ search。
 *
 * 解析失败时退化为"trim 后的原串小写"，保证永不抛错。
 *
 * @param url 原始地址
 * @return 去重键
 */
export function toUrlKey(url: string): string {
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    const protocol = parsed.protocol.toLowerCase();
    const host = parsed.host.toLowerCase();
    let pathname = parsed.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.replace(/\/+$/, '');
    }
    if (pathname === '/') {
      pathname = '';
    }
    return `${protocol}//${host}${pathname}${parsed.search}`;
  } catch {
    return trimmed.toLowerCase();
  }
}

/**
 * 判断是否是可测活的 http/https 地址。
 *
 * @param url 原始地址
 * @return true 表示协议受支持
 */
export function isSupportedUrl(url: string): boolean {
  try {
    return SUPPORTED_SCHEMES.has(new URL(url.trim()).protocol.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * 剥掉探测用后缀（`url|User-Agent=...`）：只用于发起探测，产物仍输出原始 URL。
 *
 * @param url 原始地址
 * @return 可探测地址
 */
export function toProbeUrl(url: string): string {
  const index = url.indexOf('|');
  if (index <= 0) {
    return url.trim();
  }
  return url.slice(0, index).trim();
}

/**
 * FNV-1a 32 位哈希（无依赖、确定性），用于生成稳定 slug。
 *
 * @param input 任意字符串
 * @return 无符号 32 位整数
 */
export function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * 为无法命中的频道生成稳定 ASCII slug：`ch-<base36 哈希>`。
 *
 * 同一个原始写法永远得到同一个 slug，保证多次构建产物一致。
 *
 * @param normalizedName 归一化后的名字（大写、无空格）
 * @return 形如 'ch-1a2b3c'
 */
export function hashSlug(normalizedName: string): string {
  return `ch-${fnv1a(normalizedName).toString(36)}`;
}

/**
 * 把任意中文名压成 ASCII slug 片段（仅在需要英文片段时使用）。
 *
 * 非 ASCII 字符会被丢弃；结果为空时回退到哈希。
 *
 * @param input 原始名
 * @return ASCII 片段
 */
export function asciiFragment(input: string): string {
  const fragment = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return fragment.length > 0 ? fragment : hashSlug(input.toUpperCase());
}
