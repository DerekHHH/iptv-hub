/**
 * @file M3U / M3U8 播放列表解析。
 *
 * 支持：
 *   - `#EXTINF:-1 tvg-id="a" tvg-name="b" tvg-logo="c" group-title="d",频道名`
 *   - `#EXTINF:-1,频道名`（无属性）
 *   - 完全没有 `#EXTINF` 的纯地址列表（rawName 为空，后续会被丢弃）
 *   - 带 BOM、CRLF 的输入
 */

import type { Stream } from '../types';
import { looksLikeUrl, makeStream, splitUrlField, toCleanLines } from './common';

const EXTINF_PREFIX = '#EXTINF:';
const ATTR_PATTERN = /([a-zA-Z0-9-]+)="([^"]*)"/g;

/** `#EXTINF` 行的解析结果。 */
interface ExtInfMeta {
  name: string;
  tvgId: string;
  tvgName: string;
  logo: string;
  groupTitle: string;
}

/**
 * 解析 `#EXTINF` 行（属性 + `,` 之后的频道名）。
 *
 * @param line 整行文本
 * @return 解析结果
 */
export function parseExtInfLine(line: string): ExtInfMeta {
  const meta: ExtInfMeta = { name: '', tvgId: '', tvgName: '', logo: '', groupTitle: '' };
  const commaIndex = line.lastIndexOf(',');
  const head = commaIndex >= 0 ? line.slice(0, commaIndex) : line;
  const tail = commaIndex >= 0 ? line.slice(commaIndex + 1) : '';
  meta.name = tail.trim();

  ATTR_PATTERN.lastIndex = 0;
  let match = ATTR_PATTERN.exec(head);
  while (match !== null) {
    const key = (match[1] ?? '').toLowerCase();
    const value = (match[2] ?? '').trim();
    if (key === 'tvg-id') {
      meta.tvgId = value;
    } else if (key === 'tvg-name') {
      meta.tvgName = value;
    } else if (key === 'tvg-logo') {
      meta.logo = value;
    } else if (key === 'group-title') {
      meta.groupTitle = value;
    }
    match = ATTR_PATTERN.exec(head);
  }

  return meta;
}

/**
 * 解析 M3U 文本。
 *
 * @param text 原始文本
 * @param origin 来源标识（进 Stream.origin）
 * @return 未归一的 Stream 列表
 */
export function parseM3U(text: string, origin: string): Stream[] {
  const lines = toCleanLines(text);
  const streams: Stream[] = [];
  let pendingName = '';
  let pendingLogo = '';
  /** 待透传给下一条地址的上游分组名（来自 group-title）。 */
  let pendingGroup = '';

  for (const line of lines) {
    if (line.startsWith(EXTINF_PREFIX)) {
      const meta = parseExtInfLine(line);
      // 优先用 tvg-name（上游常用英文名），缺失时回退到逗号后的展示名
      pendingName = meta.tvgName.length > 0 ? meta.tvgName : meta.name;
      if (pendingName.length === 0) {
        pendingName = meta.tvgId;
      }
      pendingLogo = meta.logo;
      pendingGroup = meta.groupTitle;
      continue;
    }

    if (line.startsWith('#')) {
      // #EXTM3U / #EXTGRP / #EXTVLCOPT / 注释 一律跳过
      continue;
    }

    if (!looksLikeUrl(line)) {
      continue;
    }

    for (const url of splitUrlField(line)) {
      // group-title 透传：上游自带的分组是很强的分类信号（见 normalize/group.ts 优先级）
      streams.push(
        makeStream(url, pendingName, origin, { logo: pendingLogo, upstreamGroup: pendingGroup }),
      );
    }
    pendingName = '';
    pendingLogo = '';
    pendingGroup = '';
  }

  return streams;
}

/**
 * 判断文本是否 M3U 格式。
 *
 * @param text 原始文本
 * @return true 表示 M3U
 */
export function isM3U(text: string): boolean {
  return /#EXTM3U|#EXTINF/i.test(text.slice(0, 4096));
}
