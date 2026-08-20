/**
 * 提示词资产加载（T16，基础设施层）。
 * 读取仓库根 prompts/：meta.json（版本号，llm_trace 可复现性要求）+
 * system_prompt.txt + user_prompt_template.txt。
 * 定位策略：从当前模块目录向上逐级寻 prompts/meta.json（T20），
 * 开发（tsx src/…）与打包后（tsup dist/…）布局均成立。
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface PromptAssets {
  /** prompt 模板版本（写入 llm_trace.prompt_version） */
  version: string;
  systemPrompt: string;
  userTemplate: string;
}

function findPromptsDir(): URL {
  let dir = new URL('.', import.meta.url);
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = new URL('prompts/meta.json', dir);
    if (existsSync(fileURLToPath(candidate))) return new URL('prompts/', dir);
    dir = new URL('../', dir);
  }
  throw new Error('未找到 prompts/meta.json（自模块目录向上检索 8 级）');
}

/** 默认从仓库根 prompts/ 加载（向上寻路） */
export function loadPromptAssets(promptsDir: URL = findPromptsDir()): PromptAssets {
  const meta = JSON.parse(readFileSync(new URL('meta.json', promptsDir), 'utf-8')) as {
    version: string;
    files: { system: string; userTemplate: string };
  };
  return {
    version: meta.version,
    systemPrompt: readFileSync(new URL(meta.files.system, promptsDir), 'utf-8'),
    userTemplate: readFileSync(new URL(meta.files.userTemplate, promptsDir), 'utf-8'),
  };
}
