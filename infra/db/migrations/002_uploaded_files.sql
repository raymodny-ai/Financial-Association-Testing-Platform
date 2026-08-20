-- 002_uploaded_files.sql · CSV 上传文件存储（MVP 并列第一入口，ADR 001）
-- 元数据与 uploadedFileSchema 对齐；原文 content 供任务执行期按 columnMapping 解析

CREATE TABLE IF NOT EXISTS uploaded_files (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL,
  filename TEXT NOT NULL,
  columns TEXT[] NOT NULL,
  row_count INT NOT NULL CHECK (row_count >= 1),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_uploaded_files_workspace
  ON uploaded_files (workspace_id, created_at DESC);
