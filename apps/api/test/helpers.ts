import type { ProviderContext } from '../src/providers/provider.interface';

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
