// @file 赛事上游智能转发代理（仅本机 127.0.0.1）。
//
// wudaliansai 二进制自带 DoH/TLS 网络栈，在本网络下连不上任何上游候选域名
// （日志里 "no domain passed API health check"），导致 live_items 恒为 0。
// 本代理把二进制对 WUDALIANSAI_DOMAIN / KGQ_DOMAIN 的请求，经**手机系统网络**
// （DNS/TLS 正常）转发到真实上游，绕开二进制那套坏栈。只监听回环，不暴露公网。
//
// 关键点：上游不止一个桶。二进制会请求两类路径：
//   1) /gz/initialize/getApiUrlList 等 —— 在 api.*.com 上做健康探测
//   2) /kgq/kgqapi-android.json     —— 在 pool-sg OSS 桶上
// 本代理对任一入站路径，自动逐个尝试候选上游主机，返回第一个成功的响应，
// 不依赖提前猜哪个域名当前可用。
//
// 用法：node scripts/live-proxy.mjs   （由 watchdog.sh 在赛事开启时拉起）
//
// 日志写到 /sdcard/Download/wdl-proxy.log，含：
//   - 每次 TCP 连接（来自哪个 IP）——用于判断二进制到底有没有连代理
//   - clientError（例如二进制用 https 打 HTTP 代理时的 TLS 错）——用于判断要不要换 HTTPS
//   - 每个请求尝试了哪些上游、最终拿到什么状态码

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';

const LISTEN_HOST = '127.0.0.1';
const LISTEN_PORT = Number(process.env.LIVE_PROXY_PORT || 18766);
const LOG = process.env.LIVE_PROXY_LOG || '/sdcard/Download/wdl-proxy.log';

// 候选上游主机（从二进制的硬编码列表 + 默认 OSS 桶提取）
const KGQ_HOST = 'pool-sg.oss-ap-southeast-1.aliyuncs.com';
const API_HOSTS = [
  'api.8kxv29.com', 'api.txxhuc.com', 'api.08zbidl.com', 'api.lav5041.com',
  'api.il8phx6.com', 'api.rqqakqyn.com', 'api.tezpgdzn.com', 'api.bmjb2mk7.com',
  'api.46d5umpk.com', 'api.tkfupxqu.com', 'api.5h5hbfhh.com', 'api.qchyzkww.com',
  'api.cjxxpgkq.com', 'api.zejzeu7p.com',
];

function log(line) {
  try {
    fs.appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`);
  } catch {
    /* 忽略日志写失败 */
  }
}

// 单次上游请求（带重定向跟随、超时）
function fetchUpstream(host, path, method, headers, body, depth = 0) {
  return new Promise((resolve, reject) => {
    if (depth > 4) return reject(new Error('too many redirects'));
    const target = `https://${host}${path}`;
    const outHeaders = { ...headers, host };
    for (const k of ['connection', 'transfer-encoding', 'keep-alive', 'proxy-connection', 'content-length']) {
      delete outHeaders[k];
    }
    const req = https.request(
      target,
      { method, headers: outHeaders, timeout: 8000 },
      (up) => {
        const status = up.statusCode || 0;
        if (status >= 300 && status < 400 && up.headers.location) {
          const loc = up.headers.location;
          up.resume();
          const u = new URL(loc, `https://${host}`);
          return resolve(fetchUpstream(u.host, u.pathname + u.search, method, headers, body, depth + 1));
        }
        const chunks = [];
        up.on('data', (c) => chunks.push(c));
        up.on('end', () => resolve({ status, headers: up.headers, body: Buffer.concat(chunks) }));
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (err) => reject(err));
    if (body) req.write(body);
    req.end();
  });
}

// 对一条入站请求，并发试所有候选主机，**第一个成功（2xx/3xx）立刻返回**，
// 不等超时的慢主机——二进制健康检查超时很短，拖延就会被判失败。
function tryUpstreams(path, method, headers, body) {
  const hosts = path.startsWith('/kgq/') ? [KGQ_HOST] : API_HOSTS;
  const t0 = Date.now();
  return new Promise((resolve) => {
    let remaining = hosts.length;
    let done = false;
    const errors = [];
    const finishAll = () => {
      if (done) return;
      done = true;
      log(`try ${method} ${path} -> ALL FAILED (${errors.join(',')}) ${Date.now() - t0}ms`);
      resolve({ status: 502, body: Buffer.from('all upstream failed: ' + errors.join(',')), headers: {} });
    };
    for (const h of hosts) {
      fetchUpstream(h, path, method, headers, body)
        .then((r) => {
          if (done) return;
          if (r.status >= 200 && r.status < 400) {
            done = true;
            log(`try ${method} ${path} -> ${h}:${r.status} (first win, ${Date.now() - t0}ms)`);
            if (path.includes('/domain/check') && r.body) {
              log(`  body[${h}] ${String(r.body).slice(0, 200).replace(/\s+/g, ' ')}`);
            }
            resolve({ host: h, ...r });
          } else {
            errors.push(`${h}:${r.status}`);
            if (--remaining === 0) finishAll();
          }
        })
        .catch(() => {
          if (done) return;
          errors.push(`${h}:ERR`);
          if (--remaining === 0) finishAll();
        });
    }
  });
}

const server = http.createServer(async (req, res) => {
  const skip = new Set(['connection', 'transfer-encoding', 'keep-alive', 'proxy-connection', 'host']);
  const fwdHeaders = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (skip.has(k.toLowerCase())) continue;
    fwdHeaders[k] = v;
  }
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    const body = chunks.length ? Buffer.concat(chunks) : null;
    try {
      const up = await tryUpstreams(req.url || '/', req.method, fwdHeaders, body);
      for (const [k, v] of Object.entries(up.headers || {})) {
        const lk = String(k).toLowerCase();
        if (skip.has(lk)) continue;
        try { res.setHeader(k, v); } catch { /* 个别头可能冲突，忽略 */ }
      }
      res.statusCode = up.status || 502;
      res.end(up.body || '');
    } catch (e) {
      res.statusCode = 502;
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.end(String(e));
    }
  });
});

// 连接级日志：判断二进制有没有真的连过来（http 模式），以及是不是用 https 打过来（TLS 错）
server.on('connection', (socket) => {
  log(`conn from ${socket.remoteAddress}:${socket.remotePort}`);
});
server.on('clientError', (err, socket) => {
  log(`clientError from ${socket.remoteAddress}: ${err && err.code} ${err && err.message}`);
  try { socket.destroy(); } catch { /* noop */ }
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  log(`proxy listening on ${LISTEN_HOST}:${LISTEN_PORT} (api hosts x${API_HOSTS.length} + ${KGQ_HOST})`);
});
