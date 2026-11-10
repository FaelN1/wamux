import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { Pool } from 'pg';
import { ensurePgMigrations } from '@zapo-js/store-postgres';

/**
 * Criação do schema do zapo sob concorrência.
 *
 * O backend Postgres do zapo cria as tabelas com `CREATE TABLE IF NOT EXISTS`,
 * que **não** é seguro sob concorrência: o Postgres consulta o catálogo e cria
 * em seguida, então duas transações passam pela verificação e a segunda estoura
 * com `duplicate key value violates unique constraint "pg_type_typname_nsp_index"`.
 *
 * Isso não é teórico — derrubou uma troca de engine whatsmeow → zapo em
 * produção. Duas coisas tornam a corrida fácil de disparar:
 *
 * - os domínios de migração se **sobrepõem** (`signal` atende 4 stores,
 *   `mailbox` atende 3) e cada `BasePgStore` memoiza a migração no PRÓPRIO
 *   objeto, então uma operação que toca vários domínios migra em paralelo;
 * - o WAMux é multi-worker, então dois processos podem migrar ao mesmo tempo.
 *
 * Requer um Postgres real. Sem `ZAPO_TEST_PG_URL` o teste é pulado, para o
 * `pnpm test` continuar rodando sem serviço externo:
 *
 *   docker run -d --name pg -e POSTGRES_PASSWORD=test -e POSTGRES_USER=test \
 *     -e POSTGRES_DB=zapotest -p 55432:5432 postgres:16-alpine
 *   ZAPO_TEST_PG_URL=postgres://test:test@localhost:55432/zapotest pnpm test
 */

const PG_URL = process.env.ZAPO_TEST_PG_URL;

/** Domínios que compartilham tabelas — é onde a corrida acontece. */
const SOBREPOSTOS = ['signal', 'signal', 'signal', 'signal', 'mailbox', 'mailbox', 'mailbox'];

const LOCK_KEY = 0x7a61_706f;

describe(
  'schema do zapo sob concorrência',
  { skip: !PG_URL ? 'defina ZAPO_TEST_PG_URL' : false },
  () => {
    it('migrações concorrentes sem lock quebram no catálogo do Postgres', async () => {
      // Documenta a limitação a montante: se um dia a lib passar a serializar
      // sozinha, este teste falha e o advisory lock vira redundante.
      const pool = new Pool({ connectionString: PG_URL });
      try {
        await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
        await assert.rejects(
          () =>
            Promise.all(SOBREPOSTOS.map((d) => ensurePgMigrations(pool, [d as never], 'race_'))),
          /pg_type_typname_nsp_index|duplicate key/,
          'a lib deveria continuar sem proteção contra migração concorrente',
        );
      } finally {
        await pool.end();
      }
    });

    it('com advisory lock as mesmas migrações concorrentes passam', async () => {
      const pool = new Pool({ connectionString: PG_URL });
      try {
        await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');

        const comLock = async (dominio: string) => {
          const client = await pool.connect();
          try {
            await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
            try {
              await ensurePgMigrations(pool, [dominio as never], 'lock_');
            } finally {
              await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
            }
          } finally {
            client.release();
          }
        };

        await Promise.all(SOBREPOSTOS.map(comLock));
      } finally {
        await pool.end();
      }
    });
  },
);
