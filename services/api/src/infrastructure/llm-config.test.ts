/**
 * T16 · LLM 提供方解析与提示词资产加载（单元测试，不触网）。
 */
import { describe, expect, it } from 'vitest';
import { resolveLlmProvider } from './llm-config.js';
import { loadPromptAssets } from './prompt-assets.js';

describe('resolveLlmProvider', () => {
  it('qwen 系模型 → DashScope compatible-mode + DASHSCOPE_API_KEY', () => {
    const r = resolveLlmProvider('qwen-plus', { DASHSCOPE_API_KEY: 'sk-a' });
    expect(r.provider).toBe('qwen');
    expect(r.baseUrl).toContain('dashscope');
    expect(r.apiKey).toBe('sk-a');
  });

  it('deepseek 系模型 → deepseek 官方端点 + DEEPSEEK_API_KEY', () => {
    const r = resolveLlmProvider('deepseek-chat', { DEEPSEEK_API_KEY: 'sk-b' });
    expect(r.provider).toBe('deepseek');
    expect(r.baseUrl).toContain('deepseek');
    expect(r.apiKey).toBe('sk-b');
  });

  it('环境变量可覆盖 baseUrl；缺密钥返回 undefined（供 skipped 降级）', () => {
    const r = resolveLlmProvider('qwen-plus', { LLM_QWEN_BASE_URL: 'http://proxy.local/v1' });
    expect(r.baseUrl).toBe('http://proxy.local/v1');
    expect(r.apiKey).toBeUndefined();
  });
});

describe('loadPromptAssets', () => {
  it('从仓库根 prompts/ 读取版本号与两份模板', () => {
    const assets = loadPromptAssets();
    expect(assets.version).toBe('v1');
    expect(assets.systemPrompt).toContain('金融统计解释助手');
    expect(assets.userTemplate).toContain('{{research_question}}');
    expect(assets.userTemplate).toContain('{{forbidden_claims}}');
  });
});
