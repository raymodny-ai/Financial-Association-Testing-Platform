/**
 * 上传文件仓储（基础设施层）。
 * 与 taskRepository 相同的作用域约束：一切查询以 workspace_id 归属过滤。
 */
import { pool } from '../db.js';

export interface FileRow {
  id: string;
  workspace_id: string;
  filename: string;
  columns: string[];
  row_count: number;
  content: string;
  created_at: Date;
}

export const fileRepository = {
  async insert(params: {
    id: string;
    workspaceId: string;
    filename: string;
    columns: string[];
    rowCount: number;
    content: string;
  }): Promise<FileRow> {
    const { rows } = await pool.query<FileRow>(
      `INSERT INTO uploaded_files (id, workspace_id, filename, columns, row_count, content)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        params.id,
        params.workspaceId,
        params.filename,
        params.columns,
        params.rowCount,
        params.content,
      ],
    );
    const row = rows[0];
    if (!row) throw new Error('文件插入未返回记录');
    return row;
  },

  async listByWorkspace(workspaceId: string, limit = 100): Promise<FileRow[]> {
    const { rows } = await pool.query<FileRow>(
      `SELECT * FROM uploaded_files
       WHERE workspace_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [workspaceId, limit],
    );
    return rows;
  },

  async findByIdScoped(id: string, workspaceId: string): Promise<FileRow | null> {
    const { rows } = await pool.query<FileRow>(
      'SELECT * FROM uploaded_files WHERE id = $1 AND workspace_id = $2',
      [id, workspaceId],
    );
    return rows[0] ?? null;
  },

  /** 工作区作用域删除（X5 数据集管理）：命中返回 true，不存在/跨工作区返回 false */
  async deleteScoped(id: string, workspaceId: string): Promise<boolean> {
    const result = await pool.query(
      'DELETE FROM uploaded_files WHERE id = $1 AND workspace_id = $2',
      [id, workspaceId],
    );
    return (result.rowCount ?? 0) > 0;
  },
};
