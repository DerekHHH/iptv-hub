/**
 * `scripts/serve.mjs` 的类型声明。
 *
 * 服务本身是纯 JS（Termux 里直接 `node scripts/serve.mjs` 跑，不想引入编译步骤），
 * 这个文件让 TS 侧的测试能拿到类型，`tsc --noEmit` 也能通过。
 */

import type { Server } from 'node:http';

/** 扩展名 → Content-Type 映射。 */
export declare const MIME: Record<string, string>;

/**
 * 把 URL 路径解析成磁盘绝对路径。
 *
 * `/live/*` 走 `liveDir`，其余走 `pagesDir`。
 *
 * @param urlPath 请求路径（不含 query）
 * @param dirs 目录配置
 * @returns 绝对路径；路径非法或含目录穿越时返回 null
 */
export declare function resolveStaticPath(
  urlPath: string,
  dirs: { pagesDir: string; liveDir: string },
): string | null;

/**
 * 统计赛事清单的场数 / 线路数 / 直播中场数。
 *
 * @param txt 清单文本（TVBox TXT）
 */
export declare function countLiveEntries(txt: string): {
  matches: number;
  lines: number;
  liveNow: number;
};

/** 服务可配置项。 */
export interface ServeOptions {
  host?: string;
  port?: number;
  pagesDir?: string;
  liveDir?: string;
  pullIntervalMs?: number;
  /** 是否启动时 + 定时 git pull，测试里传 false 关掉 */
  autoPull?: boolean;
  /** 赛事刷新命令，形如 `['npm', ['run', 'build:live']]` */
  liveCommand?: [string, string[]];
}

/** 服务内部状态。 */
export interface ServeState {
  liveRunning: boolean;
  lastLive: Record<string, unknown> | null;
  lastPull: Record<string, unknown> | null;
  startedAt: number;
}

/** `createServeServer()` 的返回值。 */
export interface ServeInstance {
  server: Server;
  state: ServeState;
  host: string;
  port: number;
  refreshLive(): Promise<Record<string, unknown>>;
  pullOnce(trigger: string): Promise<Record<string, unknown>>;
}

/**
 * 创建本机服务实例（不自动 listen）。
 *
 * @param options 配置项
 */
export declare function createServeServer(options?: ServeOptions): ServeInstance;