/**
 * @file EPG 产物生成（P0-7）：标准 XMLTV，时间戳 `YYYYMMDDHHmmss +0800`。
 *
 * 约定 §1：`<channel id>` 用 ASCII slug，`<display-name>` 用中文名。
 * 失败策略：EPG 抓不到节目时**仍然输出仅含 `<channel>` 的最小合法 XMLTV**，
 * 并把 `stats.epg.ok` 置 false —— 列表（txt/m3u）绝不受影响。
 */

import { EPG, EPG_SOURCES, PATHS } from '../config';
import { EPG_NAME_ALIASES } from '../data/channel-rules';
import { sortChannels } from '../data/groups';
import { identifyChannel } from '../normalize/channelName';
import type { Channel } from '../types';
import { writeTextFile } from '../util/fsx';
import { fetchText } from '../util/http';
import { formatXmltvTime } from '../util/time';

/** 一条节目单记录。 */
export interface EpgProgramme {
  /** 对应频道 slug */
  channelSlug: string;
  /** 开始时间（毫秒时间戳） */
  startMs: number;
  /** 结束时间（毫秒时间戳） */
  stopMs: number;
  /** 节目名 */
  title: string;
}

/** 渲染结果。 */
export interface EpgRenderResult {
  xml: string;
  programmes: number;
}

/** EPG 生成结论。 */
export interface EpgOutcome {
  ok: boolean;
  programmes: number;
  error?: string;
}

/**
 * XML 特殊字符转义。
 *
 * @param value 原始文本
 * @return 转义后文本
 */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * 解析 XMLTV 时间戳为毫秒。
 *
 * @param text 形如 '20250101120000 +0800'
 * @return 毫秒时间戳；无法解析返回 null
 */
export function parseXmltvTime(text: string): number | null {
  const match = text
    .trim()
    .match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4})?$/);
  if (match === null) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] === undefined ? 0 : Number(match[6]);
  const offsetText = match[7];
  let offsetMs = 0;
  if (offsetText !== undefined) {
    const sign = offsetText.startsWith('-') ? -1 : 1;
    const offsetHour = Number(offsetText.slice(1, 3));
    const offsetMinute = Number(offsetText.slice(3, 5));
    offsetMs = sign * (offsetHour * 3600 + offsetMinute * 60) * 1000;
  }
  const utcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  if (!Number.isFinite(utcMs)) {
    return null;
  }
  return utcMs - offsetMs;
}

/**
 * 渲染 XMLTV 文本（纯函数）。
 *
 * @param channels 优选后的频道
 * @param programmes 节目单（slug 不在 channels 里的会被丢弃）
 * @return XML 文本与节目条数
 */
export function renderEpg(channels: readonly Channel[], programmes: readonly EpgProgramme[]): EpgRenderResult {
  const ordered = sortChannels(channels).filter((channel) => channel.streams.length > 0);
  const known = new Set(ordered.map((channel) => channel.id));

  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<tv generator-info-name="iptv_source_hub" generator-info-url="https://github.com">');

  for (const channel of ordered) {
    lines.push(`  <channel id="${escapeXml(channel.id)}">`);
    lines.push(`    <display-name>${escapeXml(channel.name)}</display-name>`);
    if (channel.logo !== undefined && channel.logo.length > 0) {
      lines.push(`    <icon src="${escapeXml(channel.logo)}" />`);
    }
    lines.push('  </channel>');
  }

  const usable = programmes
    .filter((item) => known.has(item.channelSlug))
    .filter((item) => Number.isFinite(item.startMs) && Number.isFinite(item.stopMs))
    .sort((left, right) => {
      if (left.channelSlug !== right.channelSlug) {
        return left.channelSlug < right.channelSlug ? -1 : 1;
      }
      return left.startMs - right.startMs;
    });

  for (const item of usable) {
    lines.push(
      `  <programme start="${formatXmltvTime(item.startMs)}" stop="${formatXmltvTime(item.stopMs)}" channel="${escapeXml(item.channelSlug)}">`,
    );
    lines.push(`    <title lang="zh">${escapeXml(item.title)}</title>`);
    lines.push('  </programme>');
  }

  lines.push('</tv>');
  return { xml: `${lines.join('\n')}\n`, programmes: usable.length };
}

/**
 * 从上游 XMLTV 里抽出本仓库关心的节目单。
 *
 * 匹配链路：上游 `<channel id>` → display-name → 本仓库 slug。
 *
 * @param xml 上游 XMLTV 文本
 * @param knownSlugs 本仓库已有频道 slug
 * @return 节目单（已按频道去重上限截断由调用方处理）
 */
