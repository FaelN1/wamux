import type { ProviderCache, ProviderContext } from '../src/providers/provider.interface';

/** SessionStore em memória + contexto mínimo (nenhum adapter faz I/O no construtor). */
export function memoryCtx(
  instanceId: string,
  config: Record<string, unknown> = {},
): ProviderContext & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    instanceId,
    config,
    sessionStore: {
      get: async (_i, k) => store.get(k) ?? null,
      set: async (_i, k, v) => void store.set(k, v),
      getAll: async () => Object.fromEntries(store),
      remove: async (_i, k) => void store.delete(k),
      clear: async () => store.clear(),
    },
    logger: { log() {}, warn() {}, error() {}, debug() {} } as unknown as ProviderContext['logger'],
  };
}

/**
 * `ProviderCache` em memória (o papel do Redis nos testes). Expõe o `Map` cru,
 * o TTL de cada gravação e um interruptor de falha para simular o Redis fora.
 */
export function memoryCache(): ProviderCache & {
  data: Map<string, string>;
  ttls: Map<string, number>;
  failing: boolean;
} {
  const data = new Map<string, string>();
  const ttls = new Map<string, number>();
  const self = {
    data,
    ttls,
    failing: false,
    get: async (key: string) => {
      if (self.failing) throw new Error('redis fora do ar');
      return data.get(key) ?? null;
    },
    set: async (key: string, value: string, ttlSec: number) => {
      if (self.failing) throw new Error('redis fora do ar');
      data.set(key, value);
      ttls.set(key, ttlSec);
    },
    del: async (key: string) => {
      if (self.failing) throw new Error('redis fora do ar');
      data.delete(key);
    },
    clear: async (prefix = '') => {
      if (self.failing) throw new Error('redis fora do ar');
      for (const key of [...data.keys()]) if (key.startsWith(prefix)) data.delete(key);
    },
  };
  return self;
}
