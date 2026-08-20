/**
 * 结果 / 审计 / LLM 产物 / 导出面板仓储（T17 + G4，基础设施层）。
 * 均按 task_id 作用域；重跑语义为整体替换（DELETE + INSERT 同事务 / ON CONFLICT 更新）。
 */
import type { AuditRow, ExportPanel, LlmContext, LlmOutput, LlmTrace, ResultRow } from '@platform/schemas';
import { pool } from '../db.js';

export const resultRepository = {
  /** 重跑替换：旧结果级联清除后整批写入 */
  async replaceForTask(taskId: string, rows: readonly ResultRow[]): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM result_rows WHERE task_id = $1', [taskId]);
      for (const r of rows) {
        await client.query(
          `INSERT INTO result_rows
             (task_id, run_id, test_family, test_name, left_series, right_series,
              window_end, lag, stat_value, p_value_raw, p_value_adjusted,
              effect_size, significant, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [
            taskId,
            r.run_id,
            r.test_family,
            r.test_name,
            r.left_series,
            r.right_series,
            r.window_end,
            r.lag,
            r.stat_value,
            r.p_value_raw,
            r.p_value_adjusted,
            r.effect_size,
            r.significant,
            r.notes,
          ],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  async listByTask(taskId: string): Promise<ResultRow[]> {
    const { rows } = await pool.query<ResultRow>(
      `SELECT run_id, test_family, test_name, left_series, right_series,
              window_end, lag, stat_value, p_value_raw, p_value_adjusted,
              effect_size, significant, notes
       FROM result_rows WHERE task_id = $1
       ORDER BY test_family, test_name, left_series, right_series, lag, window_end NULLS FIRST`,
      [taskId],
    );
    // pg 将 DOUBLE PRECISION 以 number 返回、DATE 以 Date 返回 → 归一为契约字符串
    return rows.map((r) => ({
      ...r,
      window_end: r.window_end === null ? null : new Date(r.window_end as unknown as string).toISOString().slice(0, 10),
    }));
  },
};

export const auditRepository = {
  async replaceForTask(taskId: string, runId: string, rows: readonly AuditRow[]): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM audit_rows WHERE task_id = $1', [taskId]);
      for (const r of rows) {
        await client.query(
          `INSERT INTO audit_rows
             (task_id, run_id, series_alias, missing_value_count, missing_business_days_count,
              duplicate_index_count, stale_run_count, jump_count, max_abs_return_pct,
              adjustment_flag_count, source_match_ratio, audit_status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            taskId,
            runId,
            r.series_alias,
            r.missing_value_count,
            r.missing_business_days_count,
            r.duplicate_index_count,
            r.stale_run_count,
            r.jump_count,
            r.max_abs_return_pct,
            r.adjustment_flag_count,
            r.source_match_ratio,
            r.audit_status,
          ],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  async listByTask(taskId: string): Promise<AuditRow[]> {
    const { rows } = await pool.query<AuditRow>(
      `SELECT series_alias, missing_value_count, missing_business_days_count,
              duplicate_index_count, stale_run_count, jump_count, max_abs_return_pct,
              adjustment_flag_count, source_match_ratio, audit_status
       FROM audit_rows WHERE task_id = $1 ORDER BY series_alias`,
      [taskId],
    );
    return rows;
  },
};

export interface LlmArtifactRow {
  task_id: string;
  run_id: string;
  context: LlmContext;
  output: LlmOutput | null;
  trace: LlmTrace;
}

export const llmArtifactRepository = {
  async save(params: {
    taskId: string;
    runId: string;
    context: LlmContext;
    output: LlmOutput | null;
    trace: LlmTrace;
  }): Promise<void> {
    await pool.query(
      `INSERT INTO llm_artifacts (task_id, run_id, context, output, trace, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (task_id) DO UPDATE
       SET run_id = EXCLUDED.run_id,
           context = EXCLUDED.context,
           output = EXCLUDED.output,
           trace = EXCLUDED.trace,
           updated_at = now()`,
      [
        params.taskId,
        params.runId,
        JSON.stringify(params.context),
        params.output === null ? null : JSON.stringify(params.output),
        JSON.stringify(params.trace),
      ],
    );
  },

  async findByTask(taskId: string): Promise<LlmArtifactRow | null> {
    const { rows } = await pool.query<LlmArtifactRow>(
      'SELECT * FROM llm_artifacts WHERE task_id = $1',
      [taskId],
    );
    return rows[0] ?? null;
  },
};

/** 导出面板快照仓储（G4：run_panels，JSONB 整体存取，重跑替换） */
export const panelRepository = {
  async save(taskId: string, panel: ExportPanel): Promise<void> {
    await pool.query(
      `INSERT INTO run_panels (task_id, run_id, payload, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (task_id) DO UPDATE
       SET run_id = EXCLUDED.run_id,
           payload = EXCLUDED.payload,
           updated_at = now()`,
      [taskId, panel.run_id, JSON.stringify(panel)],
    );
  },

  async findByTask(taskId: string): Promise<ExportPanel | null> {
    const { rows } = await pool.query<{ payload: ExportPanel }>(
      'SELECT payload FROM run_panels WHERE task_id = $1',
      [taskId],
    );
    return rows[0]?.payload ?? null;
  },
};
