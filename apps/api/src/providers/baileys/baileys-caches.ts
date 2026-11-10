import type { CacheStore, proto } from 'baileys';
import type { ProviderCache } from '../provider.interface';

/**
 * Caches do adapter Baileys — sem dependência nova e sem timers de expiração
 * (ela é preguiçosa, na leitura/escrita), então nada aqui segura o event loop
 * nem vaza entre reconexões.
 *
 * Tudo tem um nível em memória (L1). O store de retry (`SentMessageStore`) e o
 * contador de retries (`RetryCounterStore`) aceitam ainda um segundo nível (L2)
 * no `ProviderCache` do contexto (Redis), que sobrevive a restart/redeploy e
 * acompanha a instância quando outro worker a assume. Sem L2 — contexto sem
 * `cache`, ou `BAILEYS_RETRY_CACHE_TTL_SEC=0` — vale só a memória do processo.
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

/** Falha de L2 (Redis fora, payload corrompido…): só observabilidade, nunca propaga. */
export type L2ErrorHandler = (op: string, err: unknown) => void;

/** Segundo nível (opcional) dos stores de retry. */
export interface L2Options {
  /** cache compartilhado, já namespaced por instância. Ausente = só memória. */
  cache?: ProviderCache;
  /** validade no L2, em segundos. `0`/ausente = não persiste (só memória). */
  ttlSec?: number;
  onError?: L2ErrorHandler;
  /** teto de espera de uma LEITURA no L2, em ms (default 2s). */
  readTimeoutMs?: number;
}

const L2_READ_TIMEOUT_MS = 2_000;

/**
 * Limita a espera de uma leitura no L2. O cliente Redis enfileira comandos
 * enquanto está desconectado; sem teto, um `getMessage` ficaria pendurado
 * dentro do tratamento de retry do Baileys até o Redis voltar.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout de ${ms}ms no cache`)), ms);
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

/** Normaliza as opções de L2: devolve `undefined` quando não há o que persistir. */
function resolveL2(
  opts: L2Options,
): { cache: ProviderCache; ttlSec: number; readTimeoutMs: number } | undefined {
  const ttlSec = Math.floor(Number(opts.ttlSec ?? 0));
  if (!opts.cache || !(ttlSec > 0)) return undefined;
  return { cache: opts.cache, ttlSec, readTimeoutMs: opts.readTimeoutMs ?? L2_READ_TIMEOUT_MS };
}

const SENT_TTL_MS = 24 * 60 * 60 * 1000;
const SENT_MAX_ENTRIES = 5_000;
const SENT_L2_PREFIX = 'sent:';

/**
 * Codec protobuf da própria lib (`proto.Message`). O módulo ESM do Baileys só
 * existe depois do `loadBaileys()`, por isso o store recebe um getter.
 */
export type MessageCodec = Pick<typeof proto.Message, 'encode' | 'decode'>;

export interface SentMessageStoreOptions extends Partial<TtlLruOptions>, L2Options {
  /** `proto.Message` do runtime; `undefined` enquanto a lib não foi carregada. */
  codec?: () => MessageCodec | undefined;
}

/**
 * Conteúdo (proto) das mensagens que ESTE adapter enviou, para o `getMessage`
 * do socket: quando o destinatário não consegue descriptografar e pede retry,
 * o Baileys precisa do conteúdo original para reenviar — sem isso o retry é
 * respondido vazio e a mensagem fica "Aguardando mensagem" pra sempre.
 *
 * Dois níveis:
 *  - L1: LRU em memória (TTL 24h, 5.000 entradas) — o caminho quente;
 *  - L2 (opcional): `ProviderCache` (Redis). Escrita write-through no
 *    `remember`, leitura só num miss de L1 (`fetch`), remoção no `forget`.
 *    É o que faz um retry ser atendido depois de um restart do processo ou de
 *    a instância migrar de worker.
 *
 * No L2 o conteúdo vai em protobuf (`proto.Message.encode` → base64), não em
 * JSON: `Buffer`/`Long` (mediaKey, fileSha256, fileLength…) não sobrevivem a
 * um `JSON.stringify` e a mensagem reenviada sairia corrompida.
 *
 * Um miss — ou QUALQUER erro de L2/decodificação — devolve `undefined`, nunca
 * uma mensagem vazia (que seria entregue como mensagem em branco). Falha de L2
 * nunca propaga: o envio segue e o store degrada para só-memória.
 *
 * PRIVACIDADE: com L2 ligado o conteúdo das mensagens enviadas fica no Redis
 * pelo TTL configurado (`BAILEYS_RETRY_CACHE_TTL_SEC`; `0` desliga).
 *
 * A chave é só o id: num retry o `remoteJid` pode vir em formato diferente
 * (LID x PN) do que foi usado no envio, e o id já é aleatório por mensagem.
 */
