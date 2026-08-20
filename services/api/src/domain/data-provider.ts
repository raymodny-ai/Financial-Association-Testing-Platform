/**
 * 统一数据适配器契约（ADR 001 定案条款 2）。
 *
 * - 契约：fetchHistory(ticker, { start, end, frequency }) → 标准研究面板原始列
 * - 每次返回必须携带元数据三字段：source / source_version / fetched_at（可复现性）
 * - provider 以插件式注册（见 registry.ts），未来 Alpha Vantage 等按同契约接入
 */
import type { Frequency } from '@platform/schemas';

/** 标准研究面板的单日原始列（缺失列为 null） */
export interface PanelPoint {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
}

/** fetchHistory 查询参数 */
export interface HistoryQuery {
  start: string;
  end: string;
  frequency: Frequency;
}

/** 统一历史数据面板：原始列 + 可复现性元数据 */
export interface HistoryPanel {
  ticker: string;
  frequency: Frequency;
  points: PanelPoint[];
  /** 数据来源标识（如 stooq） */
  source: string;
  /** 来源接口/格式版本 */
  source_version: string;
  /** 抓取时刻（ISO 8601） */
  fetched_at: string;
}

/** 数据源适配器插件契约 */
export interface DataProvider {
  /** 插件名，与 dataSource.provider 字段对应 */
  readonly name: string;
  fetchHistory(ticker: string, query: HistoryQuery): Promise<HistoryPanel>;
}
