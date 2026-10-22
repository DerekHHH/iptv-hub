#!/usr/bin/env node
/**
 * @file QA 独立产物校验器（不属于工程师的 7 个测试文件）。
 *
 * 逐条断言 PRD §6 产物规范与设计 §8 共享约定，全部用真实字节/结构校验，
 * 不依赖工程师自己的测试断言。
 *
 * 用法：node tests/qa/check-artifacts.mjs [项目根目录]
 * 退出码：0 = 全通过；1 = 有失败项（失败项会逐条打印）。
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(process.argv[2] ?? join(HERE, '..', '..'));

/** 校验结果收集器。 */
const results = [];

/**
 * 记录一条检查结论。
 *
 * @param {string} name 检查项
 * @param {boolean} ok 是否通过
 * @param {string} detail 实际值/说明
 */
function check(name, ok, detail) {
  results.push({ name, ok, detail });
}

/** 读文件为 Buffer，缺失返回 null。 */
function readBuf(relPath) {
  const full = join(ROOT, relPath);
  if (!existsSync(full)) {
    return null;
  }
  return readFileSync(full);
}

/** 读文件为文本（utf8）。 */
function readText(relPath) {
  const buf = readBuf(relPath);
  return buf === null ? null : buf.toString('utf8');
}

/** 判断 Buffer 是否以 UTF-8 BOM 开头。 */
function hasBom(buf) {
  return buf !== null && buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
}

// ---------------------------------------------------------------- TXT
const txtBuf = readBuf('dist/txt/all.txt');
check('txt 文件存在', txtBuf !== null, txtBuf === null ? '缺失' : `${txtBuf.length} 字节`);
check('txt 无 BOM（前 3 字节）', !hasBom(txtBuf), txtBuf === null ? '-' : txtBuf.subarray(0, 3).toString('hex'));

const txtText = txtBuf === null ? '' : txtBuf.toString('utf8');
const crCount = (txtText.match(/\r/g) ?? []).length;
check('txt 无 CR（\\r 计数为 0）', crCount === 0, `\\r 出现 ${crCount} 次`);
check('txt 末尾恰好一个换行', txtText.endsWith('\n') && !txtText.endsWith('\n\n'), JSON.stringify(txtText.slice(-3)));

