/**
 * T16 · LLM 提供方解析与提示词资产加载（单元测试，不触网）。
 */
import { describe, expect, it } from 'vitest';
import { llmOutputSchema } from '@platform/schemas';
import { resolveLlmProvider } from './llm-config.js';
import { loadOutputSchema, loadPromptAssets } from './prompt-assets.js';

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

/**
 * G8：PRD 模块 K「输出要求」10 字段一致性守卫——
 * prompts/output_schema.json（模型侧声明）与 llmOutputSchema（服务端校验）
 * 互为双源，任一漂移都会导致输出被拒或字段丢失，故强制对拍。
 */
describe('output_schema.json ↔ llmOutputSchema 一致性', () => {
  it('PRD 10 字段全集：required 与 properties 均完整覆盖', () => {
    const prdFields = [
      'executive_conclusion',
      'statistical_interpretation',
      'stability_assessment',
      'data_quality_caveats',
      'market_meaning',
      'next_research_steps',
      'monitoring_suggestions',
      'strategy_risk_notes',
      'confidence_level',
      'forbidden_inference_flags',
    ];
    const schema = loadOutputSchema();
    expect(schema.required.slice().sort()).toEqual(prdFields.slice().sort());
    expect(Object.keys(schema.properties).slice().sort()).toEqual(prdFields.slice().sort());
  });

  it('与 llmOutputSchema 键集严格一致（含 forbidden_inference_flags/confidence_level）', () => {
    const schema = loadOutputSchema();
    const zodKeys = Object.keys(llmOutputSchema.shape).sort();
    expect(Object.keys(schema.properties).sort()).toEqual(zodKeys);
    expect(schema.required.slice().sort()).toEqual(zodKeys);
  });

  it('禁止额外字段：additionalProperties=false 且 confidence_level 限 high/medium/low', () => {
    const schema = loadOutputSchema();
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.confidence_level?.enum).toEqual(['high', 'medium', 'low']);
  });
});
