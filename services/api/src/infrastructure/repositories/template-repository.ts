/**
 * 分析模板仓储（基础设施层，G6）。
 * 作用域约束与 taskRepository/fileRepository 一致：一切查询以 workspace_id 归属过滤。
 */
import type { TaskConfig } from '@platform/schemas';
import { pool } from '../db.js';

export interface TemplateRow {
  id: string;
  workspace_id: string;
  name: string;
  config: TaskConfig;
  created_at: Date;
}

export const templateRepository = {
  async insert(params: {
    id: string;
    workspaceId: string;
    name: string;
    config: TaskConfig;
  }): Promise<TemplateRow> {
    const { rows } = await pool.query<TemplateRow>(
      `INSERT INTO config_templates (id, workspace_id, name, config)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [params.id, params.workspaceId, params.name, JSON.stringify(params.config)],
    );
    const row = rows[0];
    if (!row) throw new Error('模板插入未返回记录');
    return row;
  },

  async listByWorkspace(workspaceId: string, limit = 100): Promise<TemplateRow[]> {
    const { rows } = await pool.query<TemplateRow>(
      `SELECT * FROM config_templates
       WHERE workspace_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [workspaceId, limit],
    );
    return rows;
  },

  /** 删除并返回是否命中（跨工作区删除视同不存在 → 路由 404） */
  async deleteScoped(id: string, workspaceId: string): Promise<boolean> {
    const result = await pool.query(
      'DELETE FROM config_templates WHERE id = $1 AND workspace_id = $2',
      [id, workspaceId],
    );
    return (result.rowCount ?? 0) > 0;
  },
};
