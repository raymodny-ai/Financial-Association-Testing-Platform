-- 003_llm_artifacts.sql · LLM 产物持久化（T17）
-- 对应 PRD 导出文件 12_llm_context.json / 13_llm_conclusion.md / 14_llm_trace.json

CREATE TABLE IF NOT EXISTS llm_artifacts (
  task_id UUID PRIMARY KEY REFERENCES tasks (id) ON DELETE CASCADE,
  run_id UUID NOT NULL,
  -- llmContextSchema 12 字段
  context JSONB NOT NULL,
  -- llmOutputSchema 10 字段；失败/跳过为 NULL
  output JSONB,
  -- llmTraceSchema（prompt 版本 / 模型名 / 时间戳，可复现性要求）
  trace JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
