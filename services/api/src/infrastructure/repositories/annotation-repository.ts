/**
 * 批注仓储（基础设施层，X4）。
 * 批注以任务为宿主：读写一律以 task_id + workspace_id 双键作用域，
 * 跨工作区访问视同不存在（与任务仓储同口径，防枚举）。
 */
import { pool } from '../db.js';

export interface AnnotationRow {
  id: string;
  task_id: string;
  workspace_id: string;
  content: string;
  created_at: Date;
}

export const annotationRepository = {
  async insert(params: {
    id: string;
    taskId: string;
    workspaceId: string;
    content: string;
  }): Promise<AnnotationRow> {
    const { rows } = await pool.query<AnnotationRow>(
      `INSERT INTO task_annotations (id, task_id, workspace_id, content)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [params.id, params.taskId, params.workspaceId, params.content],
    );
    const row = rows[0];
    if (!row) throw new Error('批注插入未返回记录');
    return row;
  },

  async listByTask(taskId: string, workspaceId: string): Promise<AnnotationRow[]> {
    const { rows } = await pool.query<AnnotationRow>(
      `SELECT * FROM task_annotations
       WHERE task_id = $1 AND workspace_id = $2
       ORDER BY created_at ASC`,
      [taskId, workspaceId],
    );
    return rows;
  },

  /** 作用域删除：不存在或跨工作区返回 false */
  async deleteScoped(id: string, taskId: string, workspaceId: string): Promise<boolean> {
    const result = await pool.query(
      `DELETE FROM task_annotations WHERE id = $1 AND task_id = $2 AND workspace_id = $3`,
      [id, taskId, workspaceId],
    );
    return (result.rowCount ?? 0) > 0;
  },
};
