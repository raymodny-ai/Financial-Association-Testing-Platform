/**
 * T16 · 提示词渲染器（RED 先行）。
 * 纯函数 renderPrompt：user_prompt_template.txt 的 12 个 {{placeholder}} ← LlmContext。
 * 要求：全部占位符替换完毕（残留即抛错）、数组字段渲染为编号列表。
 */
import type { LlmContext } from '@platform/schemas';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderPrompt } from './prompt-renderer.js';

const template = readFileSync(
  fileURLToPath(new URL('../../../../prompts/user_prompt_template.txt', import.meta.url)),
  'utf-8',
);

const context: LlmContext = {
  research_question: '涨跌状态是否联动？',
  research_scope: '双路线检验',
  sample_info: '频率 daily',
  variable_definitions: 'A：收盘价',
  categorical_key_findings: '共 2 组检验',
  continuous_key_findings: '未产出该类检验结果。',
  rolling_key_findings: '无显著窗口',
  lag_key_findings: '未产出滞后分析结果（maxLag=10）。',
  audit_key_findings: 'A：pass',
  global_confidence_flags: ['审计高风险：置信度下调', '统计显著不等于经济显著'],
  required_answer_sections: ['1. 研究结论摘要', '2. 差异解释'],
  forbidden_claims: ['不得表述因果'],
};

describe('renderPrompt · 占位符替换', () => {
  it('12 个占位符全部替换为上下文字段', () => {
    const rendered = renderPrompt(template, context);
    expect(rendered).toContain('涨跌状态是否联动？');
    expect(rendered).toContain('双路线检验');
    expect(rendered).toContain('共 2 组检验');
    expect(rendered).not.toMatch(/\{\{\w+\}\}/);
  });

  it('数组字段渲染为编号列表', () => {
    const rendered = renderPrompt(template, context);
    expect(rendered).toContain('1. 审计高风险：置信度下调');
    expect(rendered).toContain('2. 统计显著不等于经济显著');
    expect(rendered).toContain('1. 不得表述因果');
  });

  it('模板含未知占位符时抛错（防模板-契约漂移）', () => {
    expect(() => renderPrompt('前文 {{unknown_field}} 后文', context)).toThrow(/unknown_field/);
  });

  it('空数组字段渲染为「无」占位', () => {
    const rendered = renderPrompt('旗标：{{global_confidence_flags}}', {
      ...context,
      global_confidence_flags: [],
    });
    expect(rendered).toBe('旗标：无');
  });
});
