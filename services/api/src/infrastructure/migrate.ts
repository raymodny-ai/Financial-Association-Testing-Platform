/**
 * 极简 SQL 迁移运行器：按文件名顺序执行 infra/db/migrations/*.sql，
 * 以 schema_migrations 表记录已应用迁移，单条迁移事务内执行。
 * 并发安全（CI 修复）：会话级 advisory lock 串行化并发 runMigrations
 *（vitest 多测试文件在全新库上并发首跑曾竞态撞 schema_migrations_pkey），
 * 记账 INSERT 附 ON CONFLICT DO NOTHING 双保险。
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

/** advisory lock 键：hashtext('schema_migrations') 固定值，仅用于串行化迁移 */
const MIGRATION_LOCK_KEY = 20260820;

export async function runMigrations(db: pg.Pool): Promise<string[]> {
  const guard = await db.connect();
  try {
    // 会话级锁：并发调用在此排队，锁随 release 前显式释放
    await guard.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);

    await guard.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const applied = new Set<string>(
      (await guard.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map(
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
      try {
        await guard.query('BEGIN');
        await guard.query(sql);
        await guard.query(
          'INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING',
          [file],
        );
        await guard.query('COMMIT');
        newlyApplied.push(file);
      } catch (error) {
        await guard.query('ROLLBACK');
        throw error;
      }
    }
    return newlyApplied;
  } finally {
    await guard.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => {});
    guard.release();
  }
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
