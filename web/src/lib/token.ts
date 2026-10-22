/**
 * @file GitHub Token 的本地存取（「一键更新」与「管理后台」共用）。
 *
 * 权限边界（重要）：
 *   - Token 只放 localStorage，只在 `Authorization` 请求头里出现
 *   - 绝不进 URL、绝不写日志、绝不上报
 *   - 建议使用 Fine-grained token：只勾该仓库、只勾 Contents / Actions 的 Read and write
 */

/** Token 在 localStorage 的键名。 */
export const TOKEN_KEY = 'iptv_hub_github_token';

/**
 * 读取本地保存的 Token。
 *
 * @return Token 或空串
 */
export function readToken(): string {
  try {
    return window.localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

/**
 * 保存 / 清除 Token。
 *
 * @param token Token，空串表示清除
 */
export function saveToken(token: string): void {
  try {
    if (token.length === 0) {
      window.localStorage.removeItem(TOKEN_KEY);
      return;
    }
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // 隐私模式下 localStorage 可能不可用
  }
}

/**
 * 把 Token 变成掩码文案（只保留末 4 位）。
 *
 * @param token Token
 * @return 掩码
 */
export function maskToken(token: string): string {
  if (token.length <= 4) {
    return '••••';
  }
  return `••••••••${token.slice(-4)}`;
}
