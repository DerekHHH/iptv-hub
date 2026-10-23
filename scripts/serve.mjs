#!/usr/bin/env node
/**
 * @file 本机服务：静态站点 + 赛事刷新 API + 自动 git pull。
 *
 * 手机（Termux）上一条命令起服务，浏览器打开 http://127.0.0.1:18080 即可，
 * 不再依赖 github.io。
 *
 * 三个职责：
 *   1. 静态托管 `pages-out/`（首页/频道页/播放页/后台）与 `dist/` 产物
 *   2. `POST /api/live/refresh` —— 只刷赛事（秒级），不重走主链路
 *   3. 启动时 + 每 30 分钟 `git pull --ff-only`，把 Actions 的新产物同步到本机
 *
 * 设计要点：
 *   - 默认只绑 `127.0.0.1`，手机本机可访问，局域网内其他设备访问不到
 *     （赛事中转走 wudaliansai 自己的 0.0.0.0:18765，两者互不影响）
 *   - `/live/*` 直接读 `dist/live/`，不走 `pages-out` 的副本，
 *     所以赛事刷新完页面立刻是新的，不需要重新装配
 *   - git pull 失败（离线/冲突）只记一行日志，绝不让服务挂掉
 *
 * 环境变量：
 *   SERVE_HOST=127.0.0.1
 *   SERVE_PORT=18080
 *   SERVE_PULL_INTERVAL_MS=1800000   # 自动 pull 间隔，默认 30 分钟
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

/** 扩展名 → Content-Type。 */
export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.m3u': 'audio/x-mpegurl; charset=utf-8',
  '.m3u8': 'audio/x-mpegurl; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.map': 'application/json; charset=utf-8',
};

/**
 * 把 URL 路径解析成磁盘绝对路径。
 *
 * `/live/*` 走 `dist/live`（赛事刷新后立即可见，不经过 pages-out 副本），
 * 其余走 `pagesDir`（pages-out）。带扩展名但文件不存在时返回 null（404），
 * 不带扩展名则回退 `index.html`（HashRouter 深链兜底）。
 *
 * @param {string} urlPath 请求路径（不含 query）
 * @param {{pagesDir: string, liveDir: string}} dirs 目录配置
 * @returns {string | null} 绝对路径；非法路径返回 null
 */
export function resolveStaticPath(urlPath, dirs) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  } catch {
    return null;
  }
  if (decoded.includes('\0')) {
    return null;
  }

  const isLive = decoded === '/live' || decoded.startsWith('/live/');
  // 目录要先 normalize 成绝对路径，否则 Windows 上 '/tmp/pages' 与 resolve 出来的
  // '\tmp\pages' 分隔符不同，下面的前缀校验会误判成穿越。
  const baseDir = resolve(isLive ? dirs.liveDir : dirs.pagesDir);
  const relative = isLive ? decoded.slice('/live'.length) : decoded;

  // 目录穿越防护：逐段检查，`..` 直接拒绝（不能先 normalize，否则 .. 会被吃掉）
  const parts = relative.split('/').filter((part) => part.length > 0 && part !== '.');
  if (parts.some((part) => part === '..')) {
    return null;
  }
  const candidate = resolve(baseDir, ...parts);
  if (candidate !== baseDir && !candidate.startsWith(baseDir + sep)) {
    return null;
  }
  return candidate;
}

/**
 * 统计赛事清单里的场数 / 线路数 / 直播中场数。
 *
 * 清单格式（TVBox TXT）：分组头是 `足球|高清,#genre#`，其余是 `台名,地址`。
 * 台名里的 `|完场`、`|未开赛`、`|暂无直播` 表示这场看不了。
 *
 * @param {string} txt 清单文本
 * @returns {{matches: number, lines: number, liveNow: number}}
 */
export function countLiveEntries(txt) {
  const names = new Set();
  let lines = 0;
  let liveNow = 0;

  for (const raw of txt.split('\n')) {
    const line = raw.trim();
    if (line.length === 0 || line.endsWith(',#genre#')) {
      continue;
    }
    const comma = line.indexOf(',');
    if (comma <= 0) {
      continue;
    }
    lines += 1;
    const name = line.slice(0, comma);
    names.add(name);
    if (!/\|(?:完场|未开赛|暂无直播)$/.test(name)) {
      liveNow += 1;
    }
  }
  return { matches: names.size, lines, liveNow };
}

/** 跑一条命令并收集结果，永不抛异常。 */
function runCommand(command, args, options = {}) {
  return new Promise((done) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      shell: process.platform === 'android' || options.shell === true,
      ...options,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', (error) => done({ code: -1, stdout, stderr: String(error) }));
    child.on('close', (code) => done({ code: code ?? -1, stdout, stderr }));
  });
}

/**
 * 创建本机服务。
 *
 * @param {{host?: string, port?: number, pagesDir?: string, liveDir?: string,
 *          pullIntervalMs?: number, autoPull?: boolean, liveCommand?: string[]}} options
 */
