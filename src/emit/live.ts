/**
 * @file 赛事直播产物（`dist/live/live.txt` 与 `dist/live/live.m3u`）。
 *
 * 与 NBA 赛程产物同性质：**独立一份文件**，不混进主频道列表（`all.txt`）。
 * 原因：这些链接只有手机服务在跑的时候才有效，且内容每天完全换一批，
 * 混进主列表会让频道目录持续抖动、还会把"找不到台"的锅甩给主源。
 *
 * 格式沿用主产物约定（UTF-8 无 BOM、LF、`分组名,#genre#` 组头），
 * 只是分组名细到「分类|线路」（`足球|高清`），电视端分组栏一眼能看出
 * 是哪个分类、走的哪条线路；非直播中的条目在名字前加 `[已结束]` 之类的标记。
 *
 * 失败策略：服务不在（GitHub Actions / 手机没起服务）时**不写产物**，
 * 保留上一版，只打 info 日志，绝不影响主列表。
 */

import { PATHS } from '../config';
import { fetchLiveMatches, type LiveMatch, type LiveStatus } from '../sources/wudaliansai';
import { writeTextFile } from '../util/fsx';
import { log } from '../util/logger';

/** TXT 分组头标记（与 `emit/txt.ts` 保持一致）。 */
const GENRE_MARKER = '#genre#';

/** 状态 → 名条前缀（直播中的保持干净，不加标记）。 */
const STATUS_TAG: Readonly<Record<LiveStatus, string>> = {
  live: '',
  upcoming: '[未开赛]',
  unavailable: '[暂无直播]',
  ended: '[已结束]',
};

/**
 * 分组名：`足球|高清`。
 *
 * @param match 赛事
 * @param line 线路名（可为空）
 * @return 分组名
 */
function groupLabel(match: LiveMatch, line: string): string {
  return line.length > 0 ? `${match.category}|${line}` : match.category;
}

/**
 * 名条文案：非直播中的加状态前缀。
 *
 * @param match 赛事
 * @return 名条
 */
function entryLabel(match: LiveMatch): string {
  const tag = STATUS_TAG[match.status];
  return tag.length > 0 ? `${tag} ${match.title}` : match.title;
}

/**
 * 收集「分组名 → 该组的全部 `(名条, 地址)`」，分组顺序保持输入顺序。
 *
 * @param matches 赛事列表
 * @return 有序分组
 */
function collectGroups(matches: readonly LiveMatch[]): Array<{ group: string; items: Array<[string, string]> }> {
  const order: string[] = [];
  const buckets = new Map<string, Array<[string, string]>>();

  for (const match of matches) {
    const label = entryLabel(match);
    for (const variant of match.variants) {
      const group = groupLabel(match, variant.line);
      let bucket = buckets.get(group);
      if (bucket === undefined) {
        bucket = [];
        buckets.set(group, bucket);
        order.push(group);
      }
      bucket.push([label, variant.url]);
    }
  }

  return order.map((group) => ({ group, items: buckets.get(group) ?? [] }));
}

/**
 * 渲染 TXT（可直接当直播源导入影视仓 / DIYP）。
 *
 * @param matches 赛事列表
 * @return TXT 文本（以单个 `\n` 结尾）
 */
export function renderLiveTxt(matches: readonly LiveMatch[]): string {
  const groups = collectGroups(matches);
  const lines: string[] = [];
  let isFirst = true;

  for (const { group, items } of groups) {
    if (!isFirst) {
      lines.push('');
    }
    isFirst = false;
    lines.push(`${group},${GENRE_MARKER}`);
    for (const [label, url] of items) {
      lines.push(`${label},${url}`);
    }
  }

  if (lines.length === 0) {
    return '';
  }
  return `${lines.join('\n')}\n`;
}

/**
 * 渲染 M3U（带台标与分组，播放器识别更准）。
 *
 * @param matches 赛事列表
 * @return M3U 文本
 */
export function renderLiveM3u(matches: readonly LiveMatch[]): string {
  const lines: string[] = ['#EXTM3U'];
  for (const match of matches) {
    for (const variant of match.variants) {
      const attributes = [`group-title="${groupLabel(match, variant.line)}"`];
      if (match.logo !== undefined && match.logo.length > 0) {
        attributes.unshift(`tvg-logo="${match.logo}"`);
      }
      lines.push(`#EXTINF:-1 ${attributes.join(' ')},${entryLabel(match)}`);
      lines.push(variant.url);
    }
  }
  return `${lines.join('\n')}\n`;
}

/**
 * 生成并落盘赛事直播产物。
 *
 * @param options 路径与注入依赖
 * @return 抓取结果（含是否写出）
 */
export async function emitLive(
  options: {
    txtPath?: string;
    m3uPath?: string;
    fetchImpl?: typeof fetch;
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<{ ok: boolean; matches: LiveMatch[]; error?: string }> {
  const txtPath = options.txtPath ?? PATHS.liveTxt;
  const m3uPath = options.m3uPath ?? PATHS.liveM3u;

  const outcome = await fetchLiveMatches({
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    ...(options.env === undefined ? {} : { env: options.env }),
  });
  if (!outcome.ok) {
    return { ok: false, matches: [], ...(outcome.error === undefined ? {} : { error: outcome.error }) };
  }

  const txt = renderLiveTxt(outcome.matches);
  const m3u = renderLiveM3u(outcome.matches);
  if (txt.length === 0) {
    return { ok: false, matches: [], error: '渲染结果为空' };
  }

  await writeTextFile(txtPath, txt);
  await writeTextFile(m3uPath, m3u);

  const variantCount = outcome.matches.reduce((total, match) => total + match.variants.length, 0);
  const liveCount = outcome.matches.filter((match) => match.status === 'live').length;
  log.info(
    'live',
    `写出 ${txtPath}，${outcome.matches.length} 场赛事 / ${variantCount} 条线路（直播中 ${liveCount} 场），对外地址 ${outcome.publicBase}`,
  );
  return { ok: true, matches: outcome.matches };
}