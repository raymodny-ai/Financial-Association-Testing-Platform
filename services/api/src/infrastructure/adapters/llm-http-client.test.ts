/**
 * T16 · OpenAI 兼容 HTTP 客户端（RED 先行）。
 * fetch mock 单测：请求形状（URL/Authorization/messages/response_format）、
 * 内容提取、超时（AbortError → LlmTimeoutError）、HTTP 错误 → AppError(502 语义)。
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { LlmTimeoutError } from '../../domain/llm-service.js';
import { openAiCompatibleClient } from './llm-http-client.js';

const request = {
  baseUrl: 'https://example.invalid/v1',
  apiKey: 'sk-test',
  model: 'qwen-plus',
  system: '系统提示',
  user: '用户提示',
  timeoutMs: 1000,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('openAiCompatibleClient', () => {
  it('请求形状：chat/completions + Bearer 鉴权 + JSON 输出约束', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      jsonResponse({ choices: [{ message: { content: '回答' } }] }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const content = await openAiCompatibleClient.complete(request);
    expect(content).toBe('回答');

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://example.invalid/v1/chat/completions');
    const headers = init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk-test');
    const body = JSON.parse(init!.body as string) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
      response_format: { type: string };
    };
    expect(body.model).toBe('qwen-plus');
    expect(body.messages).toEqual([
      { role: 'system', content: '系统提示' },
      { role: 'user', content: '用户提示' },
    ]);
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('AbortError 映射为 LlmTimeoutError', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw abortError;
    }));
    await expect(openAiCompatibleClient.complete(request)).rejects.toBeInstanceOf(LlmTimeoutError);
  });

  it('非 2xx 响应抛出携带状态码的错误', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'quota' }, 429)));
    await expect(openAiCompatibleClient.complete(request)).rejects.toThrow(/429/);
  });

  it('响应缺少 choices 时抛错', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ choices: [] })));
    await expect(openAiCompatibleClient.complete(request)).rejects.toThrow(/choices/);
  });
});
