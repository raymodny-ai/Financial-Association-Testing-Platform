-- 006_config_templates.sql · 分析模板持久化（G6，PRD「配置设计」）
-- TaskConfig 即模板单元；workspace_id 归属约束与 tasks/uploaded_files 同口径

CREATE TABLE IF NOT EXISTS config_templates (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 64),
  config JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_config_templates_workspace
  ON config_templates (workspace_id, created_at DESC);
