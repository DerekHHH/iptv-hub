/**
 * @file GitHub API 封装。
 *
 * 权限边界（重要）：
 *   - **触发构建** 用用户自己的 Token（`workflow_dispatch` 需要写权限）
 *   - **轮询运行状态** 一律匿名请求（公开仓库的 Actions 运行记录匿名可读，不消耗 Token）
 *   - Token 只放 localStorage，只在 `Authorization` 请求头里出现，绝不写日志、绝不进 URL
 */

import type { RepoRef } from './links';

/** API 根地址。 */
const API_BASE = 'https://api.github.com';

/** 工作流文件名（必须与 .github/workflows/update.yml 一致）。 */
export const WORKFLOW_FILE = 'update.yml';

/** 请求超时（ms）。 */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * 写路径的请求超时（ms），比读路径宽得多。
 *
 * `api.github.com` 在国内实测 TLS 握手要 10~12 秒，15 秒会把慢握手偶发判成超时。
 */
const WRITE_TIMEOUT_MS = 40_000;

/** 错误类别。 */
export type FailureKind = 'auth' | 'forbidden' | 'notfound' | 'invalid' | 'ratelimit' | 'network' | 'unknown';

/** 中文错误说明 + 下一步动作。 */
export interface ApiFailure {
  kind: FailureKind;
  /** HTTP 状态码，网络错误为 0 */
  status: number;
  /** 一句话原因 */
  message: string;
  /** 下一步该干什么 */
  action: string;
}

/** GitHub 调用异常（带中文可读信息）。 */
export class GithubApiError extends Error {
  /** 结构化失败信息 */
  readonly failure: ApiFailure;

  /**
   * @param failure 失败信息
   */
  constructor(failure: ApiFailure) {
    super(failure.message);
    this.name = 'GithubApiError';
    this.failure = failure;
  }
}

/**
 * 把 HTTP 状态码映射成中文原因 + 下一步动作。
 *
 * @param status 状态码
 * @param context 场景描述（用于消息里区分"触发"还是"查询"）
 * @return 失败信息
 */
export function mapHttpError(status: number, context = '请求'): ApiFailure {
  if (status === 401) {
    return {
      kind: 'auth',
      status,
      message: '钥匙（Token）无效或已经过期',
      action:
        '去 GitHub 重新生成一个 Token，勾选 Actions: Read and write（只改分组/隐藏频道还需要 Contents: Read and write），再粘回来保存。',
    };
  }
  if (status === 403) {
    return {
      kind: 'forbidden',
      status,
      message: '这把钥匙没有权限，或者短时间内点太多次被限流',
      action:
        '确认 Token 勾了 Actions: Read and write 与 Contents: Read and write 且属于这个仓库；如果刚点过，等 1 分钟再试。',
    };
  }
  if (status === 404) {
    return {
      kind: 'notfound',
      status,
      message: '找不到仓库或更新脚本（workflow）',
      action: '确认仓库里存在 .github/workflows/update.yml，并且 Token 属于这个仓库。',
    };
  }
  if (status === 422) {
    return {
      kind: 'invalid',
      status,
      message: '参数不被接受（通常是默认分支名不是 main）',
      action: '在下方"高级设置"里把分支名改成你仓库的真实默认分支（一般是 main 或 master）。',
    };
  }
  if (status === 429) {
    return {
      kind: 'ratelimit',
      status,
      message: '请求太频繁，被 GitHub 限流了',
      action: '等 1~2 分钟再点，不要连续点。',
    };
  }
  if (status >= 500) {
    return {
      kind: 'unknown',
      status,
      message: `GitHub 服务暂时出错（HTTP ${status}）`,
      action: '这是 GitHub 自己的问题，等几分钟再试。',
    };
  }
  return {
    kind: 'unknown',
    status,
    message: `${context}失败（HTTP ${status}）`,
    action: '稍后重试；若持续失败，去仓库 Actions 页面手动跑一次看看报错。',
  };
}

/**
 * 统一请求封装（带超时、错误映射）。
 *
 * @param path API 路径（以 / 开头）
 * @param init fetch 选项
 * @param token 可选 Token（不传 = 匿名）
 * @param timeoutMs 超时（ms），写路径传 `WRITE_TIMEOUT_MS`
 * @return 解析后的 JSON（无正文时返回 null）
 */
