import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // tokens.css?raw 一致性测试需要真实 CSS 内容（默认被 stub 为空）
    css: true,
  },
});
