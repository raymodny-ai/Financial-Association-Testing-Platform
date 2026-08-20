/**
 * Stooq 适配器（ADR 001 原主力源，现休眠保留）：免 key 的公开 CSV 历史行情。
 *
 * 2026-08 实测：Stooq 启用 JS PoW 反爬（SHA-256 挑战页），服务端纯 HTTP 不可用，
 * 主力已由 yahoo-adapter 接替；本插件保留实现，待上游放松后可直接重新启用。
 *
 * 保护性约束（ADR 001 条款 3）：
 * - 请求间隔 ≥ 1s（串行队列，防封禁）
 * - 同 ticker + 区间 + 频率 24h 内命中本地缓存
 *
 * 上游无 SLA：`No data` / 非 2xx / 表头异常一律抛 DataAdapterError，
 * 由任务编排层记录 failed 状态与 errorMessage。
 */
import type { Frequency } from '@platform/schemas';
import { DataAdapterError } from '@platform/shared';
import type { DataProvider, HistoryPanel, HistoryQuery, PanelPoint } from '../../domain/data-provider.js';
import { registerProvider } from '../../domain/provider-registry.js';
import { parseCsv } from './csv-parse.js';

const MIN_INTERVAL_MS = 1000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const STOOQ_ENDPOINT = 'https://stooq.com/q/d/l/';
const SOURCE_VERSION = 'stooq-csv-daily-v1';

const FREQUENCY_TO_INTERVAL: Record<Frequency, string> = {
  daily: 'd',
  weekly: 'w',
  monthly: 'm',
};

type FetchFn = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

interface CacheEntry {
  fetchedAt: number;
  panel: HistoryPanel;
}

/** 模块级状态：串行队列 + 缓存（进程内，MVP 足够） */
let lastRequestAt = 0;
let queue: Promise<unknown> = Promise.resolve();
const cache = new Map<string, CacheEntry>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 串行调度：保证相邻请求间隔 ≥ MIN_INTERVAL_MS */
function schedule<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    return fn();
  });
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function toCompactDate(date: string): string {
  return date.replace(/-/g, '');
}

function toNumber(raw: string | undefined): number | null {
  if (raw === undefined || raw === '' || raw === 'N/D') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function parsePanel(ticker: string, frequency: Frequency, csvText: string): PanelPoint[] {
  const rows = parseCsv(csvText);
  const header = rows[0];
  if (!header || header.join(',').toLowerCase() !== 'date,open,high,low,close,volume') {
    throw new DataAdapterError(`Stooq 返回内容非预期格式（ticker=${ticker}）`);
  }
  return rows.slice(1).map((r) => ({
    date: r[0] ?? '',
    open: toNumber(r[1]),
    high: toNumber(r[2]),
    low: toNumber(r[3]),
    close: toNumber(r[4]),
    volume: toNumber(r[5]),
  }));
}

export interface StooqAdapterOptions {
  /** 可注入的 fetch（测试用） */
  fetchFn?: FetchFn;
}

export function createStooqAdapter(options: StooqAdapterOptions = {}): DataProvider {
  const fetchFn: FetchFn = options.fetchFn ?? ((url) => fetch(url));

  async function fetchRemote(ticker: string, query: HistoryQuery): Promise<HistoryPanel> {
    const params = new URLSearchParams({
      s: ticker.toLowerCase(),
      i: FREQUENCY_TO_INTERVAL[query.frequency],
      d1: toCompactDate(query.start),
      d2: toCompactDate(query.end),
    });
    const response = await schedule(() => fetchFn(`${STOOQ_ENDPOINT}?${params.toString()}`));
    if (!response.ok) {
      throw new DataAdapterError(`Stooq 请求失败：HTTP ${response.status}（ticker=${ticker}）`);
    }
    const text = (await response.text()).trim();
    if (text.toLowerCase().startsWith('no data')) {
      throw new DataAdapterError(`Stooq 无数据（ticker=${ticker}）`);
    }
    const points = parsePanel(ticker, query.frequency, text);
    return {
      ticker,
      frequency: query.frequency,
      points,
      source: 'stooq',
      source_version: SOURCE_VERSION,
      fetched_at: new Date().toISOString(),
    };
  }

  return {
    name: 'stooq',
    async fetchHistory(ticker, query) {
      const key = `${ticker.toLowerCase()}|${query.start}|${query.end}|${query.frequency}`;
      const cached = cache.get(key);
      if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
        return cached.panel;
      }
      const panel = await fetchRemote(ticker, query);
      cache.set(key, { fetchedAt: Date.now(), panel });
      return panel;
    },
  };
}

/** 测试钩子：清空缓存与节流状态 */
export function resetStooqAdapterState(): void {
  cache.clear();
  lastRequestAt = 0;
  queue = Promise.resolve();
}

registerProvider(createStooqAdapter());
