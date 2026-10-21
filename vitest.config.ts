import { defineConfig } from 'vitest/config';

/**
 * 单测配置：只跑 tests/ 下的 .test.ts，Node 环境、无网络依赖。
 * （Node 端零运行时依赖，vitest 只是 devDep。）
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
    hookTimeout: 20_000,
    reporters: 'default',
  },
});
