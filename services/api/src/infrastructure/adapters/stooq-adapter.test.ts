/**
 * Stooq 适配器单元测试（mock fetch，不发真实网络请求）。
 * 覆盖：CSV 解析、元数据三字段、No data / HTTP 错误、24h 缓存、≥1s 限速。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { DataAdapterError } from '@platform/shared';
import { createStooqAdapter, resetStooqAdapterState } from './stooq-adapter.js';
import { getProvider } from '../../domain/provider-registry.js';

const STOOQ_CSV = [
  'Date,Open,High,Low,Close,Volume',
  '2024-01-02,4750.0,4770.5,4740.1,4765.3,3200000000',
  '2024-01-03,4766.0,4780.2,4755.9,4778.8,3100000000',
].join('\n');

function mockFetch(body: string, ok = true, status = 200) {
  const calls: string[] = [];
  const fetchFn = async (url: string) => {
    calls.push(url);
    return { ok, status, text: async () => body };
  };
  return { fetchFn, calls };
}

const query = { start: '2024-01-01', end: '2024-01-31', frequency: 'daily' as const };

beforeEach(() => {
  resetStooqAdapterState();
});

describe('createStooqAdapter', () => {
  it('解析 CSV 为标准面板并携带元数据三字段', async () => {
    const { fetchFn, calls } = mockFetch(STOOQ_CSV);
    const adapter = createStooqAdapter({ fetchFn });

    const panel = await adapter.fetchHistory('^SPX', query);

    expect(panel.points).toHaveLength(2);
    expect(panel.points[0]).toEqual({
      date: '2024-01-02',
      open: 4750.0,
      high: 4770.5,
      low: 4740.1,
      close: 4765.3,
      volume: 3200000000,
    });
    expect(panel.source).toBe('stooq');
    expect(panel.source_version).toBeTruthy();
    expect(new Date(panel.fetched_at).toString()).not.toBe('Invalid Date');
    // ticker 小写化 + 压缩日期参数
    expect(calls[0]).toContain('s=%5Espx');
    expect(calls[0]).toContain('d1=20240101');
    expect(calls[0]).toContain('d2=20240131');
    expect(calls[0]).toContain('i=d');
  });

  it('No data 响应抛 DataAdapterError', async () => {
    const adapter = createStooqAdapter({ fetchFn: mockFetch('No data').fetchFn });
    await expect(adapter.fetchHistory('bogus', query)).rejects.toThrow(DataAdapterError);
  });

  it('非 2xx 抛 DataAdapterError 并携带状态码', async () => {
    const adapter = createStooqAdapter({ fetchFn: mockFetch('', false, 503).fetchFn });
    await expect(adapter.fetchHistory('^spx', query)).rejects.toThrow('503');
  });

  it('表头异常抛 DataAdapterError', async () => {
    const adapter = createStooqAdapter({ fetchFn: mockFetch('<html>busy</html>').fetchFn });
    await expect(adapter.fetchHistory('^spx', query)).rejects.toThrow('非预期格式');
  });

  it('24h 内同 ticker+区间命中缓存，不重复请求', async () => {
    const { fetchFn, calls } = mockFetch(STOOQ_CSV);
    const adapter = createStooqAdapter({ fetchFn });

    await adapter.fetchHistory('^spx', query);
    await adapter.fetchHistory('^spx', query);

    expect(calls).toHaveLength(1);
  });

  it('相邻请求间隔 ≥ 1s（限速保护）', async () => {
    const timestamps: number[] = [];
    const fetchFn = async (_url: string) => {
      timestamps.push(Date.now());
      return { ok: true, status: 200, text: async () => STOOQ_CSV };
    };
    const adapter = createStooqAdapter({ fetchFn });

    await adapter.fetchHistory('^spx', query);
    await adapter.fetchHistory('^dji', query); // 不同 ticker，不命中缓存

    expect(timestamps).toHaveLength(2);
    expect(timestamps[1]! - timestamps[0]!).toBeGreaterThanOrEqual(990);
  });
});

describe('provider 注册表', () => {
  it('stooq 已插件式注册', () => {
    expect(getProvider('stooq')).toBeDefined();
    expect(getProvider('nonexistent')).toBeUndefined();
  });
});