export class SentMessageStore {
  private readonly cache: TtlLruCache<proto.IMessage>;
  private readonly l2?: { cache: ProviderCache; ttlSec: number; readTimeoutMs: number };
  private readonly codec: () => MessageCodec | undefined;
  private readonly onError: L2ErrorHandler;
  /** Sobe a cada forget/clear: uma leitura de L2 em voo não pode "ressuscitar" o que foi apagado. */
  private epoch = 0;

  constructor(opts: SentMessageStoreOptions = {}) {
    this.cache = new TtlLruCache<proto.IMessage>({
      ttlMs: opts.ttlMs ?? SENT_TTL_MS,
      maxEntries: opts.maxEntries ?? SENT_MAX_ENTRIES,
      now: opts.now,
    });
    this.codec = opts.codec ?? (() => undefined);
    this.onError = opts.onError ?? (() => undefined);
    // Sem codec não há como serializar → só memória.
    this.l2 = opts.codec ? resolveL2(opts) : undefined;
  }

  remember(id: string | null | undefined, message: proto.IMessage | null | undefined): void {
    if (!id || !message) return;
    this.cache.set(id, message);
    if (!this.l2) return;
    try {
      const codec = this.codec();
      if (!codec) return;
      const encoded = Buffer.from(codec.encode(message).finish()).toString('base64');
      // Dispara já (sem await): o comando entra na fila do cliente antes de um
      // eventual `del` do forget, e o envio não espera o Redis.
      this.l2.cache
        .set(SENT_L2_PREFIX + id, encoded, this.l2.ttlSec)
        .catch((err: unknown) => this.onError('set', err));
    } catch (err) {
      this.onError('set', err);
    }
  }

  /** Só o L1 (síncrono). Para responder a um retry use `fetch`. */
  get(id: string | null | undefined): proto.IMessage | undefined {
    return id ? this.cache.get(id) : undefined;
  }

  /**
   * L1 e, num miss, L2. É o que o `getMessage` do socket usa. Nunca rejeita:
   * miss, timeout, Redis fora ou payload ilegível → `undefined`.
   */
  async fetch(id: string | null | undefined): Promise<proto.IMessage | undefined> {
    if (!id) return undefined;
    const local = this.cache.get(id);
    if (local || !this.l2) return local;
    const epoch = this.epoch;
    try {
      const codec = this.codec();
      if (!codec) return undefined;
      const raw = await withTimeout(this.l2.cache.get(SENT_L2_PREFIX + id), this.l2.readTimeoutMs);
      // Um remember durante a leitura vence o que veio do L2.
      const fresh = this.cache.get(id);
      if (fresh) return fresh;
      if (!raw) return undefined;
      // Apagada (forget/clear) enquanto a leitura estava em voo → trata como miss.
      if (epoch !== this.epoch) return undefined;
      const decoded = codec.decode(Buffer.from(raw, 'base64'));
      // Payload que decodifica para "nada" não é mensagem: miss, nunca vazio.
      if (!decoded || Object.keys(decoded).length === 0) return undefined;
      this.cache.set(id, decoded);
      return decoded;
    } catch (err) {
      this.onError('get', err);
      return undefined;
    }
  }

  forget(id: string | null | undefined): void {
    if (!id) return;
    this.epoch++;
    this.cache.delete(id);
    if (!this.l2) return;
    try {
      this.l2.cache.del(SENT_L2_PREFIX + id).catch((err: unknown) => this.onError('del', err));
    } catch (err) {
      this.onError('del', err);
    }
  }