async function request<T>(
  path: string,
  init: RequestInit = {},
  token?: string,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token !== undefined && token.length > 0) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new GithubApiError(mapHttpError(response.status));
    }
    if (response.status === 204) {
      return null;
    }
    const text = await response.text();
    if (text.trim().length === 0) {
      return null;
    }
    return JSON.parse(text) as T;
  } catch (error) {
    if (error instanceof GithubApiError) {
      throw error;
    }
    const aborted = error instanceof Error && error.name === 'AbortError';
    throw new GithubApiError({
      kind: 'network',
      status: 0,
      message: aborted ? '请求 GitHub 超时了' : '连不上 GitHub（网络问题或被拦截）',
      action: '检查网络后重试；公司网络/校园网有时会拦 api.github.com。',
    });
  } finally {
    clearTimeout(timer);
  }
}

/** 一次运行（run）的摘要。 */
export interface RunSummary {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  created_at: string;
  updated_at: string;
  html_url: string;
  event: string;
}

/** 一个 job 的摘要。 */
export interface JobSummary {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
}

/** Token 校验结果。 */
export interface TokenCheck {
  ok: boolean;
  message: string;
  action?: string;
}

/**
 * 校验 Token 能否访问该仓库（顺便确认仓库名写得对不对）。
 *
 * @param token 用户 Token
 * @param repo 仓库定位
 * @return 校验结果
 */
export async function verifyToken(token: string, repo: RepoRef): Promise<TokenCheck> {
  try {
    await request<unknown>(`/repos/${repo.owner}/${repo.repo}`, { method: 'GET' }, token);
    return { ok: true, message: '这把钥匙可以访问你的仓库' };
  } catch (error) {
    if (error instanceof GithubApiError) {
      return { ok: false, message: error.failure.message, action: error.failure.action };
    }
    return { ok: false, message: '校验失败，请稍后重试' };
  }
}

/**
 * 触发一次构建（需要 Token 的 Actions 写权限）。
 *
 * @param token 用户 Token
 * @param repo 仓库定位
 * @param ref 分支名
 */
