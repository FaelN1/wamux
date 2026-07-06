/**
 * Modelo canônico (enums + tipos de mensagem/conexão) vive em `@wamux/shared`,
 * compartilhado entre a API e o painel. Aqui só re-exportamos + adicionamos o
 * `SessionStore`, que é uma abstração interna da API (não faz parte do contrato).
 */
export * from '@wamux/shared';

/**
 * Armazenamento das credenciais de sessão (auth) de um provider.
 * Implementado sobre Postgres (SessionService) e injetado em cada adapter.
 */
export interface SessionStore {
  get(instanceId: string, key: string): Promise<string | null>;
  set(instanceId: string, key: string, value: string): Promise<void>;
  getAll(instanceId: string): Promise<Record<string, string>>;
  remove(instanceId: string, key: string): Promise<void>;
  clear(instanceId: string): Promise<void>;
}
