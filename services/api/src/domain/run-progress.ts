/**
 * P2 · 运行进度注册表（域层）。
 *
 * 长任务异步化后，编排层经 reportProgress 上报当前步骤，
 * 呈现层经 GET /tasks/:id/progress 读取（PRD：运行中状态展示——当前步骤/进度条）。
 * 单实例内存注册表（Render 单服务部署；重启即失效，配合启动清扫兜底）。
 */

/** 固定步骤标签表：编排 10 步 + 路由持久化 1 步，顺序即执行顺序 */
export const RUN_STEPS = [
  '加载数据',
  '标准化与离散化',
  '分类变量检验',
  '连续变量检验',
  '滞后分析',
  '滚动窗口',
  '多重检验校正',
  '数据审计',
  '导出快照',
  'LLM 解读',
  '结果持久化',
] as const;

export interface RunProgress {
  /** 当前步骤序号（0 起） */
  stepIndex: number;
  /** 总步数（= RUN_STEPS 长度） */
  totalSteps: number;
  /** 当前步骤标签（供前端直接展示） */
  stepLabel: string;
  /** 最近上报时间（epoch ms） */
  updatedAt: number;
}

const registry = new Map<string, RunProgress>();

/** 覆盖式上报；越界索引视为编程错误显式抛错 */
export function reportProgress(taskId: string, stepIndex: number): void {
  if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= RUN_STEPS.length) {
    throw new RangeError(`步骤序号越界：${stepIndex}（共 ${RUN_STEPS.length} 步）`);
  }
  registry.set(taskId, {
    stepIndex,
    totalSteps: RUN_STEPS.length,
    stepLabel: RUN_STEPS[stepIndex]!,
    updatedAt: Date.now(),
  });
}

/** 未知任务返回 null（防枚举，不抛错） */
export function getRunProgress(taskId: string): RunProgress | null {
  return registry.get(taskId) ?? null;
}

/** 任务到达终态后清除（不残留） */
export function clearRunProgress(taskId: string): void {
  registry.delete(taskId);
}
