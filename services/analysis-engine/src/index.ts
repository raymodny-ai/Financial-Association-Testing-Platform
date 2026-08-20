/**
 * @platform/analysis-engine 包入口
 *
 * 分析引擎公开接口：标准化+离散化管道（T09）+ 卡方族（T10）
 * + 连续变量检验（T11）+ 多重检验校正（T12）+ 滚动窗口分析（T13）
 * + 数据真实性审计（T14）。
 */
export * from './types';
export * from './transform';
export * from './align';
export * from './binning';
export * from './pipeline';
export * from './chi2';
export * from './chi-square';
export * from './chi-square-dataset';
export * from './student-t';
export * from './correlation';
export * from './mutual-information';
export * from './continuous-registry';
export * from './correction';
export * from './rolling';
export * from './audit';
export * from './llm-context';
