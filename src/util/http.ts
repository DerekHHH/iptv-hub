/**
 * @file HTTP 封装：超时 + 可区分超时的信号 + 依赖注入。
 *
 * 不用 `AbortSignal.timeout`，自己造 AbortController，这样能准确区分
 * "我们主动超时" 与 "调用方取消"，测活结果是 timeout 还是 dead 才不会乱。
 */

/** 带超时标记的请求上下文。 */
export interface TimeoutContext {
  signal: AbortSignal;
  /** 是否已因超时被中止 */
  isTimedOut: () => boolean;
  /** 主动取消（清理定时器） */
  cancel: () => void;
}

/**
 * 创建带超时的 AbortSignal。
 *
 * @param timeoutMs 超时毫秒数（<=0 表示不设超时）
 * @param parent 上层信号（可选，会被级联）
 * @return 超时上下文
 */
export function createTimeoutSignal(timeoutMs: number, parent?: AbortSignal): TimeoutContext {
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  if (timeoutMs > 0) {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
  }

  const onParentAbort = (): void => {
    controller.abort();
  };
  if (parent) {
    if (parent.aborted) {
      controller.abort();
    } else {
      parent.addEventListener('abort', onParentAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    isTimedOut: () => timedOut,
    cancel: () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      if (parent) {
        parent.removeEventListener('abort', onParentAbort);
      }
    },
  };
}

/**
 * 判断异常是否属于"超时/中止"。
 *
 * @param error 捕获到的异常
 * @return true 表示超时或中止
 */
export function isAbortError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.name === 'AbortError' || error.name === 'TimeoutError';
  }
  return false;
}

/**
 * 把异常转成一行可读文案（日志/结果里用，不做堆栈）。
 *
 * @param error 捕获到的异常
 * @return 文案
 */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause;
    if (cause instanceof Error && cause.message && cause.message !== error.message) {
      return `${error.name}: ${error.message} (${cause.message})`;
    }
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

/** 一次请求的最简结果（只要文本）。 */
export interface TextResponse {
  ok: boolean;
  status: number;
  contentType: string;
  text: string;
}

/**
 * 抓取文本（带超时与有限重试），失败抛异常。
 *
 * @param url 目标地址
 * @param options 选项：超时、重试次数、注入的 fetch、UA
 * @return 响应概要
 */
export async function fetchText(
  url: string,
  options: {
    timeoutMs: number;
    retries?: number;
    fetchImpl?: typeof fetch;
    userAgent?: string;
    signal?: AbortSignal;
  },
): Promise<TextResponse> {
  const doFetch = options.fetchImpl ?? fetch;
  const retries = options.retries ?? 0;
  let lastError: unknown = new Error('未发起请求');

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const timeout = createTimeoutSignal(options.timeoutMs, options.signal);
    try {
      const response = await doFetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: timeout.signal,
        headers: {
          'User-Agent': options.userAgent ?? 'IPTVHub/1.0',
          Accept: '*/*',
          'Cache-Control': 'no-cache',
        },
      });
      const text = await response.text();
      return {
        ok: response.ok,
        status: response.status,
        contentType: response.headers.get('content-type') ?? '',
        text,
      };
    } catch (error) {
      lastError = error;
      if (isAbortError(error) && attempt === retries) {
        throw error;
      }
    } finally {
      timeout.cancel();
    }
  }

  throw lastError;
}
