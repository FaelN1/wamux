import type { CacheStore, proto } from 'baileys';

/**
 * Caches em memória do adapter Baileys — sem dependência nova e sem timers
 * (a expiração é preguiçosa, na leitura/escrita), então nada aqui segura o
 * event loop nem vaza entre reconexões.
 *
 * LIMITAÇÃO: tudo aqui vive no processo. Um restart/redeploy (ou a instância
 * migrar de worker) zera os caches — ver a nota em `SentMessageStore`.
 */

interface Entry<V> {
  value: V;
  expiresAt: number;
}

export interface TtlLruOptions {
  /** validade de cada entrada, em ms. */
  ttlMs: number;
  /** teto de entradas; ao estourar, sai a menos recentemente usada. */
  maxEntries: number;
  /** relógio injetável (testes). */
  now?: () => number;
}

/**
 * Map com TTL + teto de entradas. O `Map` preserva a ordem de inserção, então
 * "re-inserir no acesso" dá um LRU aproximado de graça: a primeira chave do
 * iterador é sempre a menos recentemente usada.
 */
export class TtlLruCache<V> {
  private readonly entries = new Map<string, Entry<V>>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(opts: TtlLruOptions) {
    this.ttlMs = opts.ttlMs;
    this.maxEntries = Math.max(1, opts.maxEntries);
    this.now = opts.now ?? Date.now;
  }

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    // "toca" a entrada: vai pro fim da fila de despejo (o TTL NÃO é renovado).
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
    if (this.entries.size > this.maxEntries) this.evict();
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  /** Tira primeiro o que já venceu; se ainda sobrar, despeja as mais antigas. */
  private evict(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}

/**
 * `CacheStore` do Baileys (get/set/del/flushAll) em cima do `TtlLruCache`.
 * Usado para o `msgRetryCounterCache` (que precisa sobreviver à recriação do
 * socket) e como cache do `makeCacheableSignalKeyStore`. Guarda a referência,
 * sem clonar — mesmo comportamento do NodeCache `useClones: false` que o
 * Baileys usa por padrão.
 */
export class MapCacheStore implements CacheStore {
  private readonly cache: TtlLruCache<unknown>;

  constructor(opts: TtlLruOptions) {
    this.cache = new TtlLruCache<unknown>(opts);
  }

  get<T>(key: string): T | undefined {
    return this.cache.get(key) as T | undefined;
  }

  set<T>(key: string, value: T): void {
    this.cache.set(key, value);
  }

  del(key: string): void {
    this.cache.delete(key);
  }

  flushAll(): void {
    this.cache.clear();
  }
}

const SENT_TTL_MS = 24 * 60 * 60 * 1000;
const SENT_MAX_ENTRIES = 5_000;

/**
 * Conteúdo (proto) das mensagens que ESTE adapter enviou, para o `getMessage`
 * do socket: quando o destinatário não consegue descriptografar e pede retry,
 * o Baileys precisa do conteúdo original para reenviar — sem isso o retry é
 * respondido vazio e a mensagem fica "Aguardando mensagem" pra sempre.
 *
 * LIMITAÇÃO (deliberada, sem tabela/dep nova): só memória. Um retry que chegue
 * depois de um restart do processo — ou de mensagem mais velha que o TTL/teto —
 * dá miss e NÃO é reenviado. Um miss devolve `undefined`, nunca uma mensagem
 * vazia (que seria entregue como mensagem em branco).
 *
 * A chave é só o id: num retry o `remoteJid` pode vir em formato diferente
 * (LID x PN) do que foi usado no envio, e o id já é aleatório por mensagem.
 */
export class SentMessageStore {
  private readonly cache: TtlLruCache<proto.IMessage>;

  constructor(opts: Partial<TtlLruOptions> = {}) {
    this.cache = new TtlLruCache<proto.IMessage>({
      ttlMs: opts.ttlMs ?? SENT_TTL_MS,
      maxEntries: opts.maxEntries ?? SENT_MAX_ENTRIES,
      now: opts.now,
    });
  }

  remember(id: string | null | undefined, message: proto.IMessage | null | undefined): void {
    if (!id || !message) return;
    this.cache.set(id, message);
  }

  get(id: string | null | undefined): proto.IMessage | undefined {
    return id ? this.cache.get(id) : undefined;
  }

  forget(id: string | null | undefined): void {
    if (id) this.cache.delete(id);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}
