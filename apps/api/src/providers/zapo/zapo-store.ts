import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { createPostgresStore, ensurePgMigrations } from '@zapo-js/store-postgres';
import { createRedisStore } from '@zapo-js/store-redis';
import { createStore, type WaStore } from 'zapo-js';

/**
 * Store do zapo apoiado na MESMA infra do gateway (Postgres + Redis).
 *
 * O zapo não usa o nosso `SessionStore` (chave/valor por instância): ele tem
 * uma camada de persistência própria, tipada e dividida em domínios (auth,
 * signal, preKey, session, identity, senderKey, appState, privacyToken,
 * messages, threads, contacts). Reimplementar isso sobre o `SessionStore`
 * seria reescrever um `WaStoreBackend` inteiro sem ganho — então apontamos os
 * backends OFICIAIS para a nossa infra, com prefixos próprios para não colidir
 * com as tabelas do TypeORM nem com as chaves do BullMQ/rate-limiter.
 *
 * O isolamento entre instâncias é feito pelo `sessionId` (= instanceId), que
 * é a chave de todos os domínios — daí um único par de conexões e um único
 * `WaStore` compartilhados por todo o processo.
 */

const TABLE_PREFIX = 'zapo_';
const REDIS_PREFIX = 'zapo:';

let pool: Pool | undefined;
let redis: Redis | undefined;
let store: WaStore | undefined;

export interface ZapoDbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  name: string;
}

export interface ZapoRedisConfig {
  host: string;
  port: number;
  password?: string;
}

export interface ZapoStoreConfig {
  db: ZapoDbConfig;
  /** Quando presente E `useRedis`, o estado Signal quente vai para o Redis. */
  redis?: ZapoRedisConfig;
  /**
   * Liga o backend Redis para os domínios criptográficos de alta rotação.
   *
   * DESLIGADO por padrão de propósito. O Redis do WAMux atende rate-limiter,
   * registry e filas — cargas descartáveis, então a instância pode estar sem
   * persistência (AOF/RDB) ou com `maxmemory-policy` que despeja chaves. Perder
   * uma chave de rate-limit não custa nada; perder estado Signal força
   * re-handshake, e perder `auth` desloga o aparelho.
   *
   * Por isso, mesmo LIGADO, `auth` e `appState` **continuam no Postgres**:
   * `auth` é a identidade do pareamento (perder = reparear com QR) e `appState`
   * é caro de ressincronizar. Só vai para o Redis o que se refaz sozinho.
   */
  useRedis?: boolean;
}

/**
 * Todos os domínios de migração do backend Postgres do zapo.
 * `WaPgMigrationDomain`, em `@zapo-js/store-postgres`.
 */
const MIGRATION_DOMAINS = [
  'auth',
  'signal',
  'senderKey',
  'appState',
  'retry',
  'mailbox',
  'participants',
  'deviceList',
  'privacyToken',
  'messageSecret',
] as const;

/**
 * Chave do advisory lock que serializa a criação do schema. Constante
 * arbitrária, só precisa ser estável e não colidir com outros locks nossos.
 */
const MIGRATION_LOCK_KEY = 0x7a61_706f; // "zapo"

/**
 * Cria o schema do zapo de forma segura sob concorrência.
 *
 * Dois problemas justificam este passo em vez de deixar cada store migrar
 * sozinho na primeira query:
 *
 * 1. **Dentro do processo.** Cada `BasePgStore` memoiza a migração no PRÓPRIO
 *    objeto, e os domínios se sobrepõem — `signal` é usado por 4 stores
 *    (identity/preKey/signal/session) e `mailbox` por 3 (contacts/messages/
 *    threads). Uma operação que toca vários domínios de uma vez dispara
 *    migrações simultâneas para as mesmas tabelas.
 * 2. **Entre processos.** O WAMux roda multi-worker; dois workers subindo
 *    juntos migrariam ao mesmo tempo.
 *
 * Em ambos os casos o `CREATE TABLE IF NOT EXISTS` da lib NÃO protege: o
 * Postgres verifica o catálogo e cria em seguida, então duas transações
 * passam pela verificação e a segunda falha com violação de
 * `pg_type_typname_nsp_index`. O advisory lock (que é do banco, não da
 * conexão) fecha as duas janelas.
 */
