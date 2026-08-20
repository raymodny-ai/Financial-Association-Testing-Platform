/**
 * T16 · LLM 推理服务编排（RED 先行）。
 * runLlmInterpretation：渲染提示词 → 调用客户端（超时/重试）→ 解析校验 JSON
 * → 产出 LlmOutput + LlmTrace（prompt 版本 / 耗时 / 状态）。
 * 约束（prompts/meta.json）：timeoutMs 90000、retryOnFailure、失败不阻塞统计持久化。
 */
import type { LlmContext, LlmOutput } from '@platform/schemas';
import { describe, expect, it } from 'vitest';
import {
  LlmTimeoutError,
  runLlmInterpretation,
  type LlmChatClient,
  type RunLlmOptions,
} from './llm-service.js';

const context: LlmContext = {
  research_question: 'Q',
  research_scope: 'S',
  sample_info: 'I',
  variable_definitions: 'V',
  categorical_key_findings: 'C',
  continuous_key_findings: 'T',
  rolling_key_findings: 'R',
  lag_key_findings: 'L',
  audit_key_findings: 'A',
  global_confidence_flags: [],
  required_answer_sections: ['1. 结论'],
  forbidden_claims: ['不得表述因果'],
};

const validOutput: LlmOutput = {
  executive_conclusion: '结论摘要',
  statistical_interpretation: '统计解释',
  stability_assessment: '稳健性评估',
  data_quality_caveats: '无重大风险',
  market_meaning: '克制表述',
  next_research_steps: ['扩大样本区间'],
  monitoring_suggestions: ['跳点率监控'],
  strategy_risk_notes: '无确定性建议',
  confidence_level: 'medium',
  forbidden_inference_flags: ['不可断言因果'],
};

function fakeClient(
  responses: Array<string | Error>,
): { client: LlmChatClient; calls: Array<{ system: string; user: string }> } {
  const calls: Array<{ system: string; user: string }> = [];
  let index = 0;
  const client: LlmChatClient = {
    async complete(request) {
      calls.push({ system: request.system, user: request.user });
      const r = responses[Math.min(index, responses.length - 1)]!;
      index += 1;
      if (r instanceof Error) throw r;
      return r;
    },
  };
  return { client, calls };
}

function baseOptions(client: LlmChatClient): RunLlmOptions {
  return {
    context,
    systemPrompt: '你是受约束的金融研究解释器。',
    userTemplate: '问题：{{research_question}}',
    promptVersion: 'v1',
    provider: 'qwen',
    model: 'qwen-plus',
    apiKey: 'sk-test',
    baseUrl: 'https://example.invalid/v1',
    client,
  };
}

describe('runLlmInterpretation · 成功路径', () => {
  it('解析合法 JSON 输出并产出 success trace', async () => {
    const { client, calls } = fakeClient([JSON.stringify(validOutput)]);
    const { output, trace } = await runLlmInterpretation(baseOptions(client));
    expect(output).toEqual(validOutput);
    expect(trace.status).toBe('success');
    expect(trace.prompt_version).toBe('v1');
    expect(trace.provider).toBe('qwen');
    expect(trace.model).toBe('qwen-plus');
    expect(trace.error_message).toBeNull();
    expect(trace.latency_ms).toBeGreaterThanOrEqual(0);
    expect(calls[0]!.user).toBe('问题：Q');
    expect(calls[0]!.system).toContain('受约束的金融研究解释器');
  });

  it('剥离 ```json 代码围栏后解析', async () => {
    const fenced = '```json\n' + JSON.stringify(validOutput) + '\n```';
    const { client } = fakeClient([fenced]);
    const { output, trace } = await runLlmInterpretation(baseOptions(client));
    expect(output).toEqual(validOutput);
    expect(trace.status).toBe('success');
  });

  it('输出缺必填字段时 schema 校验拒绝（走失败路径）', async () => {
    const { confidence_level: _omit, ...partial } = validOutput;
    const { client } = fakeClient([JSON.stringify(partial)], );
    const { output, trace } = await runLlmInterpretation({
      ...baseOptions(client),
      retryOnFailure: false,
    });
    expect(output).toBeNull();
    expect(trace.status).toBe('failed');
    expect(trace.error_message).toContain('校验');
  });
});

describe('runLlmInterpretation · 重试与失败', () => {
  it('首次非法 JSON、重试后成功', async () => {
    const { client, calls } = fakeClient(['不是 JSON', JSON.stringify(validOutput)]);
    const { output, trace } = await runLlmInterpretation(baseOptions(client));
    expect(output).toEqual(validOutput);
    expect(trace.status).toBe('success');
    expect(calls).toHaveLength(2);
  });

  it('持续失败：重试一次后 failed，输出 null（不阻塞统计持久化）', async () => {
    const { client, calls } = fakeClient([new Error('502 upstream')]);
    const { output, trace } = await runLlmInterpretation(baseOptions(client));
    expect(output).toBeNull();
    expect(trace.status).toBe('failed');
    expect(trace.error_message).toContain('502');
    expect(calls).toHaveLength(2);
  });

  it('retryOnFailure=false 时仅调用一次', async () => {
    const { client, calls } = fakeClient([new Error('boom')]);
    const { trace } = await runLlmInterpretation({ ...baseOptions(client), retryOnFailure: false });
    expect(trace.status).toBe('failed');
    expect(calls).toHaveLength(1);
  });

  it('超时归类为 timeout 状态', async () => {
    const { client } = fakeClient([new LlmTimeoutError(90000)]);
    const { output, trace } = await runLlmInterpretation({
      ...baseOptions(client),
      retryOnFailure: false,
    });
    expect(output).toBeNull();
    expect(trace.status).toBe('timeout');
  });
});

describe('runLlmInterpretation · 缺密钥降级', () => {
  it('无 API Key 时 skipped，不调用客户端', async () => {
    const { client, calls } = fakeClient([JSON.stringify(validOutput)]);
    const { output, trace } = await runLlmInterpretation({ ...baseOptions(client), apiKey: undefined });
    expect(output).toBeNull();
    expect(trace.status).toBe('skipped');
    expect(trace.error_message).toContain('密钥');
    expect(calls).toHaveLength(0);
  });
});
