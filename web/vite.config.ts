/**
 * @file Vite 配置（网页端）。
 *
 * 关键点：
 *   - `root` = 本文件所在目录（web/），因此 index.html 在 web/index.html
 *   - `build.outDir` = ../site，`emptyOutDir: true` 只清空 `site/`
 *   - **绝不触碰 `dist/`**（数据产物目录，入库由 Node 端构建写）
 *   - `base: './'`：Fork 到任意仓库后，Pages 子路径也能直接跑
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// 配置文件会被 Vite 复制到同目录的临时文件后执行，因此 import.meta.url 指向 web/
const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  base: './',
  plugins: [react()],
  build: {
    outDir: resolve(here, '..', 'site'),
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2019',
    chunkSizeWarningLimit: 1200,
  },
  server: {
    port: 5173,
    host: '127.0.0.1',
    open: false,
  },
});
