/**
 * 极简 CSV 解析器（RFC 4180 子集）。
 * 支持：双引号包裹字段、引号转义（""）、CRLF/LF 行尾、尾部空行。
 * Stooq 下载与用户上传共用，避免引入额外依赖。
 */

/** 解析 CSV 全文为二维字符串数组 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] ?? '';
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }

  // 收尾：非空尾行（避免把末尾换行解析为空行）
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

/** 提取表头列名（首行），空文件或空表头抛错由调用方语义决定 */
export function extractHeaders(text: string): string[] {
  const rows = parseCsv(text);
  const header = rows[0];
  if (!header) return [];
  return header.map((h) => h.trim());
}