/** txt 解析结果（分组 → 频道行）。 */
const txtGroups = [];
let currentGroup = null;
for (const line of txtText.split('\n')) {
  if (line.length === 0) {
    continue;
  }
  const genreMatch = line.match(/^(.+),#genre#$/);
  if (genreMatch !== null) {
    currentGroup = { name: genreMatch[1], channels: [] };
    txtGroups.push(currentGroup);
    continue;
  }
  if (currentGroup === null) {
    txtGroups.push({ name: '(无分组头)', channels: [line] });
    continue;
  }
  currentGroup.channels.push(line);
}

const groupNames = txtGroups.map((group) => group.name);
// 分组体系已数据驱动（`data/groups.json`），这里不再硬编码分组名与顺序：
// 合法性 / 顺序 / 计数一致性统一放到下面读到 stats.json 之后按 `stats.groups` 的键守卫。

let badChannelLines = [];
let txtUrlCount = 0;
const txtChannelCount = txtGroups.reduce((sum, group) => sum + group.channels.length, 0);
for (const group of txtGroups) {
  for (const line of group.channels) {
    const commaIndex = line.indexOf(',');
    const name = commaIndex < 0 ? '' : line.slice(0, commaIndex);
    const urlField = commaIndex < 0 ? '' : line.slice(commaIndex + 1);
    const urls = urlField.split('#');
    const okStructure = commaIndex > 0 && urls.length > 0 && urls.every((url) => url.startsWith('http') && !/\s/.test(url));
    if (!okStructure) {
      badChannelLines.push(line.slice(0, 80));
    }
    txtUrlCount += urls.filter((url) => url.length > 0).length;
    if (name !== name.trim()) {
      badChannelLines.push(`频道名有首尾空白: ${line.slice(0, 40)}`);
    }
  }
}
check(
  'txt 行结构 = 频道名,http 开头且无空格的 url(#分隔)',
  badChannelLines.length === 0,
  badChannelLines.length === 0 ? `${txtChannelCount} 行全部合规` : `异常 ${badChannelLines.length} 行：${badChannelLines.slice(0, 3).join(' | ')}`,
);

// 上限跟着 src/config.ts 的 `SELECT.maxPerChannel` 走（check-config 里也钉了这个值）：
// 硬编码 3 会和配置里的 5 打架，变成"配置允许、护栏报错"的假红灯。
const configText = readText('src/config.ts') ?? '';
const maxPerChannelMatch = configText.match(/maxPerChannel:\s*(\d+)/);
const MAX_PER_CHANNEL = maxPerChannelMatch === null ? 3 : Number(maxPerChannelMatch[1]);

const perChannelOverLimit = [];
for (const group of txtGroups) {
  for (const line of group.channels) {
    const urlField = line.slice(line.indexOf(',') + 1);
    if (urlField.split('#').length > MAX_PER_CHANNEL) {
      perChannelOverLimit.push(line.slice(0, 60));
    }
  }
}
check(
  `txt 每频道源数 ≤ ${MAX_PER_CHANNEL}（SELECT.maxPerChannel）`,
  perChannelOverLimit.length === 0,
  perChannelOverLimit.length === 0 ? '全部合规' : perChannelOverLimit.slice(0, 3).join(' | '),
);

// ---------------------------------------------------------------- M3U
const m3uBuf = readBuf('dist/m3u/all.m3u');
check('m3u 文件存在', m3uBuf !== null, m3uBuf === null ? '缺失' : `${m3uBuf.length} 字节`);
check('m3u 无 BOM', !hasBom(m3uBuf), m3uBuf === null ? '-' : m3uBuf.subarray(0, 3).toString('hex'));

const m3uText = m3uBuf === null ? '' : m3uBuf.toString('utf8');
const m3uLines = m3uText.split('\n');
check('m3u 首行恰好是 #EXTM3U', m3uLines[0] === '#EXTM3U', JSON.stringify(m3uLines[0]));
const m3uCr = (m3uText.match(/\r/g) ?? []).length;
check('m3u 无 CR', m3uCr === 0, `\\r 出现 ${m3uCr} 次`);

const extinfLines = m3uLines.filter((line) => line.startsWith('#EXTINF'));
const urlLines = m3uLines.filter((line) => line.length > 0 && !line.startsWith('#'));
const extinfMissingAttrs = extinfLines.filter((line) => {
  return !(/tvg-id="[^"]*"/.test(line) && /tvg-name="[^"]*"/.test(line) && /group-title="[^"]*"/.test(line));
});
check('m3u 每条 #EXTINF 含 tvg-id/tvg-name/group-title', extinfMissingAttrs.length === 0, extinfMissingAttrs.length === 0 ? `${extinfLines.length} 条全部齐全` : extinfMissingAttrs.slice(0, 2).join(' | '));
check('m3u #EXTINF 行数 == URL 行数', extinfLines.length === urlLines.length, `EXTINF ${extinfLines.length} / URL ${urlLines.length}`);
check('m3u URL 行全部 http 开头且无空格', urlLines.every((line) => line.startsWith('http') && !/\s/.test(line)), `共 ${urlLines.length} 条`);

/** tvg-id → 出现次数。 */
const tvgIdCount = new Map();
for (const line of extinfLines) {
  const idMatch = line.match(/tvg-id="([^"]*)"/);
  const id = idMatch === null ? '(缺失)' : idMatch[1];
  tvgIdCount.set(id, (tvgIdCount.get(id) ?? 0) + 1);
}
const overLimit = [...tvgIdCount.entries()].filter(([, count]) => count > MAX_PER_CHANNEL);
check(
  `m3u 同一 tvg-id 记录数 ≤ ${MAX_PER_CHANNEL}（SELECT.maxPerChannel）`,
  overLimit.length === 0,
  overLimit.length === 0 ? `${tvgIdCount.size} 个 tvg-id 全部合规` : JSON.stringify(overLimit),
);

