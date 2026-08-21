// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // 全局忽略：产物目录、依赖、技能资产与锁文件
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', '**/__fixtures__/**', '.qoder/**', 'pnpm-lock.yaml'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // 禁止业务代码硬编码 setTimeout 数字延时（审计/统计代码须显式配置）
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
