/**
 * LLM 提供方解析（T16，基础设施层）。
 * 模型名以 deepseek 开头 → deepseek；其余默认 qwen（DashScope compatible-mode）。
 * baseUrl 允许环境变量覆盖（自托管/代理），密钥缺失返回 undefined（编排层 skipped 降级）。
 */
export interface ResolvedLlmProvider {
  provider: 'qwen' | 'deepseek';
  baseUrl: string;
  apiKey: string | undefined;
}

const QWEN_DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DEEPSEEK_DEFAULT_BASE_URL = 'https://api.deepseek.com/v1';

export function resolveLlmProvider(
  model: string,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedLlmProvider {
  if (model.startsWith('deepseek')) {
    return {
      provider: 'deepseek',
      baseUrl: env.LLM_DEEPSEEK_BASE_URL ?? DEEPSEEK_DEFAULT_BASE_URL,
      apiKey: env.DEEPSEEK_API_KEY,
    };
  }
  return {
    provider: 'qwen',
    baseUrl: env.LLM_QWEN_BASE_URL ?? QWEN_DEFAULT_BASE_URL,
    apiKey: env.DASHSCOPE_API_KEY,
  };
}
