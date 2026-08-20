/**
 * LLM 推理服务编排（T16，PRD 模块 K + prompts/meta.json 约束）。
 *
 * 流程：渲染提示词 → 调用注入的 LlmChatClient（OpenAI 兼容协议）→
 * 剥离代码围栏 → JSON.parse → llmOutputSchema 校验 → 产出 LlmOutput + LlmTrace。
 * 约束：timeoutMs 默认 90000；retryOnFailure 默认 true（失败重试一次）；
 * 失败不抛错、不阻塞统计结果持久化（blockStatsPersistenceOnFailure=false），
 * 输出 null + failed/timeout trace；无 API 密钥时 skipped 降级。
 */
import {
  llmOutputSchema,
  type LlmContext,
  type LlmOutput,
  type LlmTrace,
} from '@platform/schemas';
import { randomUUID } from 'node:crypto';
import { renderPrompt } from './prompt-renderer.js';

/** LLM 调用超时（区别于一般网络/服务错误，trace 状态归为 timeout） */
export class LlmTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`LLM 调用超时（${timeoutMs}ms）`);
    this.name = 'LlmTimeoutError';
  }
}

export interface LlmChatRequest {
  baseUrl: string;
  apiKey: string;
  model: string;
  system: string;
  user: string;
  timeoutMs: number;
}

/** LLM 传输契约（基础设施层实现 OpenAI 兼容 HTTP 客户端） */
export interface LlmChatClient {
  complete(request: LlmChatRequest): Promise<string>;
}

export interface RunLlmOptions {
  context: LlmContext;
  systemPrompt: string;
  userTemplate: string;
  promptVersion: string;
  provider: 'qwen' | 'deepseek';
  model: string;
  apiKey: string | undefined;
  baseUrl: string;
  client: LlmChatClient;
  /** 默认 90000（prompts/meta.json constraints.timeoutMs） */
  timeoutMs?: number;
  /** 默认 true（prompts/meta.json constraints.retryOnFailure） */
  retryOnFailure?: boolean;
  runId?: string;
}

export interface LlmRunResult {
  output: LlmOutput | null;
  trace: LlmTrace;
}

/** 剥离 ```json ... ``` 代码围栏（模型常见包装） */
function stripFences(text: string): string {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (match ? match[1]! : text).trim();
}

/** 执行一次 LLM 解释调用（含降级语义），永不抛错 */
export async function runLlmInterpretation(options: RunLlmOptions): Promise<LlmRunResult> {
  const timeoutMs = options.timeoutMs ?? 90_000;
  const retry = options.retryOnFailure ?? true;
  const startedAt = Date.now();
  const base = {
    run_id: options.runId ?? randomUUID(),
    provider: options.provider,
    model: options.model,
    prompt_version: options.promptVersion,
    requested_at: new Date(startedAt).toISOString(),
  };

  if (!options.apiKey) {
    return {
      output: null,
      trace: {
        ...base,
        completed_at: new Date().toISOString(),
        latency_ms: 0,
        status: 'skipped',
        error_message: '未配置 LLM API 密钥，跳过推理（统计结果不受影响）',
      },
    };
  }

  const system = options.systemPrompt;
  const user = renderPrompt(options.userTemplate, options.context);
  const attempts = retry ? 2 : 1;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const raw = await options.client.complete({
        baseUrl: options.baseUrl,
        apiKey: options.apiKey,
        model: options.model,
        system,
        user,
        timeoutMs,
      });
      const parsed: unknown = JSON.parse(stripFences(raw));
      const result = llmOutputSchema.safeParse(parsed);
      if (!result.success) {
        throw new Error(`LLM 输出 schema 校验失败：${result.error.issues[0]?.message ?? '未知字段错误'}`);
      }
      return {
        output: result.data,
        trace: {
          ...base,
          completed_at: new Date().toISOString(),
          latency_ms: Date.now() - startedAt,
          status: 'success',
          error_message: null,
        },
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  return {
    output: null,
    trace: {
      ...base,
      completed_at: new Date().toISOString(),
      latency_ms: Date.now() - startedAt,
      status: lastError instanceof LlmTimeoutError ? 'timeout' : 'failed',
      error_message: lastError?.message ?? '未知错误',
    },
  };
}