export function extractProgrammes(xml: string, knownSlugs: ReadonlySet<string>): EpgProgramme[] {
  const document = xml.length > EPG.maxDocumentChars ? xml.slice(0, EPG.maxDocumentChars) : xml;
  const upstreamToSlug = new Map<string, string>();

  const channelPattern = /<channel\b([^>]*)>([\s\S]*?)<\/channel>/g;
  let channelMatch = channelPattern.exec(document);
  while (channelMatch !== null) {
    const attributes = channelMatch[1] ?? '';
    const body = channelMatch[2] ?? '';
    const idMatch = attributes.match(/id\s*=\s*"([^"]*)"/);
    if (idMatch !== null) {
      const upstreamId = (idMatch[1] ?? '').trim();
      const displayNames = [...body.matchAll(/<display-name[^>]*>([\s\S]*?)<\/display-name>/g)].map(
        (item) => (item[1] ?? '').trim(),
      );
      const slug = resolveSlug(displayNames, upstreamId, knownSlugs);
      if (slug !== null) {
        upstreamToSlug.set(upstreamId, slug);
      }
    }
    channelMatch = channelPattern.exec(document);
  }

  const programmes: EpgProgramme[] = [];
  const programmePattern = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/g;
  let programmeMatch = programmePattern.exec(document);
  while (programmeMatch !== null) {
    const attributes = programmeMatch[1] ?? '';
    const body = programmeMatch[2] ?? '';
    const startMatch = attributes.match(/start\s*=\s*"([^"]*)"/);
    const stopMatch = attributes.match(/stop\s*=\s*"([^"]*)"/);
    const channelMatchAttr = attributes.match(/channel\s*=\s*"([^"]*)"/);
    const titleMatch = body.match(/<title[^>]*>([\s\S]*?)<\/title>/);

    if (startMatch !== null && stopMatch !== null && channelMatchAttr !== null && titleMatch !== null) {
      const upstreamId = (channelMatchAttr[1] ?? '').trim();
      const slug = upstreamToSlug.get(upstreamId) ?? null;
      const startMs = parseXmltvTime(startMatch[1] ?? '');
      const stopMs = parseXmltvTime(stopMatch[1] ?? '');
      if (slug !== null && startMs !== null && stopMs !== null && stopMs > startMs) {
        programmes.push({
          channelSlug: slug,
          startMs,
          stopMs,
          title: decodeXmlEntities((titleMatch[1] ?? '').trim()),
        });
      }
    }
    programmeMatch = programmePattern.exec(document);
  }

  return programmes;
}

/**
 * 在一组 display-name 里找出本仓库已知的 slug。
 *
 * @param displayNames 上游 display-name 列表
 * @param upstreamId 上游 channel id（用于别名兜底）
 * @param knownSlugs 本仓库已知 slug
 * @return slug 或 null
 */
function resolveSlug(
  displayNames: readonly string[],
  upstreamId: string,
  knownSlugs: ReadonlySet<string>,
): string | null {
  for (const name of displayNames) {
    if (name.length === 0) {
      continue;
    }
    const alias = EPG_NAME_ALIASES[name];
    if (alias !== undefined && knownSlugs.has(alias)) {
      return alias;
    }
    const identity = identifyChannel(name);
    if (identity !== null && knownSlugs.has(identity.id)) {
      return identity.id;
    }
  }
  const directId = EPG_NAME_ALIASES[upstreamId];
  if (directId !== undefined && knownSlugs.has(directId)) {
    return directId;
  }
  return null;
}

/**
 * 还原常见 XML 实体。
 *
 * @param value 已转义文本
 * @return 明文
 */
function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * 抓取并生成 EPG 产物。
 *
 * @param channels 优选后的频道
 * @param options 目标路径与注入依赖
 * @return 结论（ok/programmes/error）
 */
export async function emitEpg(
  channels: readonly Channel[],
  options: {
    filePath?: string;
    fetchImpl?: typeof fetch;
    sources?: readonly string[];
  } = {},
): Promise<EpgOutcome> {
  const filePath = options.filePath ?? PATHS.epg;
  const doFetch = options.fetchImpl ?? fetch;
  const sources = (options.sources ?? EPG_SOURCES).slice(0, EPG.maxSources);
  const knownSlugs = new Set(sortChannels(channels).filter((c) => c.streams.length > 0).map((c) => c.id));

  const collected: EpgProgramme[] = [];
  const errors: string[] = [];

  for (const source of sources) {
    if (knownSlugs.size === 0) {
      break;
    }
    try {
      const response = await fetchText(source, {
        timeoutMs: EPG.timeoutMs,
        retries: 0,
        fetchImpl: doFetch,
      });
      if (!response.ok) {
        errors.push(`${source} HTTP ${response.status}`);
        continue;
      }
      const found = extractProgrammes(response.text, knownSlugs);
      if (found.length > 0) {
        collected.push(...found);
        break;
      }
      errors.push(`${source} 无可用节目`);
    } catch (error) {
      errors.push(`${source} ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // 每频道最多保留 N 条，防止产物膨胀
  const perChannel = new Map<string, EpgProgramme[]>();
  for (const item of collected) {
    const bucket = perChannel.get(item.channelSlug) ?? [];
    if (bucket.length < EPG.maxProgrammesPerChannel) {
      bucket.push(item);
    }
    perChannel.set(item.channelSlug, bucket);
  }
  const trimmed: EpgProgramme[] = [];
  for (const bucket of perChannel.values()) {
    trimmed.push(...bucket);
  }

  const rendered = renderEpg(channels, trimmed);
  await writeTextFile(filePath, rendered.xml);

  if (rendered.programmes === 0) {
    return {
      ok: false,
      programmes: 0,
      error: errors.length > 0 ? `未获取到节目单：${errors.join('；')}` : '未获取到节目单',
    };
  }
  return { ok: true, programmes: rendered.programmes };
}
