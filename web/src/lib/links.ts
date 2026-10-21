/**
 * @file 三套产物链接 + stats.json 读取。
 *
 * 同一个产物三种取法：
 *   - Pages：`https://<owner>.github.io/<repo>/txt/all.txt`（有 CDN、最稳）
 *   - Raw：`https://raw.githubusercontent.com/<owner>/<repo>/main/dist/txt/all.txt`（最直接，偶被墙）
 *   - jsDelivr：`https://cdn.jsdelivr.net/gh/<owner>/<repo>@main/dist/txt/all.txt`（国内镜像加速）
 */

/** 仓库定位。 */
export interface RepoRef {
  owner: string;
  repo: string;
}

/** 一条可复制的产物链接。 */
export interface ProductLink {
  /** 标识：txt / m3u / epg / mirror */
  key: string;
  /** 中文名 */
  label: string;
  /** 用途说明（大白话） */
  description: string;
  /** 完整 URL */
  url: string;
}

/** 三套链接集合。 */
export interface LinkSet {
  /** 主推荐：Pages 版 TXT */
  primary: ProductLink;
  /** 全部链接（顺序即展示顺序） */
  all: readonly ProductLink[];
}

/** 产物在仓库里的相对路径。 */
const PATHS = {
  txt: 'dist/txt/all.txt',
  m3u: 'dist/m3u/all.m3u',
  epg: 'dist/epg/epg.xml',
} as const;

/** 默认分支名。 */
export const MAIN_BRANCH = 'main';

/**
 * 从当前网址推断 owner/repo（`https://<owner>.github.io/<repo>/`）。
 *
 * 自定义域名或本地开发时返回 null，调用方应让用户手动填。
 *
 * @return 仓库定位或 null
 */
export function inferRepo(): RepoRef | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const { hostname, pathname } = window.location;
  const segments = pathname.split('/').filter((item) => item.length > 0);

  const githubIoMatch = hostname.match(/^([^.]+)\.github\.io$/i);
  if (githubIoMatch !== null) {
    const owner = githubIoMatch[1] ?? '';
    if (owner.length === 0) {
      return null;
    }
    // 用户主页仓库：https://owner.github.io/  （没有 repo 段）
    const repo = segments[0] ?? `${owner}.github.io`;
    return { owner, repo };
  }

  return null;
}

/** 手动填写的 owner/repo 在 localStorage 里的键名。 */
export const REPO_OVERRIDE_KEY = 'iptv_hub_repo_override';

/**
 * 读取用户手动填写的仓库定位（自定义域名 / 本地开发时用）。
 *
 * @return 仓库定位或 null
 */
