/**
 * @platform/shared · 统一错误类型
 *
 * 网关与各引擎服务共用的错误层级（对齐 Clean Architecture 惯例）：
 * - AppError：应用错误基类，携带 HTTP 语义状态码
 * - ValidationError：输入校验失败（400）
 * - NotFoundError：资源不存在（404）
 * - DataAdapterError：上游数据源适配失败（502）
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(400, message);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(404, message);
    this.name = 'NotFoundError';
  }
}

/** 上游数据源（Stooq / 未来 provider）请求或解析失败 */
export class DataAdapterError extends AppError {
  constructor(message: string) {
    super(502, message);
    this.name = 'DataAdapterError';
  }
}
