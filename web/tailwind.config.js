import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// content 用绝对路径：无论从仓库根还是从 web/ 启动都能扫到类名
const here = dirname(fileURLToPath(import.meta.url));

/**
 * Tailwind 只用来做少量排版辅助（间距/文本），组件主体一律用 MUI。
 * `preflight: false` 必须保留：否则 Tailwind 的样式重置会打坏 MUI。
 */
export default {
  content: [resolve(here, 'index.html'), resolve(here, 'src/**/*.{ts,tsx}')],
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        brand: '#1976d2',
      },
    },
  },
  plugins: [],
};