export function readRepoOverride(): RepoRef | null {
  try {
    const raw = window.localStorage.getItem(REPO_OVERRIDE_KEY);
    if (raw === null) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<RepoRef>;
    if (typeof parsed.owner === 'string' && typeof parsed.repo === 'string' && parsed.owner.length > 0 && parsed.repo.length > 0) {
      return { owner: parsed.owner, repo: parsed.repo };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 保存 / 清除手动填写的仓库定位。
 *
 * @param ref 仓库定位，传 null 表示清除
 */
export function writeRepoOverride(ref: RepoRef | null): void {
  try {
    if (ref === null) {
      window.localStorage.removeItem(REPO_OVERRIDE_KEY);
      return;
    }
    window.localStorage.setItem(REPO_OVERRIDE_KEY, JSON.stringify(ref));
  } catch {
    // localStorage 不可用（隐私模式）时静默失败
  }
}

/**
 * 优先级：网址自动推断 → 用户手填。
 *
 * @return 仓库定位或 null
 */
export function resolveRepo(): RepoRef | null {
  return inferRepo() ?? readRepoOverride();
}

/**
 * 生成三套链接。
 *
 * @param repo 仓库定位
 * @return 链接集合
 */
export function buildLinks(repo: RepoRef): LinkSet {
  const pagesBase = `https://${repo.owner}.github.io/${repo.repo}`;
  const rawBase = `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${MAIN_BRANCH}`;
  const jsdelivrBase = `https://cdn.jsdelivr.net/gh/${repo.owner}/${repo.repo}@${MAIN_BRANCH}`;

  const all: ProductLink[] = [
    {
      key: 'txt',
      label: 'TXT 列表（推荐，绝大多数电视用这个）',
      description: 'DIYP、影视仓、TVBox 都能直接读。粘一次，长期有效。',
      url: `${pagesBase}/txt/all.txt`,
    },
    {
      key: 'm3u',
      label: 'M3U 列表（部分播放器用）',
      description: '支持台标和分组信息，播放器识别更准。',
      url: `${pagesBase}/m3u/all.m3u`,
    },
    {
      key: 'epg',
      label: 'EPG 节目单（电视报节目表）',
      description: '配套的节目时间表，播放器里填在"节目单地址"处。',
      url: `${pagesBase}/epg/epg.xml`,
    },
    {
      key: 'raw-txt',
      label: 'TXT · GitHub 原始地址（备用）',
      description: 'Pages 打不开时试这个，内容和上面完全一样。',
      url: `${rawBase}/${PATHS.txt}`,
    },
    {
      key: 'jsdelivr-txt',
      label: 'TXT · 国内加速镜像（打不开时选它）',
      description: '国内访问更快，内容每 12 小时同步一次。',
      url: `${jsdelivrBase}/${PATHS.txt}`,
    },
    {
      key: 'jsdelivr-m3u',
      label: 'M3U · 国内加速镜像',
      description: '同上，M3U 格式的加速地址。',
      url: `${jsdelivrBase}/${PATHS.m3u}`,
    },
    {
      key: 'jsdelivr-epg',
      label: 'EPG · 国内加速镜像',
      description: '节目单的加速地址。',
      url: `${jsdelivrBase}/${PATHS.epg}`,
    },
  ];

  const primary = all[0] as ProductLink;
  return { primary, all };
}

/** `stats.json` 里本页用到的字段。 */
export interface Stats {
  version: 1;
  updated_at: string;
  channel_count: number;
  source_count: number;
  groups: Record<string, number>;
  fetch_fail_rate?: number;
  probe?: {
    total: number;
    alive: number;
    dead: number;
    timeout: number;
    skipped: number;
    duration_ms: number;
  };
  epg?: { ok: boolean; programmes: number; error?: string };
  build_duration_ms?: number;
  stale: boolean;
  stale_reason?: string;
}

/** `data/history.json` 里本页用到的字段。 */
export interface History {
  version: 1;
  items: Array<{ updated_at: string; channel_count: number; source_count: number; stale: boolean }>;
}

/**
 * 读取构建统计（相对当前页面路径，Pages 与本地预览都能用）。
 *
 * @return stats 或 null（还没构建过 / 读取失败）
 */
export async function loadStats(): Promise<Stats | null> {
  try {
    const response = await fetch('./stats.json', { cache: 'no-store' });
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as Stats;
    if (typeof data.channel_count !== 'number') {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

/**
 * 读取历史趋势（可选，缺失不影响首页）。
 *
 * 空历史 / 结构不全时返回 null —— 首页据此整块隐藏，不会出现 `undefined.map`。
 *
 * @return 历史或 null
 */
export async function loadHistory(): Promise<History | null> {
  try {
    const response = await fetch('./history.json', { cache: 'no-store' });
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as Partial<History>;
    if (!Array.isArray(data.items)) {
      return null;
    }
    return { version: 1, items: data.items };
  } catch {
    return null;
  }
}

/**
 * 把 ISO 时间（+08:00）格式化成"X 小时前"这种大白话。
 *
 * @param iso ISO 时间串
 * @returns 人读文案
 */
export function formatRelative(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) {
    return '时间未知';
  }
  const diffMinutes = Math.floor((Date.now() - ms) / 60000);
  if (diffMinutes < 1) {
    return '刚刚';
  }
  if (diffMinutes < 60) {
    return `${diffMinutes} 分钟前`;
  }
  const hours = Math.floor(diffMinutes / 60);
  if (hours < 24) {
    return `${hours} 小时前`;
  }
  return `${Math.floor(hours / 24)} 天前`;
}

/**
 * 把 ISO 时间格式化成 `YYYY-MM-DD HH:mm`（按 +08:00 展示）。
 *
 * @param iso ISO 时间串
 * @returns 人读时间
 */
export function formatDateTime(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) {
    return '未知';
  }
  const shifted = new Date(ms + 8 * 3600 * 1000);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ${pad(
    shifted.getUTCHours(),
  )}:${pad(shifted.getUTCMinutes())}`;
}
