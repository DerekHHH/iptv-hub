/**
 * @file 赛事直播产物（`dist/live/live.txt` 与 `dist/live/live.m3u`）。
 *
 * 与 NBA 赛程产物同性质：**独立一份文件**，不混进主频道列表（`all.txt`）。
 * 原因：这些链接只有手机服务在跑的时候才有效，且内容每天完全换一批，
 * 混进主列表会让频道目录持续抖动、还会把"找不到台"的锅甩给主源。
 *
 * 格式沿用主产物约定（UTF-8 无 BOM、LF、`分组名,#genre#` 组头），
 * 只是分组名细到「分类|联赛」（`篮球|NBA`、`足球|英超`），电视端分组栏一眼能看出
 * 是哪项运动、哪个联赛；名条统一带状态前缀（`[直播中]` / `[未开赛]` / `[已结束]`），
 * 同一场比赛的多个资源用线路名区分（`… (高清)`）。
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

/** 状态 → 名条前缀（四种状态统一标注，一眼能分清）。 */
const STATUS_TAG: Readonly<Record<LiveStatus, string>> = {
  live: '[直播中]',
  upcoming: '[未开赛]',
  unavailable: '[暂无直播]',
  ended: '[已结束]',
};

/**
 * 分组名：`篮球|NBA`。
 *
 * 父子两级（`分类|联赛`），播放器里会显示成两层：「篮球」下面分「NBA」「CBA」
 * 「其他联赛」。**线路名不再占分组位**——它写进条目名里（见 `entryLabel`）。
 *
 * @param match 赛事
 * @return 分组名
 */
function groupLabel(match: LiveMatch): string {
  return `${match.category}|${match.league}`;
}

/**
 * 名条文案：`[直播中] 雷霆 vs 掘金 (高清)`。
 *
 * 状态前缀对四种状态统一输出；线路名非空时追加在括号里（同一场比赛的多个
 * 资源就是靠它区分的）。
 *
 * @param match 赛事
 * @param line 线路名（可为空）
 * @return 名条
 */
function entryLabel(match: LiveMatch, line: string): string {
  const tag = STATUS_TAG[match.status];
  const suffix = line.length > 0 ? ` (${line})` : '';
  return `${tag} ${match.title}${suffix}`;
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
    for (const variant of match.variants) {
      const label = entryLabel(match, variant.line);
      const group = groupLabel(match);
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
      const attributes = [`group-title="${groupLabel(match)}"`];
      if (match.logo !== undefined && match.logo.length > 0) {
        attributes.unshift(`tvg-logo="${match.logo}"`);
      }
      lines.push(`#EXTINF:-1 ${attributes.join(' ')},${entryLabel(match, variant.line)}`);
      lines.push(variant.url);
    }
  }
  return `${lines.join('\n')}\n`;
}

/**
 * 判断基址是否只是回环地址（只有本机能播）。
 *
 * @param base 形如 `http://192.168.1.7:18765`
 * @return true 表示回环
 */
function isLoopbackBase(base: string): boolean {
  try {
    const host = new URL(base).hostname.toLowerCase();
    return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
  } catch {
    return true;
  }
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

  // 没探到局域网地址时产物里只会是 127.0.0.1，推到线上等于把已经能用的清单弄坏。
  // 这种情况下宁可不动，等手机连回 Wi-Fi / 开热点后重新构建。
  if (isLoopbackBase(outcome.publicBase)) {
    return {
      ok: false,
      matches: [],
      error: '没有可用的局域网地址（手机只连了蜂窝网？），为避免覆盖线上可用清单，本次不写产物',
    };
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