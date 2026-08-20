-- 001_init.sql · 金融关联性检验平台初始 schema
-- 字段与 @platform/schemas 契约对齐：taskRecordSchema / resultRowSchema(13) / auditRowSchema(9+归属键)

-- 任务表（配置以 JSONB 存储，入库前经 taskConfigSchema 校验）
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  config JSONB NOT NULL,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tasks_workspace_created
  ON tasks (workspace_id, created_at DESC);

-- 主结果长表（13 字段 + task 归属）
CREATE TABLE IF NOT EXISTS result_rows (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  run_id UUID NOT NULL,
  test_family TEXT NOT NULL
    CHECK (test_family IN ('categorical', 'continuous', 'audit', 'llm')),
  test_name TEXT NOT NULL,
  left_series TEXT NOT NULL,
  right_series TEXT NOT NULL,
  window_end DATE,
  lag INT NOT NULL CHECK (lag >= 0),
  stat_value DOUBLE PRECISION NOT NULL,
  p_value_raw DOUBLE PRECISION NOT NULL
    CHECK (p_value_raw BETWEEN 0 AND 1),
  p_value_adjusted DOUBLE PRECISION NOT NULL
    CHECK (p_value_adjusted BETWEEN 0 AND 1),
  effect_size DOUBLE PRECISION,
  significant BOOLEAN NOT NULL,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_result_rows_task
  ON result_rows (task_id, test_family, test_name);

-- 审计表（9 字段 + 归属键 series_alias + task 归属）
CREATE TABLE IF NOT EXISTS audit_rows (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  run_id UUID NOT NULL,
  series_alias TEXT NOT NULL,
  missing_value_count INT NOT NULL CHECK (missing_value_count >= 0),
  missing_business_days_count INT NOT NULL
    CHECK (missing_business_days_count >= 0),
  duplicate_index_count INT NOT NULL CHECK (duplicate_index_count >= 0),
  stale_run_count INT NOT NULL CHECK (stale_run_count >= 0),
  jump_count INT NOT NULL CHECK (jump_count >= 0),
  max_abs_return_pct DOUBLE PRECISION NOT NULL
    CHECK (max_abs_return_pct >= 0),
  adjustment_flag_count INT NOT NULL CHECK (adjustment_flag_count >= 0),
  source_match_ratio DOUBLE PRECISION NOT NULL
    CHECK (source_match_ratio BETWEEN 0 AND 1),
  audit_status TEXT NOT NULL CHECK (audit_status IN ('pass', 'warn', 'fail'))
);
CREATE INDEX IF NOT EXISTS idx_audit_rows_task ON audit_rows (task_id);
