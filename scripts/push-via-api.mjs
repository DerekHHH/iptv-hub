/**
 * 在 github.com:443 被阻断时，用 GitHub REST API 把本地 HEAD 推送到远端分支。
 *
 * 为什么需要它：`git push` 走 github.com，国内经常连不上；而 api.github.com 通常可达。
 * 这里用 Git Data API（blob → tree → commit → ref）复刻一次 push。
 *
 * 用法：
 *   $env:GITHUB_TOKEN = 'github_pat_...'   # 只需 contents:write 权限
 *   node scripts/push-via-api.mjs
 *
 * 只推送 `git diff 远端..HEAD` 里改动的文件，未改动的沿用远端 tree，不会覆盖别人的提交。
 */

import { execFileSync } from 'node:child_process';

const OWNER = 'DerekHHH';
const REPO = 'iptv-hub';
const BRANCH = 'main';
const API = 'https://api.github.com';

const token = process.env.GITHUB_TOKEN ?? '';
if (token.length === 0) {
  console.error('缺少 GITHUB_TOKEN 环境变量');
  process.exit(1);
}

const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();

async function call(pathname, init = {}) {
  const response = await fetch(`${API}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'iptv-hub-push',
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${init.method ?? 'GET'} ${pathname} → HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  return text.length === 0 ? null : JSON.parse(text);
}

const localHead = git('rev-parse', 'HEAD');
const localMessage = git('log', '-1', '--pretty=%B').trim();
const remoteRef = await call(`/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`);
const remoteHead = remoteRef.object.sha;

if (remoteHead === localHead) {
  console.log('远端已是最新，无需推送');
  process.exit(0);
}

// 远端可能领先本地（例如手机上推过），这里只允许「本地包含远端」的快进推送。
const mergeBase = git('merge-base', 'HEAD', remoteHead);
if (mergeBase !== remoteHead) {
  console.error('本地不是远端快进（远端有本地没有的提交），请先合并后再推');
  process.exit(1);
}

const changed = git('diff', '--name-only', remoteHead, localHead)
  .split('\n')
  .filter((line) => line.length > 0);
if (changed.length === 0) {
  console.error('两个提交之间没有文件差异，换不出新 tree');
  process.exit(1);
}

console.log(`远端 ${remoteHead.slice(0, 7)} → 本地 ${localHead.slice(0, 7)}，改动 ${changed.length} 个文件`);

const remoteCommit = await call(`/repos/${OWNER}/${REPO}/git/commits/${remoteHead}`);
const treeEntries = [];

for (const path of changed) {
  let blobSha;
  try {
    // 用 cat-file 取原始字节，避免行尾/编码被 Node 重写
    const base64 = execFileSync('git', ['cat-file', '-p', `HEAD:${path}`], {
      encoding: 'base64',
      maxBuffer: 64 * 1024 * 1024,
    }).replace(/\n/g, '');
    const blob = await call(`/repos/${OWNER}/${REPO}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({ content: base64, encoding: 'base64' }),
    });
    blobSha = blob.sha;
  } catch {
    // HEAD 里没有这个路径 = 本地删除了文件，tree 里不写它即可（基于 base_tree 即等于删除）
    continue;
  }
  treeEntries.push({ path, mode: '100644', type: 'blob', sha: blobSha });
}

const tree = await call(`/repos/${OWNER}/${REPO}/git/trees`, {
  method: 'POST',
  body: JSON.stringify({ base_tree: remoteCommit.tree.sha, tree: treeEntries }),
});
const commit = await call(`/repos/${OWNER}/${REPO}/git/commits`, {
  method: 'POST',
  body: JSON.stringify({ message: localMessage, tree: tree.sha, parents: [remoteHead] }),
});
await call(`/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, {
  method: 'PATCH',
  body: JSON.stringify({ sha: commit.sha, force: false }),
});

console.log(`已推送 commit ${commit.sha.slice(0, 7)}`);
