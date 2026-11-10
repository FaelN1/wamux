import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import axios from 'axios';
import type { SystemInfo, SystemService } from '@wamux/shared';
import { REDIS_CLIENT } from '../redis/redis.module';
import { Inject } from '@nestjs/common';
import type Redis from 'ioredis';

/** Um serviço lento não pode travar a tela de Configurações. */
const PROBE_TIMEOUT_MS = 3_000;

/**
 * Diagnóstico somente-leitura da infraestrutura.
 *
 * Deliberadamente separado do `/health`: aquele é probe de orquestrador
 * (precisa ser rápido e decidir de-pé/caiu por postgres+redis), este é
 * diagnóstico para humanos e inclui dependências cuja ausência degrada
 * funcionalidades sem derrubar a API — RabbitMQ, o sidecar Go e o ffmpeg
 * (nota de voz e áudio de chamada).
 */
@Injectable()
export class SystemInfoService {
  private readonly logger = new Logger(SystemInfoService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectDataSource() private readonly db: DataSource,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async get(): Promise<SystemInfo> {
    // Em paralelo: o tempo total é o do probe mais lento, não a soma.
    const services = await Promise.all([
      this.probe('postgres', () => this.checkPostgres()),
      this.probe('redis', () => this.checkRedis()),
      this.probe('rabbitmq', () => this.checkRabbitmq()),
      this.probe('whatsmeow', () => this.checkWhatsmeow()),
      this.probe('ffmpeg', () => this.checkFfmpeg()),
    ]);

    return {
      version: readGatewayVersion(),
      env: this.config.get<string>('nodeEnv') ?? process.env.NODE_ENV ?? 'development',
      workerId: this.config.get<string>('workerId') ?? 'worker-1',
      services,
      persistence: {
        contacts: this.config.get<boolean>('persistence.contacts') ?? false,
        newMessage: this.config.get<boolean>('persistence.newMessage') ?? false,
        messageUpdate: this.config.get<boolean>('persistence.messageUpdate') ?? false,
        storeMediaBody: this.config.get<boolean>('persistence.storeMediaBody') ?? false,
        retentionDays: this.config.get<number>('persistence.retentionDays') ?? 0,
      },
      media: { maxSizeMb: this.config.get<number>('media.maxSizeMb') ?? 100 },
    };
  }

  /** Nunca lança: um probe que falha vira `down` com o motivo. */
  private async probe(
    name: string,
    check: () => Promise<string | undefined>,
  ): Promise<SystemService> {
    try {
      const detail = await withTimeout(check(), PROBE_TIMEOUT_MS);
      return { name, status: 'up', detail };
    } catch (e) {
      const detail = (e as Error).message;
      this.logger.debug(`probe de ${name} falhou: ${detail}`);
      return { name, status: 'down', detail };
    }
  }

  private async checkPostgres(): Promise<string | undefined> {
    const rows = (await this.db.query('SELECT version()')) as Array<{ version?: string }>;
    // "PostgreSQL 16.4 on aarch64…" → "PostgreSQL 16.4"
    return rows?.[0]?.version?.split(' ').slice(0, 2).join(' ');
  }

  private async checkRedis(): Promise<string | undefined> {
    const info = await this.redis.info('server');
    return /redis_version:([^\r\n]+)/.exec(info)?.[1]
      ? `Redis ${/redis_version:([^\r\n]+)/.exec(info)?.[1]}`
      : undefined;
  }

  /**
   * Checa a porta de gestão (HTTP) em vez de abrir uma conexão AMQP: abrir e
   * fechar um canal a cada carregamento da tela seria caro, e o objetivo aqui
   * é só saber se o broker responde.
   */
  private async checkRabbitmq(): Promise<string | undefined> {
    const uri = this.config.get<string>('rabbitmq.uri');
    if (!uri) return undefined;
    const { hostname } = new URL(uri.replace(/^amqps?:/, 'http:'));
    const res = await axios.get(`http://${hostname}:15672/api/overview`, {
      timeout: PROBE_TIMEOUT_MS,
      auth: { username: credential(uri, 'user'), password: credential(uri, 'pass') },
      validateStatus: (s) => s < 500,
    });
    const version = (res.data as { rabbitmq_version?: string })?.rabbitmq_version;
    return version ? `RabbitMQ ${version}` : 'RabbitMQ';
  }

  private async checkWhatsmeow(): Promise<string | undefined> {
    const base = this.config.get<string>('whatsmeow.url');
    if (!base) return undefined;
    await axios.get(`${base}/docs`, {
      timeout: PROBE_TIMEOUT_MS,
      validateStatus: (s) => s < 500,
    });
    return base;
  }

  /** ffmpeg é o que viabiliza nota de voz (ogg/opus) e o áudio das chamadas. */
  private checkFfmpeg(): Promise<string | undefined> {
    return new Promise((resolve, reject) => {
      const proc = spawn('ffmpeg', ['-version']);
      let out = '';
      proc.stdout.on('data', (c: Buffer) => {
        out += c.toString();
      });
      proc.on('error', (e) => reject(new Error(`não encontrado no PATH (${e.message})`)));
      proc.on('close', (code) =>
        code === 0
          ? resolve(/^ffmpeg version (\S+)/.exec(out)?.[1] ?? 'ffmpeg')
          : reject(new Error(`saiu com código ${code}`)),
      );
    });
  }
}

/**
 * Versão vem do package.json da RAIZ (a que o changesets versiona — 2.0.2),
 * não do `apps/api/package.json`, que nunca foi versionado e segue em 0.1.0.
 * O Dockerfile copia a raiz para /app e o CMD roda com WORKDIR=/app, então o
 * caminho relativo resolve tanto na imagem quanto rodando fora dela.
 * `npm_package_version` não serve: só existe sob `npm run`, e o container
 * chama `node` direto.
 */
function readGatewayVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      version?: string;
    };
    return pkg.version ?? 'dev';
  } catch {
    return 'dev';
  }
}

function credential(uri: string, part: 'user' | 'pass'): string {
  try {
    const u = new URL(uri.replace(/^amqps?:/, 'http:'));
    return part === 'user' ? decodeURIComponent(u.username) : decodeURIComponent(u.password);
  } catch {
    return '';
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`sem resposta em ${ms}ms`)), ms).unref(),
    ),
  ]);
}
