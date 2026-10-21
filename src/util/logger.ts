/**
 * @file 结构化日志（约定 §7）。
 *
 * 所有日志行必须带阶段前缀 `[fetch]` / `[probe]` / `[emit]` …
 * 并且必须经过 `sanitize()` 脱敏：Token 与 URL 里的敏感 query 一律不出现在日志里。
 */

/** 日志级别。 */
export type LogLevel = 'info' | 'warn' | 'error';

/** 需要整体打码的关键字（大小写不敏感）。 */
const SECRET_KEY_PATTERNS: readonly RegExp[] = [
  /gh[pousr]_[A-Za-z0-9]{16,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /(?:token|access_token|auth|key|signature|sig|password)=([^&\s]+)/gi,
];

/** 允许保留的 token 类提示文字（避免把提示文案本身打码）。 */
const MASK = '***';

/**
 * 脱敏：抹掉 GitHub Token 形态字符串与 URL 中的 token/key 参数值。
 *
 * @param text 原始文本
 * @return 脱敏后文本
 */
export function sanitize(text: string): string {
  let output = text;
  for (const pattern of SECRET_KEY_PATTERNS) {
    output = output.replace(pattern, (match, ...rest) => {
      // 带捕获组的规则（key=value）需要保留 key=
      const groups = rest.filter((item): item is string => typeof item === 'string');
      if (groups.length > 0 && groups[0] !== undefined) {
        return match.includes('=') ? `${match.split('=')[0]}=${MASK}` : MASK;
      }
      return MASK;
    });
  }
  return output;
}

/** 把附加字段序列化成单行 JSON（脱敏后）。 */
function stringifyExtra(extra: unknown): string {
  if (extra === undefined) {
    return '';
  }
  try {
    return ` ${sanitize(JSON.stringify(extra))}`;
  } catch {
    return ` ${MASK}`;
  }
}

/** 统一的输出函数（便于测试替换）。 */
let sink: (level: LogLevel, line: string) => void = (level, line) => {
  if (level === 'error') {
    console.error(line);
    return;
  }
  if (level === 'warn') {
    console.warn(line);
    return;
  }
  console.log(line);
};

/**
 * 替换日志输出目标（单测里用于静音或断言）。
 *
 * @param next 新的输出函数
 */
export function setLogSink(next: (level: LogLevel, line: string) => void): void {
  sink = next;
}

/**
 * 日志门面：行首阶段名统一带方括号。
 */
export const log = {
  /**
   * 普通信息。
   *
   * @param stage 阶段名，如 'fetch'
   * @param message 文案
   * @param extra 可选附加字段（会被 JSON 化并脱敏）
   */
  info(stage: string, message: string, extra?: unknown): void {
    sink('info', sanitize(`[${stage}] ${message}`) + stringifyExtra(extra));
  },

  /**
   * 警告（不影响主流程，但需要人看见）。
   *
   * @param stage 阶段名
   * @param message 文案
   * @param extra 可选附加字段
   */
  warn(stage: string, message: string, extra?: unknown): void {
    sink('warn', sanitize(`[${stage}] 警告：${message}`) + stringifyExtra(extra));
  },

  /**
   * 错误（已降级处理，不抛异常）。
   *
   * @param stage 阶段名
   * @param message 文案
   * @param extra 可选附加字段
   */
  error(stage: string, message: string, extra?: unknown): void {
    sink('error', sanitize(`[${stage}] 错误：${message}`) + stringifyExtra(extra));
  },
};