  /** Esvazia o L1 e, se houver, tudo desta instância no L2 (logout). */
  clear(): void {
    this.epoch++;
    this.cache.clear();
    if (!this.l2) return;
    try {
      this.l2.cache.clear(SENT_L2_PREFIX).catch((err: unknown) => this.onError('clear', err));
    } catch (err) {
      this.onError('clear', err);
    }
  }

  get size(): number {
    return this.cache.size;
  }
}

const RETRY_L2_PREFIX = 'retry:';

/**
 * `msgRetryCounterCache` com L2: quantas vezes cada mensagem já foi re-tentada.
 * Persistir o contador mantém o teto de retries valendo através de um restart
 * (sem isso um destinatário com sessão quebrada reinicia o ciclo de reenvios a
 * cada redeploy).
 *
 * Só é possível porque o Baileys rc14 faz `await` em todo `get` deste cache
 * (`messages-recv.js`) e o tipo `CacheStore` admite `Promise`. Só valores
 * numéricos vão para o L2 (é o único uso da lib); qualquer outra coisa fica no
 * L1. Erro de L2 = miss: o contador recomeça, exatamente como era só em memória.
 */
export class RetryCounterStore implements CacheStore {
  private readonly l1: MapCacheStore;
  private readonly l2?: { cache: ProviderCache; ttlSec: number; readTimeoutMs: number };
  private readonly onError: L2ErrorHandler;
  private epoch = 0;

  constructor(opts: TtlLruOptions & L2Options) {
    this.l1 = new MapCacheStore(opts);
    this.l2 = resolveL2(opts);
    this.onError = opts.onError ?? (() => undefined);
  }

  /**
   * O tipo `CacheStore` da lib declara `Promise<T>` (sem `undefined`), mas o
   * Baileys trata o miss com `|| 0` — por isso o cast no retorno.
   */
  async get<T>(key: string): Promise<T> {
    return (await this.read(key)) as T;
  }

  private async read(key: string): Promise<unknown> {
    const local = this.l1.get<unknown>(key);
    if (local !== undefined || !this.l2) return local;
    const epoch = this.epoch;
    try {
      const raw = await withTimeout(
        this.l2.cache.get(RETRY_L2_PREFIX + key),
        this.l2.readTimeoutMs,
      );
      // Um set/del local durante a leitura vence o valor (mais velho) do L2.
      const fresh = this.l1.get<unknown>(key);
      if (fresh !== undefined) return fresh;
      if (raw === null || raw === '' || epoch !== this.epoch) return undefined;
      const count = Number(raw);
      if (!Number.isFinite(count)) return undefined;
      this.l1.set(key, count);
      return count;
    } catch (err) {
      this.onError('get', err);
      return undefined;
    }
  }

  // Escritas no L2 são disparadas sem `await`: o Baileys espera o retorno
  // destes métodos dentro do tratamento de retry, e um Redis fora do ar (o
  // cliente enfileira comandos) travaria o reenvio. O L1 já está atualizado.
  set<T>(key: string, value: T): void {
    this.l1.set(key, value);
    if (!this.l2 || typeof value !== 'number' || !Number.isFinite(value)) return;
    try {
      this.l2.cache
        .set(RETRY_L2_PREFIX + key, String(value), this.l2.ttlSec)
        .catch((err: unknown) => this.onError('set', err));
    } catch (err) {
      this.onError('set', err);
    }
  }

  del(key: string): void {
    this.epoch++;
    this.l1.del(key);
    if (!this.l2) return;
    try {
      this.l2.cache.del(RETRY_L2_PREFIX + key).catch((err: unknown) => this.onError('del', err));
    } catch (err) {
      this.onError('del', err);
    }
  }

  /** Esvazia o L1 e dispara a limpeza do L2 (não espera o Redis). */
  flushAll(): void {
    this.epoch++;
    this.l1.flushAll();
    if (!this.l2) return;
    try {
      this.l2.cache.clear(RETRY_L2_PREFIX).catch((err: unknown) => this.onError('clear', err));
    } catch (err) {
      this.onError('clear', err);
    }
  }
}
