import { theme as antdTheme } from 'antd';
import type { ThemeConfig } from 'antd';
import { antdTokenOverrides } from '@platform/ui';

/**
 * AntD 主题：一律由 @platform/ui 的 Token 映射派生，禁止在此硬编码色值。
 */
export const appTheme: ThemeConfig = {
  token: { ...antdTokenOverrides },
  algorithm: antdTheme.defaultAlgorithm,
};