export function createServeServer(options = {}) {
  const host = options.host ?? process.env.SERVE_HOST ?? '127.0.0.1';
  const port = options.port ?? Number(process.env.SERVE_PORT ?? 18080);
  const pagesDir = options.pagesDir ?? join(ROOT, 'pages-out');
  const liveDir = options.liveDir ?? join(ROOT, 'dist', 'live');
  const pullIntervalMs = options.pullIntervalMs ?? Number(process.env.SERVE_PULL_INTERVAL_MS ?? 30 * 60 * 1000);
  const autoPull = options.autoPull ?? true;
  // 直接用 node --import tsx 跑，跳过 npm 包装层（省 1~2 秒启动开销）
  const liveCommand = options.liveCommand ?? ['node', ['--import', 'tsx', 'src/pipeline/liveOnly.ts']];

  /**
   * 最近一次**真实访问**的时间戳文件。
   *
   * 看门狗用它判断"网页服务开着但一直没人用"，好做自动回收。
   * 只有非 /api/ 的请求才算（看门狗自己的健康探测走 /api/，不能自我续命）。
   */
  const lastUseFile = options.lastUseFile
    ?? process.env.SERVE_LAST_USE_FILE
    ?? join(homedir(), '.local', 'state', 'iptv-hub', 'web.last');
  let lastUseDirReady = false;

  /**
   * 开关状态文件所在目录（与 scripts/toggle.sh 共用同一套状态）。
   */
  const stateDir = options.stateDir
    ?? process.env.SERVE_STATE_DIR
    ?? join(homedir(), '.local', 'state', 'iptv-hub');

  /** 读某个开关的状态（不存在时按默认值算）。 */
  async function readState(name) {
    try {
      const raw = await readFile(join(stateDir, `${name}.state`), 'utf8');
      return raw.trim() === 'on' ? 'on' : 'off';
    } catch {
      return name === 'live' ? 'on' : 'off';
    }
  }

  /** 写某个开关的状态。 */
  async function writeState(name, value) {
    await mkdir(stateDir, { recursive: true });
    await writeFile(join(stateDir, `${name}.state`), `${value}\n`);
  }

  async function markUsed() {
    try {
      if (!lastUseDirReady) {
        await mkdir(resolve(lastUseFile, '..'), { recursive: true });
        lastUseDirReady = true;
      }
      await writeFile(lastUseFile, String(Date.now()));
    } catch {
      // 记录失败不影响服务
    }
  }

  const state = {
    liveRunning: false,
    lastLive: null,
    lastPull: null,
    startedAt: Date.now(),
  };

  async function pullOnce(trigger) {
    const result = await runCommand('git', ['pull', '--ff-only'], { shell: false });
    state.lastPull = {
      at: new Date().toISOString(),
      trigger,
      ok: result.code === 0,
      message: result.code === 0 ? '已同步' : (result.stderr.trim().split('\n').pop() ?? '未知原因'),
    };
    return state.lastPull;
  }

  async function refreshLive() {
    if (state.liveRunning) {
      return { ok: false, reason: 'running' };
    }
    state.liveRunning = true;
    const startedAt = Date.now();
    try {
      const [command, args] = liveCommand;
      const result = await runCommand(command, args, { shell: true });
      const durationMs = Date.now() - startedAt;

      if (result.code !== 0) {
        const message = result.stderr.trim().split('\n').pop() ?? '赛事构建失败';
        state.lastLive = { ok: false, at: new Date().toISOString(), durationMs, message };
        return state.lastLive;
      }
      let counts = { matches: 0, lines: 0, liveNow: 0 };
      try {
        counts = countLiveEntries(await readFile(join(liveDir, 'live.txt'), 'utf8'));
      } catch {
        // 产物读不到就只报成功，不判失败
      }
      state.lastLive = {
        ok: true,
        at: new Date().toISOString(),
        durationMs,
        matches: counts.matches,
        lines: counts.lines,
        liveNow: counts.liveNow,
      };
      return state.lastLive;
    } finally {
      state.liveRunning = false;
    }
  }

  function sendJson(res, status, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(body),
    });
    res.end(body);
  }

  const server = createServer(async (req, res) => {
    const url = req.url ?? '/';

    try {
      if (url.startsWith('/api/')) {
        if (url.startsWith('/api/health')) {
          sendJson(res, 200, {
            ok: true,
            mode: 'local',
            root: ROOT,
            uptimeMs: Date.now() - state.startedAt,
            liveRunning: state.liveRunning,
            lastLive: state.lastLive,
            lastPull: state.lastPull,
          });
          return;
        }
        if (url.startsWith('/api/live/status')) {
          sendJson(res, 200, { running: state.liveRunning, last: state.lastLive });
          return;
        }
        if (url.startsWith('/api/state')) {
          if (req.method === 'POST') {
            // 页面上的开关：改状态文件，看门狗会在几秒内对齐
            const chunks = [];
            for await (const chunk of req) {
              chunks.push(chunk);
            }
            let body = {};
            try {
              body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            } catch {
              sendJson(res, 400, { ok: false, message: '请求体不是合法 JSON' });
              return;
            }
            const target = body.target === 'live' ? 'live' : 'web';
            const value = body.value === 'on' ? 'on' : 'off';
            await writeState(target, value);
            sendJson(res, 200, { ok: true, target, value });
            // 关网页服务时直接退出，省得等看门狗（状态已是 off，不会被拉起）
            if (target === 'web' && value === 'off') {
              setTimeout(() => process.exit(0), 150);
            }
            return;
          }
          sendJson(res, 200, {
            web: await readState('web'),
            live: await readState('live'),
          });
          return;
        }
        if (url.startsWith('/api/live/refresh')) {
          if (req.method !== 'POST') {
            sendJson(res, 405, { ok: false, message: '请用 POST' });
            return;
          }
          if (state.liveRunning) {
            sendJson(res, 409, { ok: false, message: '赛事正在刷新，请稍候' });
            return;
          }
          const result = await refreshLive();
          sendJson(res, result.ok ? 200 : 500, result);
          return;
        }
        sendJson(res, 404, { ok: false, message: '接口不存在' });
        return;
      }

      const filePath = resolveStaticPath(url, { pagesDir, liveDir });
      if (filePath === null) {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('路径不合法');
        return;
      }

      // 真实访问打点（/api/ 下的探测不算，用于看门狗的自动回收判断）
      if (!url.startsWith('/api/')) {
        void markUsed();
      }

      let target = filePath;
      let body;
      try {
        body = await readFile(target);
      } catch {
        const looksLikeFile = extname(filePath).length > 0;
        if (looksLikeFile) {
          res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('没有这个文件');
          return;
        }
        // HashRouter 深链回退
        target = join(pagesDir, 'index.html');
        try {
          body = await readFile(target);
        } catch {
          res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('还没构建网页，先跑 npm run web:build');
          return;
        }
      }

      const type = MIME[extname(target).toLowerCase()] ?? 'application/octet-stream';
      res.writeHead(200, {
        'content-type': type,
        'cache-control': type.includes('json') || type.startsWith('text/plain') ? 'no-store' : 'public, max-age=300',
        'content-length': body.length,
      });
      res.end(body);
    } catch (error) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`服务出错：${String(error)}`);
    }
  });

  let pullTimer = null;
  let heartbeatTimer = null;

  /**
   * 心跳：定时做一件微小的事，把进程从"空闲"状态里拽出来。
   *
   * 背景（实测）：Android 厂商（vivo 等）会给进入后台的应用降级调度，
   * 空闲的 Node 进程会拿不到 CPU，事件循环随之停摆——连接能建立但服务
   * 一个字节都不回，浏览器报 ERR_TIMED_OUT。同一个应用里的原生二进制
   * （wudaliansai）却不受影响，说明是"空闲被降级"而非"整个应用被冻"。
   * 保持周期性活动可以避免被判定为空闲。
   */
  function startHeartbeat() {
    const intervalMs = Number(process.env.SERVE_HEARTBEAT_MS ?? 10000);
    heartbeatTimer = setInterval(() => {
      // 一次极轻量的本地读，既产生活动又不打扰 I/O
      void readFile(join(pagesDir, 'index.html')).catch(() => undefined);
    }, intervalMs);
    heartbeatTimer.unref?.();
  }

  server.on('listening', () => {
    startHeartbeat();
    if (!autoPull) {
      return;
    }
    void pullOnce('启动时');
    pullTimer = setInterval(() => { void pullOnce('定时'); }, pullIntervalMs);
    pullTimer.unref?.();
  });
  server.on('close', () => {
    if (pullTimer !== null) {
      clearInterval(pullTimer);
    }
    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer);
    }
  });

  return { server, state, refreshLive, pullOnce, host, port };
}

/** 直接执行时启动服务。 */
const invokedDirectly = process.argv[1] !== undefined
  && process.argv[1].replace(/\\/g, '/').endsWith('/scripts/serve.mjs');

if (invokedDirectly) {
  const instance = createServeServer();
  instance.server.listen(instance.port, instance.host, () => {
    console.log(`[serve] 本机服务已启动： http://${instance.host}:${instance.port}`);
    console.log(`[serve] 静态目录 ${join(ROOT, 'pages-out')}，赛事目录 ${join(ROOT, 'dist', 'live')}`);
    console.log('[serve] 赛事刷新： POST /api/live/refresh（或点首页上的按钮）');
  });
  instance.server.on('error', (error) => {
    console.error(`[serve] 启动失败：${error.message}`);
    if (String(error.message).includes('EADDRINUSE')) {
      console.error(`[serve] 端口 ${instance.port} 被占用，换一个：SERVE_PORT=18081 npm run serve`);
    }
    process.exitCode = 1;
  });
}