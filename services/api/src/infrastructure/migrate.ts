/**
 * 极简 SQL 迁移运行器：按文件名顺序执行 infra/db/migrations/*.sql，
 * 以 schema_migrations 表记录已应用迁移，单条迁移事务内执行。
 *
 * CLI：pnpm --filter @platform/api db:migrate
 * 测试：import { runMigrations } 后直接调用。
 */
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import type pg from 'pg';
import { pool } from './db.js';

/**
 * 仓库根的迁移目录：从当前模块目录向上逐级寻 infra/db/migrations（T20），
 * 开发（tsx src/…）与打包后（tsup dist/…）布局均成立。
 */
function findMigrationsDir(): string {
  let dir = fileURLToPath(new URL('.', import.meta.url));
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(dir, 'infra', 'db', 'migrations');
    if (existsSync(candidate)) return candidate;
    dir = resolve(dir, '..');
  }
  throw new Error('未找到 infra/db/migrations（自模块目录向上检索 8 级）');
}

const MIGRATIONS_DIR = findMigrationsDir();

export async function runMigrations(db: pg.Pool): Promise<string[]> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const applied = new Set<string>(
    (await db.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map(
      (r) => r.name,
    ),
  );

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const newlyApplied: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf-8');
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      newlyApplied.push(file);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  return newlyApplied;
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  try {
    const applied = await runMigrations(pool);
    console.log(
      applied.length > 0 ? `已应用迁移：${applied.join(', ')}` : '无待应用迁移',
    );
  } catch (error) {
    console.error('迁移失败：', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
