#!/usr/bin/env node
/**
 * @file 把网页产物与数据产物装配成一个可直接发布的 Pages 目录。
 *
 * 输入：`site/`（Vite 输出）+ `dist/{txt,m3u,epg}` + `dist/stats.json`
 * 输出：`pages-out/`（平铺结构）
 *   pages-out/index.html
 *   pages-out/assets/...
 *   pages-out/txt/all.txt
 *   pages-out/m3u/all.m3u
 *   pages-out/epg/epg.xml
 *   pages-out/stats.json
 *
 * 三方产物互不覆盖：`emptyOutDir` 只清 `site/`，本脚本只清 `pages-out/`。
 */

import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const SITE_DIR = join(ROOT, 'site');
const DIST_DIR = join(ROOT, 'dist');
const OUT_DIR = join(ROOT, 'pages-out');

/** 数据产物清单：源路径 → 目标路径（相对 pages-out）。 */
const DATA_ITEMS = [
  { from: join(DIST_DIR, 'txt'), to: join(OUT_DIR, 'txt'), label: 'txt/' },
  { from: join(DIST_DIR, 'm3u'), to: join(OUT_DIR, 'm3u'), label: 'm3u/' },
  { from: join(DIST_DIR, 'epg'), to: join(OUT_DIR, 'epg'), label: 'epg/' },
  { from: join(DIST_DIR, 'nba'), to: join(OUT_DIR, 'nba'), label: 'nba/' },
  { from: join(DIST_DIR, 'stats.json'), to: join(OUT_DIR, 'stats.json'), label: 'stats.json' },
  // 可选：历史趋势（首页折线/表格用），不存在时自动跳过
  { from: join(ROOT, 'data', 'history.json'), to: join(OUT_DIR, 'history.json'), label: 'history.json' },
];

/**
 * 判断路径是否存在。
 *
 * @param {string} target 路径
 * @returns {Promise<boolean>} 是否存在
 */
async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * 主流程。
 */
async function main() {
  if (!existsSync(SITE_DIR)) {
    console.error('[assemble] 缺少 site/ 目录：请先运行 npm run web:build');
    process.exitCode = 1;
    return;
  }
  if (!existsSync(join(SITE_DIR, 'index.html'))) {
    console.error('[assemble] site/index.html 不存在：网页构建似乎失败了');
    process.exitCode = 1;
    return;
  }

  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  await cp(SITE_DIR, OUT_DIR, { recursive: true });
  console.log('[assemble] 已复制 site/ → pages-out/');

  for (const item of DATA_ITEMS) {
    if (!(await exists(item.from))) {
      console.warn(`[assemble] 跳过缺失的数据产物：${item.label}`);
      continue;
    }
    await cp(item.from, item.to, { recursive: true });
    console.log(`[assemble] 已复制 ${item.label} → pages-out/${item.label}`);
  }

  console.log('[assemble] 完成，pages-out/ 可直接发布到 GitHub Pages');
}

await main();