export async function dispatchWorkflow(token: string, repo: RepoRef, ref = 'main'): Promise<void> {
  await request<null>(
    `/repos/${repo.owner}/${repo.repo}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
    {
      method: 'POST',
      body: JSON.stringify({ ref }),
      headers: { 'Content-Type': 'application/json' },
    },
    token,
  );
}

/**
 * 列出最近的运行记录（**匿名请求**，公开仓库不需要 Token）。
 *
 * @param repo 仓库定位
 * @param perPage 条数
 * @return 运行列表（新的在前）
 */
export async function listRuns(repo: RepoRef, perPage = 10): Promise<RunSummary[]> {
  const data = await request<{ workflow_runs?: RunSummary[] }>(
    `/repos/${repo.owner}/${repo.repo}/actions/runs?per_page=${perPage}`,
    { method: 'GET' },
  );
  const runs = data?.workflow_runs ?? [];
  // 只保留本仓库"更新电视源"这条工作流（同名不同 event 的也保留，UI 里再区分）
  return runs.filter((run) => run.name === undefined || !run.name.toLowerCase().includes('test'));
}

/**
 * 取单次运行详情（匿名请求）。
 *
 * @param repo 仓库定位
 * @param runId 运行 id
 * @return 运行摘要
 */
export async function getRun(repo: RepoRef, runId: number): Promise<RunSummary | null> {
  return await request<RunSummary>(`/repos/${repo.owner}/${repo.repo}/actions/runs/${runId}`, { method: 'GET' });
}

/**
 * 取某次运行的 job 列表（匿名请求）。
 *
 * @param repo 仓库定位
 * @param runId 运行 id
 * @return job 列表
 */
export async function getRunJobs(repo: RepoRef, runId: number): Promise<JobSummary[]> {
  const data = await request<{ jobs?: JobSummary[] }>(
    `/repos/${repo.owner}/${repo.repo}/actions/runs/${runId}/jobs`,
    { method: 'GET' },
  );
  return data?.jobs ?? [];
}

// ------------------------------------------------------------------ 文件读写

/** 仓库里的一个文件（内容和当前 sha）。 */
export interface RemoteFile {
  /** 解码后的文本 */
  content: string;
  /** 当前版本 sha（写入时必须带，否则会被拒） */
  sha: string;
}

/** Contents API 返回的文件结构。 */
interface ContentResponse {
  content?: string;
  sha?: string;
  encoding?: string;
}

/**
 * 把 base64 解码成 UTF-8 文本。
 *
 * `atob` 给的是 latin1 字节串，中文必须再走一遍 UTF-8 解码，否则会变乱码。
 *
 * @param base64 base64 文本（允许含换行）
 * @return 解码后的文本
 */
function decodeBase64Utf8(base64: string): string {
  const binary = atob(base64.replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder('utf-8').decode(bytes);
}

/**
 * 把 UTF-8 文本编码成 base64（Contents API 要求）。
 *
 * @param text 文本
 * @return base64
 */
function encodeBase64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/**
 * 读仓库文件（需要 Contents 读权限；私有仓库必须带 Token）。
 *
 * @param token 用户 Token
 * @param repo 仓库定位
 * @param path 仓库内路径
 * @param ref 分支名
 * @return 文件内容与 sha；文件不存在时返回 null
 */
export async function getFile(
  token: string,
  repo: RepoRef,
  path: string,
  ref = 'main',
): Promise<RemoteFile | null> {
  try {
    const data = await request<ContentResponse>(
      `/repos/${repo.owner}/${repo.repo}/contents/${path}?ref=${encodeURIComponent(ref)}`,
      { method: 'GET' },
      token,
    );
    if (data === null || typeof data.content !== 'string') {
      return null;
    }
    return { content: decodeBase64Utf8(data.content), sha: data.sha ?? '' };
  } catch (error) {
    if (error instanceof GithubApiError && error.failure.status === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * 写仓库文件（条件更新：必须带 sha，否则并发会互相覆盖）。
 *
 * @param token 用户 Token
 * @param repo 仓库定位
 * @param options 路径、内容、sha（新建文件传空串）、提交信息、分支
 */
export async function putFile(
  token: string,
  repo: RepoRef,
  options: { path: string; text: string; sha: string; message: string; ref?: string },
): Promise<void> {
  const body: Record<string, string> = {
    message: options.message,
    content: encodeBase64Utf8(options.text),
  };
  if (options.sha.length > 0) {
    body.sha = options.sha;
  }
  if (options.ref !== undefined && options.ref.length > 0) {
    body.branch = options.ref;
  }
  await request<null>(
    `/repos/${repo.owner}/${repo.repo}/contents/${options.path}`,
    {
      method: 'PUT',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    },
    token,
    WRITE_TIMEOUT_MS,
  );
}

/**
 * 读 → 改 → 写 一个文本文件，sha 过期（409/422）时自动重取一次。
 *
 * 为什么放在这里而不是页面里：四个管理动作都是"把当前内容读出来，追加/删掉一项，再写回去"，
 * 重试逻辑抄四遍必出错。
 *
 * @param token 用户 Token
 * @param repo 仓库定位
 * @param path 仓库内路径
 * @param build 由当前内容（文件不存在时为 null）算出新内容的函数
 * @param message 提交信息
 * @param ref 分支名
 * @return 是否发生了冲突重试
 */
export async function updateTextFile(
  token: string,
  repo: RepoRef,
  path: string,
  build: (current: string | null) => string,
  message: string,
  ref = 'main',
): Promise<{ retried: boolean }> {
  let retried = false;
  for (let round = 0; round < 2; round += 1) {
    const existing = await getFile(token, repo, path, ref);
    const nextText = build(existing === null ? null : existing.content);
    try {
      await putFile(token, repo, {
        path,
        text: nextText,
        sha: existing?.sha ?? '',
        message,
        ref,
      });
      return { retried };
    } catch (error) {
      // 409/422 = sha 已过期（别人刚提交过），重取一次再写
      const conflict =
        error instanceof GithubApiError &&
        (error.failure.status === 409 || error.failure.status === 422) &&
        round === 0;
      if (!conflict) {
        throw error;
      }
      retried = true;
    }
  }
  throw new GithubApiError({
    kind: 'unknown',
    status: 409,
    message: '文件被别处改过，重试后仍然冲突',
    action: '刷新页面重新操作一次；如果刚在手机上改过，等构建跑完再来。',
  });
}
