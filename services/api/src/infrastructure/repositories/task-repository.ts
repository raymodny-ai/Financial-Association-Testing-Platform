/**
 * 任务仓储（基础设施层）。
 * 原始行结构对应 tasks 表；对外方法均以 workspace_id 作用域约束归属。
 */
import type { TaskConfig, TaskStatus } from '@platform/schemas';
import { pool } from '../db.js';

export interface TaskRow {
  id: string;
  workspace_id: string;
  status: TaskStatus;
  config: TaskConfig;
  error_message: string | null;
  /** 收藏旗标（X4）；迁移 007 引入，历史行缺省 false */
  favorited: boolean;
  created_at: Date;
  updated_at: Date;
}

export const taskRepository = {
  async insert(params: {
    id: string;
    workspaceId: string;
    config: TaskConfig;
  }): Promise<TaskRow> {
    const { rows } = await pool.query<TaskRow>(
      `INSERT INTO tasks (id, workspace_id, status, config)
       VALUES ($1, $2, 'queued', $3)
       RETURNING *`,
      [params.id, params.workspaceId, JSON.stringify(params.config)],
    );
    const row = rows[0];
    if (!row) throw new Error('任务插入未返回记录');
    return row;
  },

  async listByWorkspace(workspaceId: string, limit = 100): Promise<TaskRow[]> {
    const { rows } = await pool.query<TaskRow>(
      `SELECT * FROM tasks
       WHERE workspace_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [workspaceId, limit],
    );
    return rows;
  },

  /** 归属作用域查询：跨工作区访问视同不存在（防枚举） */
  async findByIdScoped(id: string, workspaceId: string): Promise<TaskRow | null> {
    const { rows } = await pool.query<TaskRow>(
      'SELECT * FROM tasks WHERE id = $1 AND workspace_id = $2',
      [id, workspaceId],
    );
    return rows[0] ?? null;
  },

  /** 状态机推进（运行编排用）；errorMessage 仅 failed 时有值 */
  async updateStatus(id: string, status: TaskStatus, errorMessage: string | null): Promise<void> {
    await pool.query(
      `UPDATE tasks SET status = $2, error_message = $3, updated_at = now() WHERE id = $1`,
      [id, status, errorMessage],
    );
  },

  /**
   * P2 启动清扫：服务重启后运行中任务不可能继续，置 failed 并注明可重试，
   * 避免任务永久卡在 running（PRD：失败重试）；返回受影响行数。
   */
  async recoverInterrupted(): Promise<number> {
    const result = await pool.query(
      `UPDATE tasks
       SET status = 'failed',
           error_message = '服务重启中断了本次运行，请重新运行',
           updated_at = now()
       WHERE status = 'running'`,
    );
    return result.rowCount ?? 0;
  },

  /** X4 收藏切换（作用域内）；跨工作区或不存在返回 null */
  async setFavorite(id: string, workspaceId: string, favorited: boolean): Promise<boolean | null> {
    const { rows } = await pool.query<Pick<TaskRow, 'favorited'>>(
      `UPDATE tasks SET favorited = $3, updated_at = now()
       WHERE id = $1 AND workspace_id = $2
       RETURNING favorited`,
      [id, workspaceId, favorited],
    );
    return rows[0]?.favorited ?? null;
  },
};
