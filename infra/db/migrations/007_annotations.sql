-- 007_annotations.sql · 研究批注与收藏（X4，PRD L140/L356）
-- 批注以任务为宿主（级联删除）；收藏为任务本体旗标（无需单独表）

CREATE TABLE IF NOT EXISTS task_annotations (
  id UUID PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  content TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_task_annotations_task
  ON task_annotations (task_id, created_at);

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS favorited BOOLEAN NOT NULL DEFAULT false;
