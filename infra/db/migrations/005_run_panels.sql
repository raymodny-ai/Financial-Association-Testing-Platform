-- 005：导出面板快照（PRD 导出规范 01~05 号文件的数据底座，G4）。
-- 一次运行一份；重跑语义与 result_rows 一致（整体替换，路由层 DELETE+INSERT）。
CREATE TABLE IF NOT EXISTS run_panels (
  task_id UUID PRIMARY KEY REFERENCES tasks (id) ON DELETE CASCADE,
  run_id UUID NOT NULL,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
