import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Redis from 'ioredis';
import { Identity, IdentityMode } from '@wamux/shared';
import { IdentityResolver } from '../providers/provider.interface';
import { REDIS_CLIENT } from '../redis/redis.module';
import { IdentityMapEntity } from './identity-map.entity';

function digits(s: string): string {
  return s.replace(/\D/g, '');
}
function normLid(v?: string): string | undefined {
  return v ? (v.includes('@') ? v : `${digits(v)}@lid`) : undefined;
}
function normPn(v?: string): string | undefined {
  return v?.includes('@lid') ? undefined : v;
}
function phoneOf(pnJid?: string): string | undefined {
  return pnJid?.endsWith('@s.whatsapp.net') ? digits(pnJid.split('@')[0]) : undefined;
}
function toIdentity(r: IdentityMapEntity): Identity {
  return {
    lid: r.lid ?? undefined,
    pnJid: r.pnJid ?? undefined,
    phone: r.phone ?? undefined,
    primary: r.primary,
  };
}

/**
 * Resolução LID ↔ PN-JID: DB (fonte da verdade) + cache Redis. Nunca
 * crasha por LID inesperado — devolve identidade parcial e aprende o par depois.
 */
@Injectable()
export class IdentityService implements IdentityResolver {
  private readonly ttlSec = 60 * 60 * 24 * 7;

  constructor(
    @InjectRepository(IdentityMapEntity) private readonly repo: Repository<IdentityMapEntity>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async learn(instanceId: string, seen: Partial<Identity>): Promise<Identity> {
    const lid = normLid(seen.lid);
    const pnJid = normPn(
      seen.pnJid ?? (seen.phone ? `${digits(seen.phone)}@s.whatsapp.net` : undefined),
    );
    const phone = seen.phone ?? phoneOf(pnJid);
    if (!lid && !pnJid) return { primary: 'pn', phone };

    const existing = await this.findRow(instanceId, { lid, pnJid });
    const row = this.repo.create({
      ...(existing ?? { instanceId }),
      lid: lid ?? existing?.lid ?? null,
      pnJid: pnJid ?? existing?.pnJid ?? null,
      phone: phone ?? existing?.phone ?? null,
      primary: (lid ?? existing?.lid) ? 'lid' : 'pn',
    });
    const saved = await this.repo.save(row);
    await this.cache(instanceId, saved);
    return toIdentity(saved);
  }

  async resolve(
    instanceId: string,
    ref: { lid?: string; pnJid?: string; phone?: string },
  ): Promise<Identity> {
    const pnJid = ref.pnJid ?? (ref.phone ? `${digits(ref.phone)}@s.whatsapp.net` : undefined);
    const cached = await this.fromCache(instanceId, { lid: ref.lid, pnJid });
    if (cached) return cached;

    const row = await this.findRow(instanceId, { lid: ref.lid, pnJid });
    if (row) {
      await this.cache(instanceId, row);
      return toIdentity(row);
    }
    return {
      lid: ref.lid,
      pnJid,
      phone: ref.phone ?? phoneOf(pnJid),
      primary: ref.lid && !pnJid ? 'lid' : 'pn',
    };
  }

  dedupKey(id: Identity): string {
    if (id.lid) return `lid:${id.lid}`;
    if (id.pnJid) return `pn:${id.pnJid}`;
    return `phone:${id.phone ?? 'unknown'}`;
  }

  present(id: Identity, mode: IdentityMode): string {
    if (mode === 'lid') return id.lid ?? id.pnJid ?? id.phone ?? '';
    if (mode === 'phone') return id.pnJid ?? id.lid ?? '';
    return id.pnJid ?? id.lid ?? ''; // auto
  }

  // ── infra ──────────────────────────────────────────────────
  private async findRow(instanceId: string, ref: { lid?: string | null; pnJid?: string | null }) {
    const where: Array<Record<string, unknown>> = [];
    if (ref.lid) where.push({ instanceId, lid: ref.lid });
    if (ref.pnJid) where.push({ instanceId, pnJid: ref.pnJid });
    return where.length ? this.repo.findOne({ where }) : null;
  }

  private async cache(instanceId: string, row: IdentityMapEntity): Promise<void> {
    const payload = JSON.stringify(toIdentity(row));
    const multi = this.redis.multi();
    if (row.lid) multi.set(`id:${instanceId}:lid:${row.lid}`, payload, 'EX', this.ttlSec);
    if (row.pnJid) multi.set(`id:${instanceId}:pn:${row.pnJid}`, payload, 'EX', this.ttlSec);
    await multi.exec();
  }

  private async fromCache(
    instanceId: string,
    ref: { lid?: string; pnJid?: string },
  ): Promise<Identity | null> {
    const key = ref.lid
      ? `id:${instanceId}:lid:${ref.lid}`
      : ref.pnJid
        ? `id:${instanceId}:pn:${ref.pnJid}`
        : null;
    if (!key) return null;
    const raw = await this.redis.get(key);
    return raw ? (JSON.parse(raw) as Identity) : null;
  }
}
