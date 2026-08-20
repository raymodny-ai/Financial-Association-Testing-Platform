/**
 * apps/web · API 客户端封装
 *
 * 契约一律来自 @platform/schemas（运行时校验 + 编译期类型同源）。
 * G5：工作区归属由服务端 httpOnly Cookie 决定，fetch 一律 credentials: 'include'。
 */
import {
  taskRecordSchema,
  resultTableSchema,
  auditTableSchema,
  exportPanelSchema,
  llmContextSchema,
  llmOutputSchema,
  llmTraceSchema,
  uploadedFileSchema,
  type TaskConfig,
  type TaskRecord,
  type ResultRow,
  type AuditRow,
  type ExportPanel,
  type LlmContext,
  type LlmOutput,
  type LlmTrace,
  type UploadedFile,
} from '@platform/schemas';
import { z } from 'zod';

const API_BASE = '/api';

/** 服务端统一错误出口：{ error: { code, message } }（见 api_gateway error-handler） */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = body as { error?: { code?: string; message?: string } } | null;
    throw new ApiError(
      response.status,
      error?.error?.code ?? 'UnknownError',
      error?.error?.message ?? `请求失败（HTTP ${response.status}）`,
    );
  }
  return body as T;
}

/* ------------------------------------------------------------------ */
/* 任务                                                                */
/* ------------------------------------------------------------------ */

export function createTask(config: TaskConfig): Promise<TaskRecord> {
  return request<TaskRecord>('/tasks', {
    method: 'POST',
    // workspaceId 由服务端以 Cookie 注入并覆盖，客户端值仅占位
    body: JSON.stringify(config),
  }).then((raw) => taskRecordSchema.parse(raw));
}

export function listTasks(): Promise<TaskRecord[]> {
  return request<{ items: unknown[] }>('/tasks').then((raw) =>
    raw.items.map((item) => taskRecordSchema.parse(item)),
  );
}

export interface TaskRunOutcome {
  status: string;
  runId: string;
  resultCount: number;
  auditCount: number;
  llmStatus: LlmTrace['status'];
}

const runOutcomeSchema = z.object({
  status: z.string(),
  runId: z.string().uuid(),
  resultCount: z.number().int().min(0),
  auditCount: z.number().int().min(0),
  llmStatus: z.enum(['success', 'timeout', 'failed', 'skipped']),
});

/** 同步执行全链路分析（MVP：长耗时请求，由调用方展示运行中状态） */
export function runTask(taskId: string): Promise<TaskRunOutcome> {
  return request<unknown>(`/tasks/${taskId}/run`, { method: 'POST' }).then((raw) =>
    runOutcomeSchema.parse(raw),
  );
}

export interface TaskResults {
  task: TaskRecord;
  results: ResultRow[];
  audit: AuditRow[];
  /** 导出面板快照（G4；G4 之前运行的历史任务为 null） */
  panel: ExportPanel | null;
  llm: { context: LlmContext; output: LlmOutput | null; trace: LlmTrace } | null;
}

const taskResultsSchema = z.object({
  task: taskRecordSchema,
  results: resultTableSchema,
  audit: auditTableSchema,
  panel: exportPanelSchema.nullable().default(null),
  llm: z
    .object({
      context: llmContextSchema,
      output: llmOutputSchema.nullable(),
      trace: llmTraceSchema,
    })
    .nullable(),
});

export function getTaskResults(taskId: string): Promise<TaskResults> {
  return request<unknown>(`/tasks/${taskId}/results`).then((raw) =>
    taskResultsSchema.parse(raw),
  );
}

/* ------------------------------------------------------------------ */
/* CSV 上传                                                            */
/* ------------------------------------------------------------------ */

/** 前端以 File.text() 读取原文后原样 POST（文件名走 x-filename 头，URI 编码以兼容中文） */
export async function uploadCsv(file: File): Promise<UploadedFile> {
  const content = await file.text();
  const response = await fetch(`${API_BASE}/files`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'x-filename': encodeURIComponent(file.name),
    },
    body: content,
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = body as { error?: { code?: string; message?: string } } | null;
    throw new ApiError(
      response.status,
      error?.error?.code ?? 'UnknownError',
      error?.error?.message ?? `上传失败（HTTP ${response.status}）`,
    );
  }
  return uploadedFileSchema.parse(body);
}

export function listFiles(): Promise<UploadedFile[]> {
  return request<{ items: unknown[] }>('/files').then((raw) =>
    raw.items.map((item) => uploadedFileSchema.parse(item)),
  );
}
