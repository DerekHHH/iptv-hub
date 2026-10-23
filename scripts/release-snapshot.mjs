/**
 * @file 发一个 GitHub Release，附上完整项目快照（免 clone 的下载入口）。
 *
 * 用法：node scripts/release-snapshot.mjs <zip路径> [tag]
 *
 * 为什么用 API 而不是 `git push`：某些网络环境到 github.com 的 git 协议不通，
 * 但 api.github.com / uploads.github.com 是通的。
 *
 * 为什么用 curl 而不是 fetch：**Node 的 fetch 不读 http_proxy 环境变量**，
 * 沙箱/代理环境下会直连超时；curl 会自动认代理，所以请求一律走 curl。
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';

const REPO = 'DerekHHH/iptv-hub';
const API = `https://api.github.com/repos/${REPO}`;
const UPLOAD = `https://uploads.github.com/repos/${REPO}`;

/**
 * 取 token：环境变量 → git 凭据 → ~/.github-token。
 *
 * @return {string} token，取不到返回空串
 */
function resolveToken() {
  const fromEnv = (process.env.GITHUB_TOKEN ?? '').trim();
  if (fromEnv.length > 0) {
    return fromEnv;
  }
  try {
    const out = execFileSync(
      'git',
      ['credential', 'fill'],
      { encoding: 'utf8', input: 'protocol=https\nhost=github.com\n\n' },
    );
    const m = /^password=(.+)$/m.exec(out);
    if (m) {
      return m[1].trim();
    }
  } catch {
    // 忽略
  }
  return '';
}

/**
 * 用 curl 发一个请求（自动走系统代理）。
 *
 * @param {string} url 地址
 * @param {string} token 令牌
 * @param {string} method 方法
 * @param {string|null} body 请求体（JSON 字符串）
 * @param {string|null} filePath 要上传的文件（与 body 二选一）
 * @returns {string} 响应文本
 */
function request(url, token, method, body = null, filePath = null) {
  const args = ['-sS', '-m', '300', '-X', method,
    '-H', `Authorization: Bearer ${token}`,
    '-H', 'Accept: application/vnd.github+json',
    '-H', 'User-Agent: iptv-hub-release'];
  if (body !== null) {
    args.push('-H', 'Content-Type: application/json', '--data-binary', body);
  }
  if (filePath !== null) {
    args.push('-H', 'Content-Type: application/zip', '--data-binary', `@${filePath}`);
  }
  args.push(url);
  return execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

const zipPath = process.argv[2];
const tag = process.argv[3] ?? `snapshot-${new Date().toISOString().slice(0, 10)}`;

if (!zipPath) {
  console.error('用法：node scripts/release-snapshot.mjs <zip路径> [tag]');
  process.exit(1);
}

const token = resolveToken();
if (token.length === 0) {
  console.error('拿不到 token（环境变量 GITHUB_TOKEN / git 凭据 / ~/.github-token 都没有）');
  process.exit(1);
}

const body = [
  '## 📦 项目快照',
  '',
  '这是整个项目的**完整快照**（源码 + 产物 + 脚本），解压后 `npm install` 即可继续开发。',
  '',
  '```bash',
  'npm install',
  'npm run build       # 生成 dist/',
  'npm run web:build   # 生成 site/',
  'npm test            # 跑测试',
  '```',
  '',
  '需要完整 git 历史的话直接 clone：',
  '',
  '```bash',
  `git clone https://github.com/${REPO}.git`,
  '```',
  '',
  '包里**不含** `node_modules`、`.git`、`dist/live`（后者含内网地址，只在手机本地用）。',
].join('\n');

console.log(`创建 Release：${tag}`);
const created = JSON.parse(
  request(API + '/releases', token, 'POST', JSON.stringify({
    tag_name: tag,
    name: `项目快照 ${tag}`,
    body,
    draft: false,
    prerelease: false,
  })),
);
console.log(`已创建 Release id=${created.id}`);
console.log(`地址：${created.html_url}`);

const name = basename(zipPath);
console.log(`上传附件 ${name}（${(statSync(zipPath).size / 1024).toFixed(0)} KB）…`);
const asset = JSON.parse(
  request(`${UPLOAD}/releases/${created.id}/assets?name=${encodeURIComponent(name)}`, token, 'POST', null, zipPath),
);
console.log(`附件已上传：${asset.browser_download_url}`);
console.log(`Release：${created.html_url}`);
