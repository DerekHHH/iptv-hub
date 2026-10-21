import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 配置文件不依赖启动目录：所有路径都从本文件位置算
const here = dirname(fileURLToPath(import.meta.url));

/**
 * PostCSS 配置：Tailwind（只做排版辅助）+ Autoprefixer。
 * 显式给出 tailwind 配置文件的绝对路径，避免从 CWD 找不到配置。
 */
export default {
  plugins: {
    tailwindcss: { config: resolve(here, 'tailwind.config.js') },
    autoprefixer: {},
  },
};
