/**
 * @platform/schemas · LLM 契约（PRD「LLM 解释模块」）
 *
 * - LlmContext：提供给在线大模型的结构化上下文（12 字段）
 * - LlmOutput：大模型强制 JSON 输出（10 字段）
 * - LlmTrace：调用元数据（prompt 版本 / 模型名 / 时间戳，导出文件 14）
 */
import { z } from 'zod';

/** LLM 上下文表（PRD「数据模型 · LLM 上下文表」） */
export const llmContextSchema = z.object({
  research_question: z.string().min(1),
  research_scope: z.string().min(1),
  sample_info: z.string().min(1),
  variable_definitions: z.string().min(1),
  categorical_key_findings: z.string(),
  continuous_key_findings: z.string(),
  rolling_key_findings: z.string(),
  lag_key_findings: z.string(),
  audit_key_findings: z.string(),
  global_confidence_flags: z.array(z.string()),
  required_answer_sections: z.array(z.string().min(1)).min(1),
  forbidden_claims: z.array(z.string().min(1)).min(1),
});
export type LlmContext = z.infer<typeof llmContextSchema>;

/** 置信级别（输出必须标注置信级别，PRD 可解释性要求） */
export const confidenceLevelSchema = z.enum(['high', 'medium', 'low']);
export type ConfidenceLevel = z.infer<typeof confidenceLevelSchema>;

/** LLM 结构化输出（PRD「输出要求」10 字段） */
export const llmOutputSchema = z.object({
  executive_conclusion: z.string().min(1),
  statistical_interpretation: z.string().min(1),
  stability_assessment: z.string().min(1),
  data_quality_caveats: z.string(),
  market_meaning: z.string(),
  next_research_steps: z.array(z.string()).default([]),
  monitoring_suggestions: z.array(z.string()).default([]),
  strategy_risk_notes: z.string(),
  confidence_level: confidenceLevelSchema,
  /** 禁止性推断段落（不能从当前结果推出的内容） */
  forbidden_inference_flags: z.array(z.string().min(1)).min(1),
});
export type LlmOutput = z.infer<typeof llmOutputSchema>;

/** LLM 调用追踪（导出文件 14_llm_trace.json） */
export const llmTraceSchema = z.object({
  run_id: z.string().uuid(),
  provider: z.enum(['qwen', 'deepseek']),
  model: z.string().min(1),
  prompt_version: z.string().min(1),
  requested_at: z.string().datetime({ offset: true }),
  completed_at: z.string().datetime({ offset: true }).nullable(),
  /** 调用耗时毫秒 */
  latency_ms: z.number().int().min(0).nullable(),
  status: z.enum(['success', 'timeout', 'failed', 'skipped']),
  /** 失败/超时时保留，供前端重试 */
  error_message: z.string().nullable(),
});
export type LlmTrace = z.infer<typeof llmTraceSchema>;
