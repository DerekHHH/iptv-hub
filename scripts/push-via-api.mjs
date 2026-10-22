/**
 * 在 github.com:443 被阻断时，用 GitHub REST API 把本地 HEAD 的内容推送到远端分支。
 *
 * 为什么需要它：`git push` 走 github.com，国内经常连不上；而 api.github.com 通常可达。
 * 这里用 Git Data API（blob → tree → commit → ref）复刻一次 push。
 *
 * 用法：
 *   $env:GITHUB_TOKEN = 'github_pat_...'   # 只需 contents:write 权限
 *   node scripts/push-via-api.mjs
 *
 * 有可用代理时再设 `GITHUB_PROXY=http://127.0.0.1:7890` 会快很多。
 *
 * 同步方式：把本地 HEAD 的文件表与**远端现有 tree** 逐项比对，只上传有差异的文件、
 * 显式删除本地已不存在的文件。不依赖「本地是远端快进」——因为 API 生成的提交
 * 作者信息会被 GitHub 改写，SHA 必然和本地不同，靠 `git diff 远端..HEAD` 也拿不到远端对象。
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

const proxy = process.env.GITHUB_PROXY ?? '';

const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });

const gitTrim = (...args) => git(...args).trim();

/**
 * 为什么用 curl 而不是全局 fetch：
 * 国内直连 api.github.com 时 TLS 握手要 10~12 秒，而 Node 内置 fetch（undici）的连接
 * 超时默认只有 10 秒，会稳定抛 `UND_ERR_CONNECT_TIMEOUT`；curl 没有这个限制。
 *
 * @param pathname API 路径
 * @param init 请求方法、请求体
 * @return 解析后的 JSON
 */
function call(pathname, init = {}) {
  const args = [
    '-sS',
    '--max-time', '60',
    '--retry', '2',
    '--retry-all-errors',
    '-X', init.method ?? 'GET',
    '-H', `Authorization: Bearer ${token}`,
    '-H', 'Accept: application/vnd.github+json',
    '-H', 'X-GitHub-Api-Version: 2022-11-28',
    '-H', 'User-Agent: iptv-hub-push',
    '-w', '\n%{http_code}',
  ];
  if (proxy.length > 0) {
    args.push('-x', proxy);
  }
  if (init.body !== undefined) {
    args.push('-H', 'Content-Type: application/json', '--data-binary', '@-');
  }
  args.push(`${API}${pathname}`);

  const raw = execFileSync('curl.exe', args, {
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    input: init.body ?? '',
  });
  const splitAt = raw.lastIndexOf('\n');
  const body = raw.slice(0, splitAt);
  const status = Number(raw.slice(splitAt + 1).trim());
  if (status < 200 || status >= 300) {
    throw new Error(`${init.method ?? 'GET'} ${pathname} → HTTP ${status}: ${body.slice(0, 300)}`);
  }
  return body.trim().length === 0 ? null : JSON.parse(body);
}

const remoteHead = call(`/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`).object.sha;
const remoteCommit = call(`/repos/${OWNER}/${REPO}/git/commits/${remoteHead}`);
const remoteTree = call(`/repos/${OWNER}/${REPO}/git/trees/${remoteCommit.tree.sha}?recursive=1`);
const remoteBlobs = new Map(
  remoteTree.tree
    .filter((entry) => entry.type === 'blob')
    .map((entry) => [entry.path, entry.sha]),
);

// `-z` 避免路径被转义，输出形如 `100644 blob <sha>\t<path>\0`
const localBlobs = new Map();
for (const record of git('ls-tree', '-r', '-z', 'HEAD').split('\0')) {
  const match = /^\d+ blob ([0-9a-f]+)\t(.+)$/s.exec(record);
  if (match !== null) {
    localBlobs.set(match[2], match[1]);
  }
}

const toWrite = [...localBlobs.keys()].filter((path) => remoteBlobs.get(path) !== localBlobs.get(path));
const toDelete = [...remoteBlobs.keys()].filter((path) => !localBlobs.has(path));

if (toWrite.length === 0 && toDelete.length === 0) {
  console.log(`远端已与本地内容一致（远端 ${remoteHead.slice(0, 7)}）`);
  process.exit(0);
}

console.log(`远端 ${remoteHead.slice(0, 7)}，待同步：写入 ${toWrite.length} 个，删除 ${toDelete.length} 个`);
for (const path of toDelete) {
  console.log(`  删除 ${path}`);
}

const treeEntries = [];
for (const path of toWrite) {
  // 取原始字节再转 base64，避免非 UTF-8 内容（图片等）被字符串编码破坏
  const base64 = execFileSync('git', ['cat-file', '-p', `HEAD:${path}`], {
    maxBuffer: 128 * 1024 * 1024,
  })
    .toString('base64')
    .replace(/\n/g, '');
  const blob = call(`/repos/${OWNER}/${REPO}/git/blobs`, {
    method: 'POST',
    body: JSON.stringify({ content: base64, encoding: 'base64' }),
  });
  treeEntries.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
}
for (const path of toDelete) {
  treeEntries.push({ path, mode: '100644', type: 'blob', sha: null });
}

const tree = call(`/repos/${OWNER}/${REPO}/git/trees`, {
  method: 'POST',
  body: JSON.stringify({ base_tree: remoteCommit.tree.sha, tree: treeEntries }),
});
const localHead = gitTrim('rev-parse', 'HEAD');
const commit = call(`/repos/${OWNER}/${REPO}/git/commits`, {
  method: 'POST',
  body: JSON.stringify({
    message: gitTrim('log', '-1', '--pretty=%B'),
    tree: tree.sha,
    parents: [remoteHead],
  }),
});
call(`/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, {
  method: 'PATCH',
  body: JSON.stringify({ sha: commit.sha, force: false }),
});

console.log(`已推送 ${commit.sha.slice(0, 7)}（本地 ${localHead.slice(0, 7)}，内容一致）`);
