import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes, createHash } from 'node:crypto';
import { IsNull, Repository } from 'typeorm';
import { ApiKeySummary, CreateApiKeyInput, CreateApiKeyResult } from '@wamux/shared';
import { ApiKeyEntity } from './api-key.entity';

/** SHA-256 hex — determinístico, permite lookup O(1) via índice único sem guardar a key crua. */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

function toSummary(row: ApiKeyEntity): ApiKeySummary {
  return {
    id: row.id,
    label: row.label,
    keyPrefix: row.keyPrefix,
    actions: row.actions,
    kind: row.kind,
    createdAt: row.createdAt.getTime(),
    lastUsedAt: row.lastUsedAt?.getTime(),
    revoked: !!row.revokedAt,
  };
}

/**
 * CRUD + resolução de keys escopadas. Usado pelo `InstanceApiKeyGuard`
 * (resolução) e pelo `ApiKeysController` (gestão, `instances/:id/api-keys`).
 * Ver `docs/api-keys-mcp-handoff.md`.
 */
@Injectable()
export class ApiKeyService {
  constructor(@InjectRepository(ApiKeyEntity) private readonly repo: Repository<ApiKeyEntity>) {}

  /** Key ativa (não revogada) pelo hash — usado no guard pra resolver `actions`. */
  async findActiveByHash(keyHash: string): Promise<ApiKeyEntity | null> {
    return this.repo.findOne({ where: { keyHash, revokedAt: IsNull() } });
  }

  /** Marca uso — best-effort, nunca bloqueia o request por causa disso. */
  async touchLastUsed(id: string): Promise<void> {
    await this.repo.update({ id }, { lastUsedAt: new Date() }).catch(() => undefined);
  }

  /**
   * Cria uma key nova — retorna a key CRUA só desta vez (nunca mais
   * recuperável, mesmo padrão de `InstanceEntity.webhookSecret`).
   */
  async create(instanceId: string, input: CreateApiKeyInput): Promise<CreateApiKeyResult> {
    const raw = `wa_${randomBytes(24).toString('hex')}`; // mesmo formato da key mestra
    const saved = await this.repo.save(
      this.repo.create({
        instanceId,
        keyHash: hashApiKey(raw),
        keyPrefix: raw.slice(0, 8),
        label: input.label,
        actions: input.actions,
        kind: input.kind ?? 'generic',
      }),
    );
    return { ...toSummary(saved), key: raw };
  }

  async list(instanceId: string): Promise<ApiKeySummary[]> {
    const rows = await this.repo.find({ where: { instanceId }, order: { createdAt: 'DESC' } });
    return rows.map(toSummary);
  }

  /** Soft-revoke — mantém a linha (auditoria de que a key existiu), só marca `revokedAt`. */
  async revoke(instanceId: string, id: string): Promise<void> {
    const row = await this.repo.findOne({ where: { id, instanceId } });
    if (!row) throw new NotFoundException('API key não encontrada');
    if (!row.revokedAt) await this.repo.update({ id }, { revokedAt: new Date() });
  }
}