async function ensureSchema(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    try {
      await ensurePgMigrations(pool, MIGRATION_DOMAINS, TABLE_PREFIX);
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

/**
 * Devolve (e memoiza) o `WaStore` do processo.
 *
 * NÃO ligamos o `cacheLayer` (L1 read-through do zapo): ele é per-process e sem
 * canal de invalidação entre processos, e a doc alerta que dois processos na
 * MESMA `sessionId` corrompem o ratchet do Signal. O `InstanceRegistryService`
 * garante dono único por instância via TTL + heartbeat, o que satisfaria a
 * condição — mas seria um acoplamento silencioso entre duas peças distantes,
 * e uma falha de posse viraria corrupção de sessão em vez de erro visível.
 */
export async function getZapoStore(config: ZapoStoreConfig): Promise<WaStore> {
  if (store) return store;

  const { db, redis: redisCfg, useRedis } = config;

  pool = new Pool({
    host: db.host,
    port: db.port,
    user: db.user,
    password: db.password,
    database: db.name,
  });

  // Cria o schema UMA vez, antes de qualquer store tocar o banco (ver
  // `ensureSchema`). Sem isso, a primeira operação que fala com vários
  // domínios ao mesmo tempo dispara migrações concorrentes e o Postgres
  // devolve `duplicate key value violates unique constraint
  // "pg_type_typname_nsp_index"`.
  await ensureSchema(pool);

  const postgres = createPostgresStore({ pool, tablePrefix: TABLE_PREFIX });

  if (!useRedis || !redisCfg) {
    store = createStore({
      backends: { postgres },
      providers: {
        auth: 'postgres',
        signal: 'postgres',
        preKey: 'postgres',
        session: 'postgres',
        identity: 'postgres',
        senderKey: 'postgres',
        appState: 'postgres',
        privacyToken: 'postgres',
        messages: 'postgres',
        threads: 'postgres',
        contacts: 'postgres',
      },
    });
    return store;
  }

  redis = new Redis({
    host: redisCfg.host,
    port: redisCfg.port,
    ...(redisCfg.password ? { password: redisCfg.password } : {}),
    // O store é caminho quente de envio/recepção: falhar rápido e deixar o
    // erro subir é melhor do que enfileirar comandos numa fila sem limite.
    maxRetriesPerRequest: 3,
  });
  const redisBackend = createRedisStore({ redis, keyPrefix: REDIS_PREFIX });

  store = createStore({
    backends: { postgres, redis: redisBackend },
    providers: {
      // Duráveis — perder = reparear ou ressincronizar tudo.
      auth: 'postgres',
      appState: 'postgres',
      // Quentes e auto-recuperáveis: sessão por peer, prekeys, identidades e
      // sender keys se refazem no próximo handshake com aquele contato.
      signal: 'redis',
      preKey: 'redis',
      session: 'redis',
      identity: 'redis',
      senderKey: 'redis',
      privacyToken: 'redis',
      // Cache de leitura para descriptografar addons (voto de enquete, reação)
      // cuja mensagem-pai chegou noutra conexão — volume alto, fica no banco.
      messages: 'postgres',
      threads: 'postgres',
      contacts: 'postgres',
    },
  });

  return store;
}

/** Fecha as conexões no shutdown do processo. Idempotente. */
export async function closeZapoStore(): Promise<void> {
  const p = pool;
  const r = redis;
  pool = undefined;
  redis = undefined;
  store = undefined;
  await p?.end();
  r?.disconnect();
}
