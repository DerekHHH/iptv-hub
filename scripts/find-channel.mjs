/**
 * @file iptv-org 全量频道检索工具。
 *
 * iptv-org 网页上的 `N feeds` 是节目单标识，不代表有播放源；真正的源在 `streams.json`。
 * 这个脚本把 `channels.json` + `streams.json` 拉到本地缓存，按关键词检索并直接标出有无源。
 *
 * 用法：
 *   npm run find -- nba
 *   npm run find -- 美国 espn
 *   npm run find -- "league pass" --all      # 连没有源的频道一起看
 *   npm run find -- yes --refresh            # 强制重新下载数据
 *
 * 数据本地缓存 24 小时，第二次起秒出。
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const API = 'https://iptv-org.github.io/api';
const CACHE_DIR = '.tmp/iptv-org-cache';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** 缓存文件与远程路径的对应关系。 */
const FILES = [
  { key: 'channels', path: '/channels.json' },
  { key: 'streams', path: '/streams.json' },
  { key: 'countries', path: '/countries.json' },
];

const argv = process.argv.slice(2);
const showAll = argv.includes('--all');
const refresh = argv.includes('--refresh');
const keywords = argv.filter((arg) => !arg.startsWith('--')).map((arg) => arg.toLowerCase());

if (keywords.length === 0) {
  console.log('用法: npm run find -- <关键词> [更多关键词] [--all] [--refresh]');
  process.exit(1);
}

/**
 * 下载文件到缓存目录；已缓存且未过期则直接复用。
 *
 * 为什么用 curl 而不是 fetch：国内直连 iptv-org.github.io 经常握手超时，
 * Node 内置 fetch 的连接超时只有 10 秒，curl 可以配更长超时与重试。
 *
 * @param name 远程文件名（不含 json 后缀）
 * @param remotePath 远程路径
 * @return 本地缓存路径
 */
function ensureCached(name, remotePath) {
  mkdirSync(CACHE_DIR, { recursive: true });
  const local = join(CACHE_DIR, `${name}.json`);
  const fresh = existsSync(local) && Date.now() - statSync(local).mtimeMs < CACHE_TTL_MS;
  if (fresh && !refresh) {
    return local;
  }
  console.log(`下载 ${remotePath} ...`);
  execFileSync(
    'curl.exe',
    ['-sSL', '--max-time', '180', '--retry', '3', '--retry-all-errors', '-o', local, `${API}${remotePath}`],
    { stdio: 'inherit' },
  );
  return local;
}

const channels = JSON.parse(readFileSync(ensureCached('channels', '/channels.json'), 'utf8'));
const streams = JSON.parse(readFileSync(ensureCached('streams', '/streams.json'), 'utf8'));
const countries = JSON.parse(readFileSync(ensureCached('countries', '/countries.json'), 'utf8'));

const countryName = new Map(countries.map((c) => [c.code, c.name]));
const streamsByChannel = new Map();
for (const stream of streams) {
  if (!streamsByChannel.has(stream.channel)) {
    streamsByChannel.set(stream.channel, []);
  }
  streamsByChannel.get(stream.channel).push(stream);
}

/** 每个关键词都必须命中「名称 / id / 国家名」之一（多关键词是 AND 关系）。 */
function matches(channel) {
  const country = countryName.get(channel.country) ?? '';
  const haystack = `${channel.name} ${channel.id} ${country}`.toLowerCase();
  return keywords.every((keyword) => haystack.includes(keyword));
}

/**
 * 相关度打分：`nba` 这种短词会命中 Donbass、Offenbach，所以按命中位置排序，
 * 词首/整词优先，避免真正想要的台被噪音淹没。
 *
 * @param channel 频道
 * @return 分数，越小越相关
 */
function score(channel) {
  const fields = [channel.id.toLowerCase(), channel.name.toLowerCase()];
  let best = 3;
  for (const keyword of keywords) {
    let fieldScore = 3;
    for (const field of fields) {
      if (field === keyword) {
        fieldScore = Math.min(fieldScore, 0);
      } else if (field.startsWith(keyword)) {
        fieldScore = Math.min(fieldScore, 1);
      } else if (new RegExp(`(^|[^a-z0-9])${keyword}`).test(field)) {
        fieldScore = Math.min(fieldScore, 2);
      }
    }
    best = Math.min(best, fieldScore);
  }
  return best;
}

const matched = channels
  .filter(matches)
  .map((channel) => ({ channel, rank: score(channel) }))
  .sort((left, right) => {
    if (left.rank !== right.rank) return left.rank - right.rank;
    const leftStreams = (streamsByChannel.get(left.channel.id) ?? []).length;
    const rightStreams = (streamsByChannel.get(right.channel.id) ?? []).length;
    if ((leftStreams > 0) !== (rightStreams > 0)) return leftStreams > 0 ? -1 : 1;
    return left.channel.name.localeCompare(right.channel.name);
  })
  .map((item) => item.channel);

const withStream = matched.filter((channel) => (streamsByChannel.get(channel.id) ?? []).length > 0);
const withoutStream = matched.filter((channel) => (streamsByChannel.get(channel.id) ?? []).length === 0);

/** 单次最多展示条数，避免关键词太宽时刷屏。 */
const MAX_ROWS = 40;

console.log(`\n命中 ${matched.length} 个频道：有源 ${withStream.length} 个，无源 ${withoutStream.length} 个\n`);

const pad = (text, width) => String(text).padEnd(width);

for (const channel of withStream.slice(0, MAX_ROWS)) {
  const list = streamsByChannel.get(channel.id) ?? [];
  const country = countryName.get(channel.country) ?? channel.country ?? '??';
  console.log(`✓ ${pad(channel.id, 28)} ${pad(channel.name, 30)} ${country}  源=${list.length}`);
  for (const stream of list.slice(0, 3)) {
    console.log(`    ${stream.url}`);
  }
  if (list.length > 3) {
    console.log(`    ...另有 ${list.length - 3} 个源`);
  }
}
if (withStream.length > MAX_ROWS) {
  console.log(`\n有源频道还有 ${withStream.length - MAX_ROWS} 个未展示，请加更具体的关键词`);
}

if (showAll) {
  console.log(`\n—— 无源频道（--all 展示）——`);
  for (const channel of withoutStream.slice(0, MAX_ROWS)) {
    const country = countryName.get(channel.country) ?? channel.country ?? '??';
    console.log(`✗ ${pad(channel.id, 28)} ${pad(channel.name, 30)} ${country}`);
  }
} else if (withoutStream.length > 0) {
  console.log(`\n另有 ${withoutStream.length} 个无源频道未展示，加 --all 查看`);
}
