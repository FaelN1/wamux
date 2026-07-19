/**
 * API keys com escopo granular, por instância — opt-in, em cima do modelo
 * atual (GLOBAL_API_KEY admin + 1 key mestra por instância, retrocompatível
 * e inalterado). Ver `docs/api-keys-mcp-handoff.md`.
 */
import { ApiKeyAction } from './enums';

/** Linha da lista de keys — nunca carrega a key crua. */
export interface ApiKeySummary {
  id: string;
  label: string;
  /** primeiros 8 chars da key — só pra reconhecer, nunca a key inteira. */
  keyPrefix: string;
  actions: ApiKeyAction[];
  kind: 'generic' | 'mcp';
  /** unix (ms). */
  createdAt: number;
  lastUsedAt?: number;
  revoked: boolean;
}

/** Resposta do `POST` de criação — a ÚNICA vez que a key crua aparece. */
export interface CreateApiKeyResult extends ApiKeySummary {
  key: string;
}

/** Body do `POST instances/:id/api-keys`. */
export interface CreateApiKeyInput {
  label: string;
  actions: ApiKeyAction[];
  kind?: 'generic' | 'mcp';
}
