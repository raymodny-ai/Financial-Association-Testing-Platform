/**
 * OpenAI 兼容 HTTP 客户端（T16，基础设施层）。
 * qwen（DashScope compatible-mode）与 deepseek 均暴露 OpenAI chat/completions 协议，
 * 故统一为单一客户端，按 baseUrl/apiKey/model 注入。
 * AbortError → LlmTimeoutError；非 2xx / 空 choices → AppError(502 语义)。
 */
import { AppError } from '@platform/shared';
import { LlmTimeoutError, type LlmChatClient, type LlmChatRequest } from '../../domain/llm-service.js';

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

export const openAiCompatibleClient: LlmChatClient = {
  async complete(request: LlmChatRequest): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);
    let response: Response;
    try {
      response = await fetch(`${request.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${request.apiKey}`,
        },
        body: JSON.stringify({
          model: request.model,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.user },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.2,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if ((error instanceof Error && error.name === 'AbortError') || controller.signal.aborted) {
        throw new LlmTimeoutError(request.timeoutMs);
      }
      throw new AppError(502, `LLM 请求失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new AppError(502, `LLM 服务返回 HTTP ${response.status}（${request.model}）`);
    }
    const payload = (await response.json()) as ChatCompletionResponse;
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.length === 0) {
      throw new AppError(502, 'LLM 响应缺少 choices[0].message.content');
    }
    return content;
  },
};