// ---------------------------------------------------------------- EPG
const epgText = readText('dist/epg/epg.xml');
check('epg 文件存在', epgText !== null, epgText === null ? '缺失' : `${Buffer.byteLength(epgText, 'utf8')} 字节`);

/**
 * 极简严格 XML 良构校验：标签栈配对 + 属性引号闭合。
 *
 * @param {string} xml XML 文本
 * @returns {{ok: boolean, error?: string}}
 */
function checkXmlWellFormed(xml) {
  const stack = [];
  const tokenPattern = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[A-Za-z_][\w.:-]*\s*=\s*"[^"]*")*)\s*(\/?)>|<\?[\s\S]*?\?>|<!--[\s\S]*?-->/g;
  let match = tokenPattern.exec(xml);
  let consumed = 0;
  while (match !== null) {
    const between = xml.slice(consumed, match.index);
    if (between.includes('<')) {
      return { ok: false, error: `未识别的标签片段: ${between.slice(0, 40)}` };
    }
    consumed = match.index + match[0].length;
    const [raw, closing, tag, , selfClosing] = match;
    if (raw.startsWith('<?') || raw.startsWith('<!--')) {
      match = tokenPattern.exec(xml);
      continue;
    }
    if (closing === '/') {
      const top = stack.pop();
      if (top !== tag) {
        return { ok: false, error: `闭合标签不匹配：</${tag}> 对应 <${top ?? '空'}>` };
      }
    } else if (selfClosing !== '/') {
      stack.push(tag);
    }
    match = tokenPattern.exec(xml);
  }
  const tail = xml.slice(consumed);
  if (tail.includes('<')) {
    return { ok: false, error: `结尾有未识别片段: ${tail.slice(0, 40)}` };
  }
  if (stack.length !== 0) {
    return { ok: false, error: `标签未闭合：${stack.join(',')}` };
  }
  return { ok: true };
}

const xmlCheck = epgText === null ? { ok: false, error: '文件缺失' } : checkXmlWellFormed(epgText);
check('epg 是良构 XML（标签严格配对）', xmlCheck.ok, xmlCheck.ok === true ? 'XML 良构' : `失败：${xmlCheck.error}`);

const epgBom = epgText !== null && epgText.charCodeAt(0) === 0xfeff;
check('epg 无 BOM', !epgBom, epgBom ? '有 BOM' : '无 BOM');
check('epg 有 <tv> 根节点', epgText !== null && /<tv[\s>]/.test(epgText), epgText === null ? '-' : (epgText.match(/<tv[^>]*>/) ?? ['(无)'])[0].slice(0, 80));

const epgChannelIds = [...(epgText ?? '').matchAll(/<channel\s+id="([^"]*)"/g)].map((item) => item[1]);
const epgDisplayNames = [...(epgText ?? '').matchAll(/<display-name>([\s\S]*?)<\/display-name>/g)].map((item) => item[1]);
check('epg 含 <channel id>', epgChannelIds.length > 0, `${epgChannelIds.length} 个频道`);
check('epg 每个 channel 有 display-name', epgDisplayNames.length === epgChannelIds.length, `channel ${epgChannelIds.length} / display-name ${epgDisplayNames.length}`);

const epgIdSet = new Set(epgChannelIds);
const missingInEpg = [...tvgIdCount.keys()].filter((id) => !epgIdSet.has(id));
const matchRate = tvgIdCount.size === 0 ? 0 : (tvgIdCount.size - missingInEpg.length) / tvgIdCount.size;
check(
  'M3U tvg-id 全部能在 EPG <channel id> 找到',
  missingInEpg.length === 0,
  `匹配率 ${(matchRate * 100).toFixed(1)}%（${tvgIdCount.size - missingInEpg.length}/${tvgIdCount.size}），未匹配 ${missingInEpg.length} 个：${JSON.stringify(missingInEpg.slice(0, 5))}`,
);

// ---------------------------------------------------------------- stats.json
const statsText = readText('dist/stats.json');
let stats = null;
try {
  stats = JSON.parse(statsText ?? 'null');
} catch {
  stats = null;
}
check('stats.json 可解析', stats !== null && typeof stats === 'object', stats === null ? '解析失败' : 'OK');

