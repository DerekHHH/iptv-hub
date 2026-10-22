#!/usr/bin/env node
/**
 * @file QA 独立静态检查（对应验收任务 E）：workflow 语法、脚本引用、敏感串、Node API 误引、gitignore。
 *
 * 用法：node tests/qa/check-config.mjs
 * 退出码：0 = 全通过，1 = 有失败项。
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');

const results = [];

/**
 * 记录一条检查。
 *
 * @param {string} name 检查项
 * @param {boolean} ok 是否通过
 * @param {string} detail 实际值
 */
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  →  ${detail}`);
}

/** 递归收集文件（跳过 node_modules / dist / site / pages-out / .tmp）。 */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (['node_modules', 'dist', 'site', 'pages-out', '.tmp', '.git', '.playwright-cli'].includes(entry)) {
      continue;
    }
    const full = join(dir, entry);
    const info = statSync(full);
    if (info.isDirectory()) {
      walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

/**
 * 在指定目录里搜字符串（返回 文件:行号 列表）。
 *
 * @param dirs 搜索目录
 * @param pattern 正则
 * @param extensions 只看这些后缀
 * @return 命中列表
 */
function grep(dirs, pattern, extensions = ['.ts', '.tsx', '.mjs', '.js', '.json', '.yml', '.yaml']) {
  const hits = [];
  for (const dir of dirs) {
    const full = join(ROOT, dir);
    if (!existsSync(full)) {
      continue;
    }
    for (const file of walk(full)) {
      if (!extensions.some((ext) => file.endsWith(ext))) {
        continue;
      }
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        if (pattern.test(line)) {
          hits.push(`${file.slice(ROOT.length + 1).replace(/\\/g, '/')}:${index + 1}: ${line.trim().slice(0, 100)}`);
        }
      });
    }
  }
  return hits;
}

// ---------------------------------------------------------------- E4 workflow
const workflowPath = join(ROOT, '.github', 'workflows', 'update.yml');
check('workflow 文件存在', existsSync(workflowPath), existsSync(workflowPath) ? '.github/workflows/update.yml' : '缺失');

const workflowText = existsSync(workflowPath) ? readFileSync(workflowPath, 'utf8') : '';
let workflow = null;
try {
  const yamlModule = await import('yaml');
  const YAML = yamlModule.default ?? yamlModule;
  workflow = YAML.parse(workflowText);
  check('workflow YAML 语法正确（yaml 解析器）', workflow !== null && typeof workflow === 'object', '解析成功，顶层键：' + Object.keys(workflow ?? {}).join(', '));
} catch (error) {
  check('workflow YAML 语法正确（yaml 解析器）', false, `解析失败：${error.message}`);
}

if (workflow !== null) {
  // YAML 会把裸 on 解析成 true（YAML 1.1 语义），两种键名都接受
  const on = workflow.on ?? workflow[true] ?? {};
  const crons = (on.schedule ?? []).map((item) => item.cron);
  check('定时任务已关闭（改为手机本地测活后推送）', crons.length === 0, JSON.stringify(crons));
  check('含 workflow_dispatch（可手动 Run）', on.workflow_dispatch !== undefined, on.workflow_dispatch === undefined ? '缺失' : '存在');

  const job = (workflow.jobs ?? {}).build;
  check('存在 build job', job !== undefined, job === undefined ? '缺失' : job.name ?? 'build');
  const timeoutMinutes = job?.['timeout-minutes'];
  check('timeout-minutes 为 25', timeoutMinutes === 25, String(timeoutMinutes));

  const permissions = workflow.permissions ?? {};
  const permOk = permissions.contents === 'write' && permissions.pages === 'write' && permissions['id-token'] === 'write';
  check('permissions 含 contents/pages/id-token = write', permOk, JSON.stringify(permissions));

  check('有 concurrency 组（防并发覆盖产物）', workflow.concurrency !== undefined, JSON.stringify(workflow.concurrency ?? null));
  const steps = job?.steps ?? [];
  const runs = steps.filter((step) => typeof step.run === 'string').map((step) => step.run);
  const joined = runs.join('\n');
  check('用 npm ci 安装依赖（需要 package-lock.json）', /npm ci/.test(joined), /npm ci/.test(joined) ? '存在' : '缺失');
  check('覆盖式提交 dist/data', /git add -A dist data/.test(joined), /git add -A dist data/.test(joined) ? '存在' : '缺失');
  const deployStep = steps.find((step) => String(step.uses ?? '').includes('deploy-pages'));
  check('部署步骤使用 actions/deploy-pages', deployStep !== undefined, String(deployStep?.uses ?? '缺失'));

  // 步骤里用到的 npm run xxx 必须在 package.json scripts 里逐字存在
  const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const scripts = packageJson.scripts ?? {};
  const usedScripts = [...joined.matchAll(/npm run ([a-zA-Z0-9:_-]+)/g)].map((match) => match[1]);
  const missing = [...new Set(usedScripts)].filter((name) => scripts[name] === undefined);
  check(
    'workflow 里 npm run 的脚本都在 package.json 中逐字存在',
    missing.length === 0,
    missing.length === 0 ? `用到的脚本：${[...new Set(usedScripts)].join(', ')}` : `缺失：${missing.join(', ')}`,
  );
}

check('package-lock.json 存在（npm ci 必需）', existsSync(join(ROOT, 'package-lock.json')), existsSync(join(ROOT, 'package-lock.json')) ? '存在' : '缺失');

// ---------------------------------------------------------------- E6 gitignore
const gitignore = existsSync(join(ROOT, '.gitignore')) ? readFileSync(join(ROOT, '.gitignore'), 'utf8') : '';
const ignoredLines = gitignore
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith('#'));
const badIgnores = ignoredLines.filter((line) => /^(dist|data)(\/|\*|$)/.test(line));
check('.gitignore 没有忽略 dist/ 与 data/', badIgnores.length === 0, badIgnores.length === 0 ? `忽略项 ${ignoredLines.length} 条，均不含 dist/data` : JSON.stringify(badIgnores));

// ---------------------------------------------------------------- E1 敏感串
const tokenHits = grep(['src', 'web/src', 'scripts', '.github'], /gh[pousr]_[A-Za-z0-9]|github_pat_|Bearer /);
const allowed = (hit) =>
  hit.startsWith('src/util/logger.ts') || // 脱敏正则
  hit.startsWith('web/src/lib/githubApi.ts') || // Authorization 请求头
  hit.startsWith('web/src/pages/Admin.tsx') || // Authorization 请求头（管理后台直写 GitHub API）
  hit.startsWith('scripts/push-via-api.mjs') || // Authorization 请求头 + 用法示例里的占位 Token
  hit.startsWith('web/src/pages/Update.tsx'); // 输入框 placeholder 文案
const unexpected = tokenHits.filter((hit) => !allowed(hit));
const unexpectedBearer = tokenHits.filter((hit) => hit.includes('Bearer ') && !allowed(hit));
check('Token 形态字符串只出现在脱敏正则 / Authorization 头 / UI 提示文案', unexpected.length === 0 && unexpectedBearer.length === 0, unexpected.length === 0 ? `命中 ${tokenHits.length} 处，均属允许位置` : JSON.stringify(unexpected));
check('Token 未写入 console/日志调用', grep(['src', 'web/src'], /console\.(log|warn|error)\([^)]*token/i).length === 0, `${grep(['src', 'web/src'], /console\.(log|warn|error)\([^)]*token/i).length} 处`);

// ---------------------------------------------------------------- E2 网页端不引 Node API
const nodeImports = grep(['web/src'], /from\s+['"]node:|require\(/);
check('web/src 未误引 Node API（node: / require）', nodeImports.length === 0, nodeImports.length === 0 ? '0 处' : JSON.stringify(nodeImports));
const processRefs = grep(['web/src'], /\bprocess\.(env|argv|cwd)|\bBuffer\./);
check('web/src 未使用 process/Buffer', processRefs.length === 0, processRefs.length === 0 ? '0 处' : JSON.stringify(processRefs));

// ---------------------------------------------------------------- E3 时间格式化统一入口
const timeBypass = grep(['src'], /\.toLocaleString\(|\.toISOString\(/).filter((hit) => !hit.startsWith('src/util/time.ts'));
check('src/ 内除 util/time.ts 注释外无 toLocaleString/toISOString 调用', timeBypass.length === 0, timeBypass.length === 0 ? '0 处' : JSON.stringify(timeBypass));

// ---------------------------------------------------------------- 其它一致性
const configText = readFileSync(join(ROOT, 'src', 'config.ts'), 'utf8');
check('PROBE.concurrency = 64', /concurrency:\s*64/.test(configText), /concurrency:\s*64/.test(configText) ? '64' : '不符');
check('PROBE.deadlineMs = 17 分钟', /deadlineMs:\s*17\s*\*\s*60\s*\*\s*1000/.test(configText), /deadlineMs:\s*17\s*\*\s*60\s*\*\s*1000/.test(configText) ? '17min' : '不符');
check('SELECT.maxPerChannel = 5', /maxPerChannel:\s*5/.test(configText), /maxPerChannel:\s*5/.test(configText) ? '5' : '不符');
check('SELECT.priorityMaxPerChannel = 10', /priorityMaxPerChannel:\s*10/.test(configText), /priorityMaxPerChannel:\s*10/.test(configText) ? '10' : '不符');

const mainText = readFileSync(join(ROOT, 'src', 'main.ts'), 'utf8');
check('main.ts 显式设置 exitCode 0', /process\.exitCode = 0/.test(mainText), /process\.exitCode = 0/.test(mainText) ? '存在' : '缺失');

// ---------------------------------------------------------------- 汇总
const failed = results.filter((item) => !item.ok).length;
console.log(`\n合计 ${results.length} 项，通过 ${results.length - failed}，失败 ${failed}`);
process.exitCode = failed === 0 ? 0 : 1;
