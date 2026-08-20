/**
 * LLM 推理组合入口（T16）。
 * 装配：提示词资产（prompts/）+ 提供方解析（env）+ OpenAI 兼容客户端 + 编排服务。
 * 供任务编排路由调用；永不抛错（降级语义见 runLlmInterpretation）。
 */
import type { LlmContext } from '@platform/schemas';
import { runLlmInterpretation, type LlmRunResult } from '../domain/llm-service.js';
import { openAiCompatibleClient } from './adapters/llm-http-client.js';
import { resolveLlmProvider } from './llm-config.js';
import { loadPromptAssets } from './prompt-assets.js';

export async function interpretContext(
  context: LlmContext,
  model: string,
  runId?: string,
): Promise<LlmRunResult> {
  const assets = loadPromptAssets();
  const provider = resolveLlmProvider(model);
  return runLlmInterpretation({
    context,
    systemPrompt: assets.systemPrompt,
    userTemplate: assets.userTemplate,
    promptVersion: assets.version,
    provider: provider.provider,
    model,
    apiKey: provider.apiKey,
    baseUrl: provider.baseUrl,
    client: openAiCompatibleClient,
    runId,
  });
}
