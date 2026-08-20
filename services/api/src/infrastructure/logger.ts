/**
 * 最小结构化日志器（T18 定案）。
 * 不引入 pino/winston（ADR 001 极简依赖；外部代码生成工具需密钥，弃用）：
 * JSON 行输出（time/level/msg + 扩展字段），sink 可注入以便测试与未来替换。
 */

export type LogSink = (line: string) => void;

export interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

/** Error 字段序列化为 {message, stack}，避免 JSON.stringify 丢信息 */
function serializeValue(value: unknown): unknown {
  if (value instanceof Error) {
    return { message: value.message, stack: value.stack };
  }
  return value;
}

export function createLogger(sink: LogSink = (line) => console.log(line)): Logger {
  const write = (level: string, msg: string, fields?: Record<string, unknown>): void => {
    const entry: Record<string, unknown> = {
      time: new Date().toISOString(),
      level,
      msg,
    };
    if (fields) {
      for (const [key, value] of Object.entries(fields)) {
        entry[key] = serializeValue(value);
      }
    }
    sink(JSON.stringify(entry));
  };
  return {
    info: (msg, fields) => write('info', msg, fields),
    warn: (msg, fields) => write('warn', msg, fields),
    error: (msg, fields) => write('error', msg, fields),
  };
}
