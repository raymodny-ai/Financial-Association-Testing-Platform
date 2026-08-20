import { describe, expect, it } from 'vitest';
import { AppError, DataAdapterError, NotFoundError, ValidationError } from './errors';

describe('shared errors', () => {
  it('AppError 携带状态码与消息', () => {
    const err = new AppError(500, 'boom');
    expect(err.statusCode).toBe(500);
    expect(err.message).toBe('boom');
    expect(err.name).toBe('AppError');
    expect(err).toBeInstanceOf(Error);
  });

  it('ValidationError 默认 400', () => {
    const err = new ValidationError('bad input');
    expect(err.statusCode).toBe(400);
    expect(err.name).toBe('ValidationError');
    expect(err).toBeInstanceOf(AppError);
  });

  it('NotFoundError 默认 404', () => {
    const err = new NotFoundError('task missing');
    expect(err.statusCode).toBe(404);
    expect(err.name).toBe('NotFoundError');
  });

  it('DataAdapterError 默认 502', () => {
    const err = new DataAdapterError('stooq down');
    expect(err.statusCode).toBe(502);
    expect(err.name).toBe('DataAdapterError');
    expect(err).toBeInstanceOf(AppError);
  });
});
