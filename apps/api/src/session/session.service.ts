import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SessionStore } from '../providers/provider.types';
import { SessionEntity } from './session.entity';

/**
 * Implementação de `SessionStore` sobre Postgres. Injetada em cada provider
 * (via ProviderContext) para persistir/restaurar as credenciais de auth.
 */
@Injectable()
export class SessionService implements SessionStore {
  constructor(
    @InjectRepository(SessionEntity)
    private readonly repo: Repository<SessionEntity>,
  ) {}

  async get(instanceId: string, key: string): Promise<string | null> {
    const row = await this.repo.findOne({ where: { instanceId, key } });
    return row?.value ?? null;
  }

  async set(instanceId: string, key: string, value: string): Promise<void> {
    // upsert idempotente (chave composta instanceId+key).
    await this.repo.upsert({ instanceId, key, value }, ['instanceId', 'key']);
  }

  async getAll(instanceId: string): Promise<Record<string, string>> {
    const rows = await this.repo.find({ where: { instanceId } });
    return rows.reduce<Record<string, string>>((acc, row) => {
      acc[row.key] = row.value;
      return acc;
    }, {});
  }

  async remove(instanceId: string, key: string): Promise<void> {
    await this.repo.delete({ instanceId, key });
  }

  async clear(instanceId: string): Promise<void> {
    await this.repo.delete({ instanceId });
  }
}
