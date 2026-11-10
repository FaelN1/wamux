import { BadRequestException, Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { zSettingsUpdate } from '@wamux/shared';
import { GlobalApiKeyGuard } from '../common/guards/global-api-key.guard';
import { SettingsService } from './settings.service';
import { SystemInfoService } from './system-info.service';

// ── Schemas (documentam corpo e resposta no OpenAPI) ──

/** Configurações efetivas (WamuxSettings). */
const SETTINGS_SCHEMA: SchemaObject = {
  type: 'object',
  properties: {
    rateLimit: {
      type: 'object',
      description: 'rate limit de envio por instância (token bucket)',
      properties: { perSec: { type: 'number' }, burst: { type: 'number' } },
    },
    webhookGlobal: {
      type: 'object',
      description: 'webhook padrão para instâncias sem webhook próprio',
      properties: { enabled: { type: 'boolean' }, url: { type: 'string' } },
    },
    device: {
      type: 'object',
      description: 'identidade em "Aparelhos conectados" (Baileys)',
      properties: { client: { type: 'string' }, browser: { type: 'string' } },
    },
  },
};

/** Corpo do PUT /settings (patch parcial — espelha o zSettingsUpdate). */
const SETTINGS_UPDATE_SCHEMA: SchemaObject = {
  type: 'object',
  description: 'Patch parcial das configurações globais — todos os campos são opcionais.',
  properties: {
    rateLimit: {
      type: 'object',
      properties: {
        perSec: { type: 'number', description: '>0, ≤100' },
        burst: { type: 'number', description: 'inteiro >0, ≤1000' },
      },
    },
    webhookGlobal: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' },
        url: { type: 'string', description: 'URL válida ou string vazia' },
      },
    },
    device: {
      type: 'object',
      properties: {
        client: { type: 'string', description: '1..40 chars' },
        browser: { type: 'string', description: '1..40 chars' },
      },
    },
  },
};

/** Diagnóstico somente-leitura (SystemInfo). */
const SYSTEM_SCHEMA: SchemaObject = {
  type: 'object',
  properties: {
    version: { type: 'string', description: 'versão do gateway' },
    env: { type: 'string', description: 'NODE_ENV' },
    workerId: { type: 'string', description: 'WORKER_ID desta réplica' },
    services: {
      type: 'array',
      description: 'estado observado de cada dependência',
      items: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            enum: ['postgres', 'redis', 'rabbitmq', 'whatsmeow', 'ffmpeg'],
          },
          status: { type: 'string', enum: ['up', 'down', 'unknown'] },
          detail: { type: 'string', description: 'versão quando up, motivo quando down' },
        },
      },
    },
    persistence: {
      type: 'object',
      description: 'flags DATABASE_SAVE_* (só leitura — mudam por .env)',
      properties: {
        contacts: { type: 'boolean' },
        newMessage: { type: 'boolean' },
        messageUpdate: { type: 'boolean' },
        storeMediaBody: { type: 'boolean' },
        retentionDays: { type: 'number', description: '0 = sem expurgo' },
      },
    },
    media: { type: 'object', properties: { maxSizeMb: { type: 'number' } } },
  },
};

@ApiTags('Configurações')
@ApiSecurity('apikey')
@Controller('settings')
@UseGuards(GlobalApiKeyGuard)
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly system: SystemInfoService,
  ) {}

  @Get('system')
  @ApiOperation({
    summary: 'Diagnóstico do gateway (somente leitura)',
    description:
      'Versão, ambiente, flags de persistência e estado das dependências (postgres, redis, ' +
      'rabbitmq, sidecar whatsmeow, ffmpeg). Distinto de /health, que é probe de orquestrador: ' +
      'aqui entram dependências cuja ausência degrada funcionalidades sem derrubar a API.',
  })
  @ApiOkResponse({ schema: SYSTEM_SCHEMA })
  getSystem() {
    return this.system.get();
  }

  @Get()
  @ApiOperation({
    summary: 'Configurações globais efetivas',
    description: 'Defaults do .env mesclados com os overrides do painel. Requer a GLOBAL_API_KEY.',
  })
  @ApiOkResponse({ schema: SETTINGS_SCHEMA })
  get() {
    return this.settings.get();
  }

  @Put()
  @ApiOperation({
    summary: 'Atualiza as configurações globais',
    description:
      'Patch parcial validado por Zod (zSettingsUpdate). Retorna as configurações efetivas.',
  })
  @ApiBody({ schema: SETTINGS_UPDATE_SCHEMA })
  @ApiOkResponse({ schema: SETTINGS_SCHEMA })
  async update(@Body() body: unknown) {
    const parsed = zSettingsUpdate.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      );
    }
    return this.settings.update(parsed.data);
  }
}
