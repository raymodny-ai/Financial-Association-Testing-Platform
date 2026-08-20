/**
 * apps/web · 客户端导出工具（PRD 导出文件：结果长表 CSV / 审计 CSV / LLM 产物 JSON）
 *
 * 一律浏览器端生成并下载，不经服务端二次加工。
 */

function downloadBlob(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** CSV 单元格转义：含逗号/引号/换行时加引号包裹 */
function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

export function toCsv(headers: readonly string[], rows: readonly (readonly (string | number | boolean | null)[])[]): string {
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) {
    lines.push(
      row
        .map((cell) => csvCell(cell === null ? '' : String(cell)))
        .join(','),
    );
  }
  return lines.join('\n');
}

export function downloadCsv(filename: string, headers: readonly string[], rows: readonly (readonly (string | number | boolean | null)[])[]): void {
  downloadBlob(toCsv(headers, rows), filename, 'text/csv');
}

export function downloadJson(filename: string, value: unknown): void {
  downloadBlob(JSON.stringify(value, null, 2), filename, 'application/json');
}

/** 纯文本/标记语言导出（markdown / html，PRD 13/15 号文件） */
export function downloadText(filename: string, content: string, mime: string): void {
  downloadBlob(content, filename, mime);
}