if (stats !== null) {
  const schema = {
    version: 'number',
    updated_at: 'string',
    channel_count: 'number',
    source_count: 'number',
    groups: 'object',
    upstream: 'object',
    fetch_fail_rate: 'number',
    probe: 'object',
    epg: 'object',
    build_duration_ms: 'number',
    stale: 'boolean',
  };
  const schemaProblems = [];
  for (const [key, type] of Object.entries(schema)) {
    if (!(key in stats)) {
      schemaProblems.push(`${key} 缺失`);
    } else if (typeof stats[key] !== type) {
      schemaProblems.push(`${key} 类型 ${typeof stats[key]} != ${type}`);
    }
  }
  for (const key of ['total', 'alive', 'dead', 'timeout', 'skipped', 'duration_ms']) {
    if (typeof stats.probe?.[key] !== 'number') {
      schemaProblems.push(`probe.${key} 缺失`);
    }
  }
  for (const key of ['ok', 'programmes']) {
    if (stats.epg === undefined || (key === 'ok' ? typeof stats.epg.ok !== 'boolean' : typeof stats.epg[key] !== 'number')) {
      schemaProblems.push(`epg.${key} 缺失/类型错`);
    }
  }
  const groupValues = Object.values(stats.groups ?? {});
  if (groupValues.length === 0 || !groupValues.every((value) => typeof value === 'number')) {
    schemaProblems.push('groups 缺失或含非数字值');
  }
  if (typeof stats.groups?.['其他'] !== 'number') {
    schemaProblems.push('groups.其他 缺失');
  }
  check('stats 符合 BuildStats schema（含 version:1/stale/epg/probe）', schemaProblems.length === 0, schemaProblems.length === 0 ? '全部字段齐备' : schemaProblems.join('; '));
  check('stats.version === 1', stats.version === 1, String(stats.version));

  const isoOk = typeof stats.updated_at === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/.test(stats.updated_at);
  check('stats.updated_at 是 +08:00 ISO 格式', isoOk, String(stats.updated_at));

  const parsedMs = Date.parse(stats.updated_at ?? '');
  const driftHours = Number.isFinite(parsedMs) ? Math.abs(Date.now() - parsedMs) / 3600000 : Number.NaN;
  check(
    'stats.updated_at 与本机时间差 < 7 小时',
    Number.isFinite(driftHours) && driftHours < 7,
    Number.isFinite(driftHours) ? `相差 ${driftHours.toFixed(2)} 小时` : '无法解析',
  );

  const sensitive = ['ghp_', 'github_pat_', 'Bearer ', '"token"', 'access_token'];
  const foundSensitive = sensitive.filter((needle) => (statsText ?? '').includes(needle));
  check('stats.json 无敏感串', foundSensitive.length === 0, foundSensitive.length === 0 ? '干净' : JSON.stringify(foundSensitive));
}

