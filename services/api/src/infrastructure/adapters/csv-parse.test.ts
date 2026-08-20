import { describe, expect, it } from 'vitest';
import { extractHeaders, parseCsv } from './csv-parse.js';

describe('parseCsv', () => {
  it('解析基础 CSV（含 CRLF 与尾部空行）', () => {
    const rows = parseCsv('a,b,c\r\n1,2,3\r\n4,5,6\r\n');
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
      ['4', '5', '6'],
    ]);
  });

  it('支持引号字段与引号转义', () => {
    const rows = parseCsv('"名称,含逗号","转义""引号",普通\n1,2,3');
    expect(rows[0]).toEqual(['名称,含逗号', '转义"引号', '普通']);
  });

  it('引号内换行不拆行', () => {
    const rows = parseCsv('a,b\n"多行\n值",2');
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual(['多行\n值', '2']);
  });

  it('空文本返回空数组', () => {
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('\n')).toEqual([]);
  });
});

describe('extractHeaders', () => {
  it('提取并裁剪首行列名', () => {
    expect(extractHeaders(' Date , Close \n2024-01-01,100')).toEqual(['Date', 'Close']);
  });

  it('空文本返回空数组', () => {
    expect(extractHeaders('')).toEqual([]);
  });
});
