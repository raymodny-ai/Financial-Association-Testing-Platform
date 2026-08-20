/**
 * Yahoo Finance 适配器单元测试（mock fetch，不发真实网络请求）。
 * 覆盖：chart API 解析、UTC 日期转换、错误分支、24h 缓存、≥1s 限速。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { DataAdapterError } from '@platform/shared';
import { createYahooAdapter, resetYahooAdapterState } from './yahoo-adapter.js';
// 导入即注册 stooq 休眠插件，供注册表格局断言
import './stooq-adapter.js';
import { getProvider } from '../../domain/provider-registry.js';

/** 模拟真实 chart API 结构：2025-07-01 与 07-02 两根日K */
const YAHOO_JSON = JSON.stringify({
  chart: {
    result: [
      {
        timestamp: [1751328000, 1751414400],
        indicators: {
          quote: [
            {
              open: [6180.5, 6200.1],
              high: [6225.0, 6240.3],
              low: [6170.2, null],
              close: [6198.0, 6220.7],
              volume: [3500000000, null],
            },
          ],
        },
      },
    ],
    error: null,
  },
});

function mockFetch(body: string, ok = true, status = 200) {
  const calls: string[] = [];
  const fetchFn = async (url: string) => {
    calls.push(url);
    return { ok, status, text: async () => body };
  };
  return { fetchFn, calls };
}

const query = { start: '2025-07-01', end: '2025-07-31', frequency: 'daily' as const };

beforeEach(() => {
  resetYahooAdapterState();
});

describe('createYahooAdapter', () => {
  it('解析 chart JSON 为标准面板（UTC 日期 + 元数据三字段 + null 保留）', async () => {
    const { fetchFn, calls } = mockFetch(YAHOO_JSON);
    const adapter = createYahooAdapter({ fetchFn });

    const panel = await adapter.fetchHistory('^GSPC', query);

    expect(panel.points).toHaveLength(2);
    expect(panel.points[0]).toEqual({
      date: '2025-07-01',
      open: 6180.5,
      high: 6225.0,
      low: 6170.2,
      close: 6198.0,
      volume: 3500000000,
    });
    // null 值（缺失列）保留为 null
    expect(panel.points[1]!.low).toBeNull();
    expect(panel.points[1]!.volume).toBeNull();
    expect(panel.source).toBe('yahoo');
    expect(panel.source_version).toBeTruthy();
    // URL：ticker 编码 + period2 含结束日（+1 天排他上界）+ 频率映射
    expect(calls[0]).toContain('chart/%5EGSPC');
    expect(calls[0]).toContain('period1=1751328000');
    expect(calls[0]).toContain(`period2=${1753920000 + 86400}`);
    expect(calls[0]).toContain('interval=1d');
  });

  it('chart.error 描述抛 DataAdapterError', async () => {
    const body = JSON.stringify({
      chart: { result: null, error: { description: 'Invalid input parameters' } },
    });
    const adapter = createYahooAdapter({ fetchFn: mockFetch(body).fetchFn });
    await expect(adapter.fetchHistory('bogus', query)).rejects.toThrow('Invalid input parameters');
  });

  it('非 JSON 响应抛 DataAdapterError', async () => {
    const adapter = createYahooAdapter({ fetchFn: mockFetch('<html>').fetchFn });
    await expect(adapter.fetchHistory('^GSPC', query)).rejects.toThrow(DataAdapterError);
  });

  it('非 2xx 抛 DataAdapterError 并携带状态码', async () => {
    const adapter = createYahooAdapter({ fetchFn: mockFetch('', false, 429).fetchFn });
    await expect(adapter.fetchHistory('^GSPC', query)).rejects.toThrow('429');
  });

  it('24h 内同 ticker+区间命中缓存，不重复请求', async () => {
    const { fetchFn, calls } = mockFetch(YAHOO_JSON);
    const adapter = createYahooAdapter({ fetchFn });

    await adapter.fetchHistory('^GSPC', query);
    await adapter.fetchHistory('^GSPC', query);

    expect(calls).toHaveLength(1);
  });

  it('相邻请求间隔 ≥ 1s（限速保护）', async () => {
    const timestamps: number[] = [];
    const fetchFn = async (_url: string) => {
      timestamps.push(Date.now());
      return { ok: true, status: 200, text: async () => YAHOO_JSON };
    };
    const adapter = createYahooAdapter({ fetchFn });

    await adapter.fetchHistory('^GSPC', query);
    await adapter.fetchHistory('^DJI', query); // 不同 ticker，不命中缓存

    expect(timestamps).toHaveLength(2);
    expect(timestamps[1]! - timestamps[0]!).toBeGreaterThanOrEqual(990);
  });
});

describe('provider 注册表（修订后格局）', () => {
  it('yahoo 主力与 stooq 休眠插件均已注册', () => {
    expect(getProvider('yahoo')).toBeDefined();
    expect(getProvider('stooq')).toBeDefined();
  });
});
