/**
 * @platform/schemas · 任务配置差异与失效域分类（X2，PRD L363）
 *
 * PRD：「在参数变更后，界面应提示哪些结果将失效并需要重新运行。」
 * 复制分析（?clone=<taskId>）以已运行任务配置为基线，向导草稿与其逐域比对，
 * 按影响面分组返回失效域，供前端预览步渲染失效提示。
 *
 * 影响面依据引擎管道：数据面（源/派生/区间/频率/期间）重建整个面板 → 全部失效；
 * 分箱只改离散化 → 状态分布相关结果；检验选项只改结论口径；滚动/滞后/事件/审计
 * 各自独立成批；研究问题与 LLM 配置只影响解读文本，不动统计结果。
 * 项目名与工作区为元数据，不参与失效判定。
 */
import type { TaskConfig } from './task';

/** 参数变更导致的结果失效域 */
export interface InvalidatedImpact {
  /** 受影响的结果域（前端展示用语） */
  scope: string;
  /** 发生变更的参数名（规则表顺序） */
  changed: string[];
}

/** 分组键（返回顺序即此数组顺序：全域优先，LLM 最后） */
const GROUP_ORDER = ['all', 'binning', 'tests', 'rolling', 'lag', 'events', 'audit', 'llm'] as const;
type GroupKey = (typeof GROUP_ORDER)[number];

const GROUP_SCOPES: Record<GroupKey, string> = {
  all: '全部分析结果',
  binning: '分类检验与状态分布相关结果',
  tests: '全部检验的显著性结论与置换 p 值',
  rolling: '滚动窗口结果',
  lag: '滞后分析结果',
  events: '事件关联分析结果',
  audit: '数据审计结论',
  llm: 'LLM 解读',
};

/** 逐域比对规则：分组 + 展示标签 + 取值器（projectName/workspaceId 为元数据，不参与） */
const FIELD_RULES: Array<{ group: GroupKey; label: string; pick: (c: TaskConfig) => unknown }> = [
  { group: 'all', label: '数据源', pick: (c) => c.dataSources },
  { group: 'all', label: '派生序列', pick: (c) => c.derivedSeries },
  { group: 'all', label: '时间范围', pick: (c) => [c.startDate, c.endDate] },
  { group: 'all', label: '频率', pick: (c) => c.frequency },
  { group: 'all', label: '期间划分', pick: (c) => c.periods },
  { group: 'binning', label: '分箱方法', pick: (c) => c.binning },
  { group: 'tests', label: '检验选项', pick: (c) => c.tests },
  { group: 'rolling', label: '滚动窗口配置', pick: (c) => c.rolling },
  { group: 'lag', label: '最大滞后', pick: (c) => c.maxLag },
  { group: 'events', label: '事件标签', pick: (c) => c.events },
  { group: 'audit', label: '审计阈值', pick: (c) => c.audit },
  { group: 'llm', label: '研究问题 / LLM 配置', pick: (c) => [c.researchQuestion ?? '', c.llmModel, c.promptVersion] },
];

/** JSON 序列化深比较（配置均为纯数据，字段顺序经同一契约 parse 后稳定） */
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 比对基线配置与当前配置，返回失效域分组（固定顺序）。
 * 仅元数据变更（项目名等）时返回空数组。
 */
export function diffTaskConfig(baseline: TaskConfig, current: TaskConfig): InvalidatedImpact[] {
  const changedByGroup = new Map<GroupKey, string[]>();
  for (const rule of FIELD_RULES) {
    if (!same(rule.pick(baseline), rule.pick(current))) {
      const labels = changedByGroup.get(rule.group) ?? [];
      labels.push(rule.label);
      changedByGroup.set(rule.group, labels);
    }
  }
  return GROUP_ORDER.filter((g) => changedByGroup.has(g)).map((g) => ({
    scope: GROUP_SCOPES[g],
    changed: changedByGroup.get(g)!,
  }));
}
