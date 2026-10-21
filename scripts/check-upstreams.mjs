#!/usr/bin/env node
/**
 * @file 上游自检脚本：逐个抓取 `src/config.ts` 里声明的 UPSTREAMS，打印可用性表格。
 *
 * 用法：npm run check:upstreams  （等价 node scripts/check-upstreams.mjs）
 * 退出码：0 = 至少一个上游可用；1 = 任意上游 raw 与 jsDelivr **双通道全失败**。
 *
 * 为什么要单独一个脚本：`npm run build` 会先抓取、再花十几分钟测活，
 * "源挂了" 和 "源里的地址都死了" 在 build 日志里容易混淆。这个脚本只回答一个问题：
 * **上游本身还活着吗？还能解析出多少条目？**
 *
 * 说明：本脚本用纯 node 运行（不依赖 tsx），因此从 `src/config.ts` 里用正则读取上游
 * 定义（配置中心的字段顺序即契约：name / label / rawUrl / jsdelivrUrl / format / fixture），
 * 条目数用与解析层同口径的轻量计数（M3U 数地址行、TXT 数带地址的频道行）。
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const CONFIG_PATH = resolve(ROOT, 'src', 'config.ts');

/** 单次请求超时（毫秒）——比构建期 8s 宽松一点，自检要的是"到底通不通"。 */
const TIMEOUT_MS = 15000;

/** User-Agent 与构建期保持一致，方便上游日志对照。 */
const USER_AGENT = 'IPTVHub/1.0 (+https://github.com)';

/**
 * 从 config.ts 里抽取 UPSTREAMS 定义。
 *
 * @return {{name: string, label: string, rawUrl: string, jsdelivrUrl: string, format: string}[]}
 */
function readUpstreams() {
  const text = readFileSync(CONFIG_PATH, 'utf8');
  const start = text.indexOf('export const UPSTREAMS');
  const end = text.indexOf('export const EPG_SOURCES');
  if (start < 0 || end <= start) {
    throw new Error('无法在 src/config.ts 中定位 UPSTREAMS 定义');
  }
  const block = text.slice(start, end);
  const pattern =
    /name:\s*'([^']+)'[\s\S]*?label:\s*'([^']+)'[\s\S]*?rawUrl:\s*'([^']+)'[\s\S]*?jsdelivrUrl:\s*'([^']+)'[\s\S]*?format:\s*'([^']+)'/g;
  const upstreams = [];
  let match = pattern.exec(block);
  while (match !== null) {
    upstreams.push({
      name: match[1],
      label: match[2],
      rawUrl: match[3],
      jsdelivrUrl: match[4],
      format: match[5],
    });
    match = pattern.exec(block);
  }
  if (upstreams.length === 0) {
    throw new Error('UPSTREAMS 解析出 0 条，请检查 config.ts 的字段顺序');
  }
  return upstreams;
}

/**
 * 判断一行是否播放地址。
 *
 * @param {string} line 行文本
 * @return {boolean}
 */
function looksLikeUrl(line) {
  return /^(https?|rtmp|rtsp|rtp|udp|p3p|p2p|mms):\/\//i.test(line.trim());
}

/**
 * 与解析层同口径的轻量条目计数。
 *
 * @param {string} text 文档内容
 * @param {'m3u'|'txt'} format 格式
 * @return {number} 条目数
 */
function countEntries(text, format) {
  const body = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = body.split('\n').map((line) => line.trim());
  let count = 0;

  if (format === 'm3u' || /#EXTM3U|#EXTINF/i.test(body.slice(0, 4096))) {
    let pending = false;
    for (const line of lines) {
      if (line.startsWith('#EXTINF:')) {
        pending = true;
        continue;
      }
      if (line.length === 0 || line.startsWith('#')) {
        continue;
      }
      if (pending && looksLikeUrl(line)) {
        // 一行可能挂多个地址（`url1#url2`），与 splitUrlField 口径一致
        count += line.split('#').filter((piece) => looksLikeUrl(piece)).length;
        pending = false;
      }
    }
    return count;
  }

  for (const line of lines) {
    if (line.length === 0 || line.startsWith('#')) {
      continue;
    }
    const commaIndex = line.indexOf(',');
    const urlField = commaIndex < 0 ? line : line.slice(commaIndex + 1);
    count += urlField.split('#').filter((piece) => looksLikeUrl(piece)).length;
  }
  return count;
}

/**
 * 抓一个通道。
 *
 * @param {string} url 地址
 * @param {string} format 格式
 * @return {Promise<{ok: boolean, status: number|string, bytes: number, items: number, ms: number}>}
 */
async function probeChannel(url, format) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT, Accept: '*/*' },
    });
    const text = await response.text();
    const ms = Date.now() - startedAt;
    const items = response.ok ? countEntries(text, format) : 0;
    return {
      ok: response.ok && items > 0,
      status: response.status,
      bytes: Buffer.byteLength(text, 'utf8'),
      items,
      ms,
    };
  } catch (error) {
    return {
      ok: false,
      status: error instanceof Error ? error.name : 'Error',
      bytes: 0,
      items: 0,
      ms: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 右对齐填充（不用 padStart 之外的表格库，保持零依赖）。
 *
 * @param {string|number} value 值
 * @param {number} width 宽度
 * @return {string}
 */
function pad(value, width) {
  const text = String(value);
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

/**
 * 主流程。
 */
async function main() {
  const upstreams = readUpstreams();
  console.log(`上游自检：共 ${upstreams.length} 个（raw 优先，失败再走 jsDelivr）\n`);
  console.log(
    `${pad('name', 20)}| ${pad('通道', 10)}| ${pad('HTTP', 8)}| ${pad('字节数', 10)}| ${pad('解析条目数', 12)}| 耗时ms`,
  );
  console.log('-'.repeat(84));

  const summary = [];
  for (const upstream of upstreams) {
    let result = await probeChannel(upstream.rawUrl, upstream.format);
    let channel = 'raw';
    if (!result.ok) {
      const fallback = await probeChannel(upstream.jsdelivrUrl, upstream.format);
      if (fallback.ok) {
        result = fallback;
        channel = 'jsdelivr';
      } else {
        channel = 'raw+jsdelivr';
        result = {
          ok: false,
          status: `${result.status}/${fallback.status}`,
          bytes: 0,
          items: 0,
          ms: result.ms + fallback.ms,
        };
      }
    }
    console.log(
      `${pad(upstream.name, 20)}| ${pad(channel, 10)}| ${pad(result.status, 8)}| ${pad(result.bytes, 10)}| ${pad(result.items, 12)}| ${result.ms}`,
    );
    summary.push({ name: upstream.name, ok: result.ok, items: result.items });
  }

  const okCount = summary.filter((item) => item.ok).length;
  const rate = upstreams.length === 0 ? 0 : okCount / upstreams.length;
  console.log('-'.repeat(84));
  console.log(
    `成功率：${okCount}/${upstreams.length}（${(rate * 100).toFixed(0)}%），总条目数 ${summary.reduce(
      (total, item) => total + item.items,
      0,
    )}`,
  );

  if (okCount < upstreams.length) {
    const failed = summary.filter((item) => !item.ok).map((item) => item.name);
    console.log(`失败上游：${failed.join(', ')}`);
  }

  // 任意上游全失败即判失败（CI 里应当直接飘红，而不是等 17 分钟测活完才发现没源）
  const allFailed = okCount === 0;
  process.exitCode = allFailed ? 1 : 0;
  if (allFailed) {
    console.error('所有上游均不可用，构建将进入 stale 降级');
  }
}

await main();
