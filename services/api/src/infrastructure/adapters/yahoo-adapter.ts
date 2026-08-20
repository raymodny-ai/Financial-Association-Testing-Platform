/**
 * Yahoo Finance 适配器（ADR 001 修订后的 ticker 主力源）。
 *
 * 背景：2026-08 实测 Stooq 启用 JS PoW 反爬，服务端纯 HTTP 不可用；
 * Yahoo chart API 免 key 可用，经同一 DataProvider 契约转正为主力。
 *
 * 保护性约束（沿用 ADR 001 条款 3 精神）：
 * - 请求间隔 ≥ 1s（串行队列，防限流）
 * - 同 ticker + 区间 + 频率 24h 内命中本地缓存
 */
import type { Frequency } from '@platform/schemas';
import { DataAdapterError } from '@platform/shared';
import type { DataProvider, HistoryPanel, HistoryQuery, PanelPoint } from '../../domain/data-provider.js';
import { registerProvider } from '../../domain/provider-registry.js';

const MIN_INTERVAL_MS = 1000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const YAHOO_ENDPOINT = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const SOURCE_VERSION = 'yahoo-chart-v8';

const FREQUENCY_TO_INTERVAL: Record<Frequency, string> = {
  daily: '1d',
  weekly: '1wk',
  monthly: '1mo',
};

type FetchFn = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

interface CacheEntry {
  fetchedAt: number;
  panel: HistoryPanel;
}

let lastRequestAt = 0;
let queue: Promise<unknown> = Promise.resolve();
const cache = new Map<string, CacheEntry>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

function toEpochSeconds(date: string): number {
  return Math.floor(new Date(`${date}T00:00:00Z`).getTime() / 1000);
}

/** Unix 秒 → YYYY-MM-DD（按 UTC 日历日，避免本地时区漂移） */
function toIsoDate(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

function normalize(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

interface YahooChartResponse {
  chart: {
    result: Array<{
      timestamp?: number[];
      indicators?: { quote?: Array<{ open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[]; volume?: (number | null)[] }> };
    }> | null;
    error?: { description?: string } | null;
  };
}

function parsePanel(ticker: string, frequency: Frequency, jsonText: string): PanelPoint[] {
  let payload: YahooChartResponse;
  try {
    payload = JSON.parse(jsonText) as YahooChartResponse;
  } catch {
    throw new DataAdapterError(`Yahoo 返回内容非 JSON（ticker=${ticker}）`);
  }
  const description = payload.chart.error?.description;
  if (description) {
    throw new DataAdapterError(`Yahoo 返回错误：${description}（ticker=${ticker}）`);
  }
  const result = payload.chart.result?.[0];
  if (!result) {
    throw new DataAdapterError(`Yahoo 无数据（ticker=${ticker}）`);
  }
  const quote = result.indicators?.quote?.[0];
  const timestamps = result.timestamp ?? [];
  return timestamps.map((ts, i) => ({
    date: toIsoDate(ts),
    open: normalize(quote?.open?.[i]),
    high: normalize(quote?.high?.[i]),
    low: normalize(quote?.low?.[i]),
    close: normalize(quote?.close?.[i]),
    volume: normalize(quote?.volume?.[i]),
  }));
}

export interface YahooAdapterOptions {
  /** 可注入的 fetch（测试用） */
  fetchFn?: FetchFn;
}

export function createYahooAdapter(options: YahooAdapterOptions = {}): DataProvider {
  const fetchFn: FetchFn = options.fetchFn ?? ((url) => fetch(url));

  async function fetchRemote(ticker: string, query: HistoryQuery): Promise<HistoryPanel> {
    const params = new URLSearchParams({
      period1: String(toEpochSeconds(query.start)),
      // Yahoo 的 period2 为排他上界，+1 天以包含结束日
      period2: String(toEpochSeconds(query.end) + 86400),
      interval: FREQUENCY_TO_INTERVAL[query.frequency],
    });
    const response = await schedule(() =>
      fetchFn(`${YAHOO_ENDPOINT}${encodeURIComponent(ticker)}?${params.toString()}`),
    );
    if (!response.ok) {
      throw new DataAdapterError(`Yahoo 请求失败：HTTP ${response.status}（ticker=${ticker}）`);
    }
    const points = parsePanel(ticker, query.frequency, await response.text());
    return {
      ticker,
      frequency: query.frequency,
      points,
      source: 'yahoo',
      source_version: SOURCE_VERSION,
      fetched_at: new Date().toISOString(),
    };
  }

  return {
    name: 'yahoo',
    async fetchHistory(ticker, query) {
      const key = `${ticker}|${query.start}|${query.end}|${query.frequency}`;
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
export function resetYahooAdapterState(): void {
  cache.clear();
  lastRequestAt = 0;
  queue = Promise.resolve();
}

registerProvider(createYahooAdapter());
