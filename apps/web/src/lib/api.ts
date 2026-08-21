/**
 * apps/web · API 客户端封装
 *
 * 契约一律来自 @platform/schemas（运行时校验 + 编译期类型同源）。
 * G5：工作区归属由服务端 httpOnly Cookie 决定，fetch 一律 credentials: 'include'。
 */
import {
  taskRecordSchema,
  taskAnnotationSchema,
  resultTableSchema,
  auditTableSchema,
  exportPanelSchema,
  analysisTemplateSchema,
  llmContextSchema,
  llmOutputSchema,
  llmTraceSchema,
  uploadedFileSchema,
  type AnalysisTemplate,
  type TaskAnnotation,
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

/** 单任务查询（G6 复制分析：预填向导需要任务配置） */
export function getTask(taskId: string): Promise<TaskRecord> {
  return request<unknown>(`/tasks/${taskId}`).then((raw) => taskRecordSchema.parse(raw));
}

export interface TaskRunAccepted {
  /** P2：202 受理即返回，后台异步执行，状态经轮询可见 */
  status: 'running';
}

const runAcceptedSchema = z.object({
  status: z.literal('running'),
});

/** 提交运行（异步：202 受理即返回，结果经任务状态/进度轮询获取，P2） */
export function runTask(taskId: string): Promise<TaskRunAccepted> {
  return request<unknown>(`/tasks/${taskId}/run`, { method: 'POST' }).then((raw) =>
    runAcceptedSchema.parse(raw),
  );
}

export interface TaskProgressSnapshot {
  status: TaskRecord['status'];
  /** 运行中才有值；终态后服务端清空为 null */
  progress: {
    stepIndex: number;
    totalSteps: number;
    stepLabel: string;
    updatedAt: number;
  } | null;
}

const taskProgressSchema = z.object({
  status: taskRecordSchema.shape.status,
  progress: z
    .object({
      stepIndex: z.number().int().min(0),
      totalSteps: z.number().int().min(1),
      stepLabel: z.string(),
      updatedAt: z.number(),
    })
    .nullable(),
});

/** 运行进度轮询（P2/X1：当前步骤 + 总步数，驱动进度条） */
export function getTaskProgress(taskId: string): Promise<TaskProgressSnapshot> {
  return request<unknown>(`/tasks/${taskId}/progress`).then((raw) =>
    taskProgressSchema.parse(raw),
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

/** 研究批注列表（X4，PRD L356 右栏「研究注释」） */
export function listAnnotations(taskId: string): Promise<TaskAnnotation[]> {
  return request<{ items: unknown[] }>(`/tasks/${taskId}/annotations`).then((raw) =>
    raw.items.map((item) => taskAnnotationSchema.parse(item)),
  );
}

/** 新增批注（内容 1~2000 字，服务端 trim） */
export function createAnnotation(taskId: string, content: string): Promise<TaskAnnotation> {
  return request<unknown>(`/tasks/${taskId}/annotations`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  }).then((raw) => taskAnnotationSchema.parse(raw));
}

/** 删除批注（204 无响应体） */
export function deleteAnnotation(taskId: string, annotationId: string): Promise<null> {
  return request<null>(`/tasks/${taskId}/annotations/${annotationId}`, { method: 'DELETE' });
}

/** 收藏切换（X4：任务本体旗标，随 taskRecord 回显） */
export function setFavorite(taskId: string, favorited: boolean): Promise<{ favorited: boolean }> {
  return request<unknown>(`/tasks/${taskId}/favorite`, {
    method: 'PUT',
    body: JSON.stringify({ favorited }),
  }).then((raw) => z.object({ favorited: z.boolean() }).parse(raw));
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

/** 删除上传文件（X5 数据集管理；204 无响应体） */
export function deleteFile(fileId: string): Promise<null> {
  return request<null>(`/files/${fileId}`, { method: 'DELETE' });
}

/* ------------------------------------------------------------------ */
/* 分析模板（G6：PRD「保存模板 / 复制分析 / 重新运行同配置」）     */
/* ------------------------------------------------------------------ */

export function listTemplates(): Promise<AnalysisTemplate[]> {
  return request<{ items: unknown[] }>('/templates').then((raw) =>
    raw.items.map((item) => analysisTemplateSchema.parse(item)),
  );
}

export function saveTemplate(name: string, config: TaskConfig): Promise<AnalysisTemplate> {
  return request<unknown>('/templates', {
    method: 'POST',
    body: JSON.stringify({ name, config }),
  }).then((raw) => analysisTemplateSchema.parse(raw));
}

export async function deleteTemplate(templateId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/templates/${templateId}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const error = body as { error?: { code?: string; message?: string } } | null;
    throw new ApiError(
      response.status,
      error?.error?.code ?? 'UnknownError',
      error?.error?.message ?? `删除失败（HTTP ${response.status}）`,
    );
  }
}