// ---------------------------------------------------------------- 数据自洽（任务 D）
if (stats !== null) {
  const probeSum = (stats.probe?.alive ?? 0) + (stats.probe?.dead ?? 0) + (stats.probe?.timeout ?? 0) + (stats.probe?.skipped ?? 0);
  check('probe.alive+dead+timeout+skipped == probe.total', probeSum === stats.probe?.total, `${probeSum} vs ${stats.probe?.total}`);
  check('probe.alive ≤ probe.total', (stats.probe?.alive ?? 0) <= (stats.probe?.total ?? 0), `${stats.probe?.alive} ≤ ${stats.probe?.total}`);
  check('stats.channel_count == txt 频道行数', stats.channel_count === txtChannelCount, `stats ${stats.channel_count} vs txt ${txtChannelCount}`);
  check('stats.source_count == txt 中 url 总数', stats.source_count === txtUrlCount, `stats ${stats.source_count} vs txt ${txtUrlCount}`);
  check('stats.source_count == m3u URL 行数', stats.source_count === urlLines.length, `stats ${stats.source_count} vs m3u ${urlLines.length}`);
  // 分组体系数据驱动：守「txt 里的分组名 ⊆ stats.groups 的键，且顺序与键序一致」，
  // 比硬编码分组名更健壮（管理后台可以在运行时新增分组）。
  const statsGroupKeys = Object.keys(stats.groups ?? {});
  check(
    'txt 分组名全部出现在 stats.groups 中',
    groupNames.every((name) => statsGroupKeys.includes(name)),
    JSON.stringify(groupNames),
  );
  const orderedNames = statsGroupKeys.filter((key) => groupNames.includes(key));
  check(
    'txt 分组顺序与 stats.groups 键序一致',
    JSON.stringify(groupNames) === JSON.stringify(orderedNames),
    `实际 ${JSON.stringify(groupNames)} / 期望 ${JSON.stringify(orderedNames)}`,
  );
  const groupSum = statsGroupKeys.reduce((sum, key) => sum + (stats.groups?.[key] ?? 0), 0);
  check('groups 各项之和 == channel_count', groupSum === stats.channel_count, `${groupSum} vs ${stats.channel_count}`);
  const txtGroupActual = Object.fromEntries(txtGroups.map((group) => [group.name, group.channels.length]));
  const groupMismatch = statsGroupKeys.filter((key) => (stats.groups?.[key] ?? 0) !== (txtGroupActual[key] ?? 0));
  check(
    'stats.groups 与 txt 实际分组计数一致',
    groupMismatch.length === 0,
    groupMismatch.length === 0 ? JSON.stringify(txtGroupActual) : `不一致: ${groupMismatch.map((key) => `${key}(stats ${stats.groups[key]} / txt ${txtGroupActual[key] ?? 0})`).join(', ')}`,
  );
  if (typeof stats.fetch_fail_rate === 'number' && Array.isArray(stats.upstream)) {
    const failed = stats.upstream.filter((item) => item.ok !== true).length;
    const expectedRate = stats.upstream.length === 0 ? 1 : failed / stats.upstream.length;
    check('fetch_fail_rate 与 upstream.ok 计数自洽', Math.abs(expectedRate - stats.fetch_fail_rate) < 0.0002, `upstream 失败 ${failed}/${stats.upstream.length} → ${expectedRate.toFixed(4)} vs stats ${stats.fetch_fail_rate}`);
  }
  check(
    'stats.hidden_count 是非负整数（缺失也算通过，老产物没有这个字段）',
    stats.hidden_count === undefined || (Number.isInteger(stats.hidden_count) && stats.hidden_count >= 0),
    String(stats.hidden_count),
  );
  const otherCount = stats.groups?.['其他'] ?? 0;
  check(
    '「其他」占比 < 50%（分组关键字明显失效时会飙到 90%+）',
    stats.channel_count === 0 || otherCount / stats.channel_count < 0.5,
    `${otherCount}/${stats.channel_count} = ${(stats.channel_count === 0 ? 0 : (otherCount / stats.channel_count) * 100).toFixed(1)}%`,
  );
}

