/**
 * PostgreSQL 连接池（基础设施层）。
 * 连接串优先取 DATABASE_URL，缺省回退本地开发默认值（见 .env.example）。
 */
import pg from 'pg';

const DEFAULT_DATABASE_URL =
  'postgresql://postgres:PlatformDev2026@127.0.0.1:5432/fap';

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
  max: 10,
});
