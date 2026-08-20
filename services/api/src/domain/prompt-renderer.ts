/**
 * 提示词渲染器（T16，PRD「专业提示词体系」）。
 * 纯函数：user_prompt_template.txt 的 {{placeholder}} ← LlmContext 字段。
 * 占位符集合与 llmContextSchema 12 字段同源；未知占位符抛错防模板-契约漂移。
 */
import type { LlmContext } from '@platform/schemas';
import { ValidationError } from '@platform/shared';

const PLACEHOLDER = /\{\{(\w+)\}\}/g;

function renderValue(value: string | readonly string[]): string {
  if (typeof value === 'string') return value;
  if (value.length === 0) return '无';
  return value.map((item, i) => `${i + 1}. ${item}`).join('\n');
}

/** 将模板中全部占位符替换为上下文字段；残留/未知占位符一律抛错 */
export function renderPrompt(template: string, context: LlmContext): string {
  return template.replace(PLACEHOLDER, (_raw, key: string) => {
    const value = (context as unknown as Record<string, unknown>)[key];
    if (typeof value !== 'string' && !Array.isArray(value)) {
      throw new ValidationError(`提示词占位符 ${key} 在 LlmContext 契约中不存在`);
    }
    return renderValue(value as string | string[]);
  });
}