// ---------------------------------------------------------------- channels.json（频道浏览页的数据源）
const channelsText = readText('dist/channels.json');
if (channelsText === null) {
  check('channels.json 存在', false, '缺失');
} else {
  check('channels.json 存在', true, `${Buffer.byteLength(channelsText, 'utf8')} 字节`);
  let channelsFile = null;
  try {
    channelsFile = JSON.parse(channelsText);
  } catch (error) {
    check('channels.json 可解析', false, String(error.message));
  }
  if (channelsFile !== null) {
    check('channels.json 可解析', true, 'OK');
    const entries = channelsFile.channels;
    check('channels.json channels 是数组且非空', Array.isArray(entries) && entries.length > 0, `${Array.isArray(entries) ? entries.length : '(非数组)'} 条`);
    check(
      'channels.json channel_count == stats.channel_count',
      Array.isArray(entries) && stats !== null && entries.length === stats.channel_count,
      `${Array.isArray(entries) ? entries.length : '-'} vs ${stats?.channel_count ?? '-'}`,
    );
    check('channels.json updated_at 与 stats 一致', channelsFile.updated_at === stats?.updated_at, `${channelsFile.updated_at} vs ${stats?.updated_at}`);
    const badEntries = (Array.isArray(entries) ? entries : []).filter(
      (item) =>
        typeof item?.id !== 'string' ||
        typeof item?.name !== 'string' ||
        typeof item?.group !== 'string' ||
        !Array.isArray(item?.streams) ||
        item.streams.length === 0 ||
        !item.streams.every((url) => typeof url === 'string' && url.startsWith('http')),
    );
    check('channels.json 每条都是 {id,name,group,streams[url]} 且 url 是 http', badEntries.length === 0, badEntries.length === 0 ? '全部合规' : JSON.stringify(badEntries.slice(0, 2)));
    // 分组数（含 0）与「只列 >0 的分组」两者都要和 stats 对得上
    const fileGroups = Array.isArray(channelsFile.groups) ? channelsFile.groups : [];
    const nonZeroStatsGroups = Object.keys(stats?.groups ?? {}).filter((key) => (stats.groups[key] ?? 0) > 0);
    check(
      'channels.json groups 只列 count>0 的分组且与 stats 一致',
      fileGroups.length === nonZeroStatsGroups.length &&
        fileGroups.every((item) => (stats?.groups?.[item.name] ?? -1) === item.count),
      JSON.stringify(fileGroups.map((item) => `${item.name}:${item.count}`)),
    );
    const urlMismatch = (Array.isArray(entries) ? entries : []).filter((item) => !Array.isArray(item?.streams) || item.streams.length > MAX_PER_CHANNEL);
    check(`channels.json 每台源数 ≤ ${MAX_PER_CHANNEL}`, urlMismatch.length === 0, urlMismatch.length === 0 ? '全部合规' : JSON.stringify(urlMismatch.slice(0, 2).map((item) => item.id)));
    // 分组的先后顺序必须按 data/groups.json 的 order 走
    const orderMatch = JSON.parse(readText('data/groups.json') ?? '{"order":[]}').order ?? [];
    const expectOrder = orderMatch.filter((name) => nonZeroStatsGroups.includes(name));
    check(
      'channels.json groups 顺序 = data/groups.json order',
      JSON.stringify(fileGroups.map((item) => item.name)) === JSON.stringify(expectOrder),
      `${JSON.stringify(fileGroups.map((item) => item.name))} vs ${JSON.stringify(expectOrder)}`,
    );
  }
}

// ---------------------------------------------------------------- pages-out
const indexHtml = readText('pages-out/index.html');
check('pages-out/index.html 存在', indexHtml !== null, indexHtml === null ? '缺失' : `${Buffer.byteLength(indexHtml, 'utf8')} 字节`);
if (indexHtml !== null) {
  const assetRefs = [...indexHtml.matchAll(/(?:src|href)="([^"]+)"/g)].map((item) => item[1]).filter((href) => !href.startsWith('data:') && !href.startsWith('#'));
  check('pages-out 资源引用全部相对路径 ./assets/...', assetRefs.every((href) => href.startsWith('./')), JSON.stringify(assetRefs));
  check('pages-out 无 /assets/ 绝对路径', !assetRefs.some((href) => href.startsWith('/')), JSON.stringify(assetRefs));
}
for (const rel of [
  'pages-out/txt/all.txt',
  'pages-out/m3u/all.m3u',
  'pages-out/epg/epg.xml',
  'pages-out/stats.json',
  'pages-out/channels.json',
  'pages-out/player-assets/hls.min.js',
]) {
  check(`${rel} 存在`, existsSync(join(ROOT, rel)), existsSync(join(ROOT, rel)) ? `${statSync(join(ROOT, rel)).size} 字节` : '缺失');
}
const pagesTxt = readText('pages-out/txt/all.txt');
check('pages-out 的 txt 与 dist 一致', pagesTxt !== null && pagesTxt === txtText, pagesTxt === txtText ? '内容相同' : '内容不同');

// ---------------------------------------------------------------- 汇总
let failed = 0;
for (const item of results) {
  if (!item.ok) {
    failed += 1;
  }
  console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}  →  ${item.detail}`);
}
console.log(`\n合计 ${results.length} 项，通过 ${results.length - failed}，失败 ${failed}`);
process.exitCode = failed === 0 ? 0 : 1;
