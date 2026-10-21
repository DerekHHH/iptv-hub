/**
 * @file 把用户粘贴/上传的源文本解析成待检测条目（浏览器版，不依赖 Node）。
 *
 * 支持三种写法：
 *   - `频道名,http://a.m3u8#http://b.m3u8`
 *   - `http://a.m3u8`（无频道名）
 *   - M3U：`#EXTINF:-1 tvg-name="频道名",显示名` + 下一行地址
 * 分组头 `xxx,#genre#`、`#` 开头的注释一律跳过。
 */

import type { ProbeEntry } from './probeClient';

/** 看起来像播放地址。 */
function looksLikeUrl(value: string): boolean {
  return /^(https?|rtmp|rtsp|rtp|udp|p3p|mms):\/\//i.test(value.trim());
}

/**
 * 解析源文本。
 *
 * @param text 用户粘贴或上传的文本
 * @return 待检测条目（保持原始顺序，按 url 去重）
 */
export function parseSourceText(text: string): ProbeEntry[] {
  const lines = text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim());

  const entries: ProbeEntry[] = [];
  const seen = new Set<string>();
  let pendingName = '';

  /**
   * 追加一条（按 url 去重）。
   *
   * @param url 地址
   * @param rawName 频道名
   */
  const push = (url: string, rawName: string): void => {
    const trimmedUrl = url.trim();
    if (trimmedUrl.length === 0 || seen.has(trimmedUrl)) {
      return;
    }
    seen.add(trimmedUrl);
    entries.push({ rawName: rawName.trim(), url: trimmedUrl });
  };

  for (const line of lines) {
    if (line.length === 0) {
      continue;
    }
    if (line.includes('#genre#')) {
      continue;
    }
    if (line.startsWith('#EXTINF')) {
      const commaIndex = line.lastIndexOf(',');
      const head = commaIndex >= 0 ? line.slice(0, commaIndex) : line;
      const tail = commaIndex >= 0 ? line.slice(commaIndex + 1).trim() : '';
      const tvgNameMatch = head.match(/tvg-name="([^"]*)"/i);
      pendingName = (tvgNameMatch?.[1] ?? tail).trim();
      continue;
    }
    if (line.startsWith('#')) {
      continue;
    }

    if (looksLikeUrl(line)) {
      for (const piece of line.split('#')) {
        if (looksLikeUrl(piece)) {
          push(piece, pendingName);
        }
      }
      pendingName = '';
      continue;
    }

    const commaIndex = line.indexOf(',');
    if (commaIndex > 0) {
      const name = line.slice(0, commaIndex).trim();
      const rest = line.slice(commaIndex + 1);
      for (const piece of rest.split('#')) {
        if (looksLikeUrl(piece)) {
          push(piece, name);
        }
      }
      pendingName = '';
    }
  }

  return entries;
}

/**
 * 造一个可下载的 UTF-8 文本文件（**不加 BOM**）。
 *
 * @param filename 文件名
 * @param text 内容
 */
export function downloadTextFile(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
