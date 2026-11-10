import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { ApiKeyAction } from '@wamux/shared';
import { ID_PARAM, OK_SCHEMA } from '../common/openapi';
import { InstanceApiKeyGuard } from '../common/guards/instance-api-key.guard';
import { RequireScope } from '../common/require-scope.decorator';
import { AccountService } from './account.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import {
  RegisterNumberDto,
  RequestCodeDto,
  SetPinDto,
  VerifyCodeDto,
} from './dto/account-actions.dto';
import {
  ConversationAnalyticsQueryDto,
  MessagingAnalyticsQueryDto,
} from './dto/analytics.query.dto';

const csv = (s?: string): string[] | undefined =>
  s
    ? s
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
    : undefined;

// ── Schemas reutilizáveis de resposta (documentam "o que retorna" no OpenAPI) ──

/** Descrição do 501 uniforme lançado quando a engine não é a Cloud (Meta) oficial. */
const NOT_CLOUD =
  'A engine da instância não suporta esta operação (exclusiva da Cloud API oficial da Meta).';

/** Info de um número da WABA (campos brutos da Graph API). */
const PHONE_NUMBER_SCHEMA: SchemaObject = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'phoneNumberId' },
    verified_name: { type: 'string', description: 'nome verificado exibido' },
    display_phone_number: { type: 'string', example: '+55 11 99999-9999' },
    quality_rating: { type: 'string', description: 'GREEN | YELLOW | RED' },
    code_verification_status: { type: 'string' },
    name_status: { type: 'string', description: 'status de aprovação do nome' },
    messaging_limit_tier: { type: 'string', description: 'ex.: TIER_1K, TIER_10K, TIER_100K' },
    throughput: { type: 'object', description: 'nível de throughput do número' },
    platform_type: { type: 'string' },
  },
};

/** Resposta bruta da Graph API para a WABA (GET /waba). */
const WABA_INFO_SCHEMA: SchemaObject = {
  type: 'object',
  description: 'Resposta bruta da Graph API para a WABA.',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    currency: { type: 'string' },
    timezone_id: { type: 'string' },
    account_review_status: { type: 'string' },
    business_verification_status: { type: 'string' },
    country: { type: 'string' },
    message_template_namespace: { type: 'string' },
  },
};

/** Resposta bruta da Graph API de analytics — shape depende de granularidade/filtros. */
const ANALYTICS_SCHEMA: SchemaObject = {
  type: 'object',
  description:
    'Resposta bruta da Graph API (campo analytics/conversation_analytics + id da WABA). ' +
    'O formato interno depende da granularidade e dos filtros aplicados.',
};

@ApiTags('Conta / WABA (Cloud)')
@ApiSecurity('apikey')
@ApiParam(ID_PARAM)
@Controller('instances/:id/account')
@UseGuards(InstanceApiKeyGuard)
export class AccountController {
  constructor(private readonly svc: AccountService) {}

  @Put('profile')
  @HttpCode(200)
  @RequireScope(ApiKeyAction.SETTING)
  @ApiOperation({
    summary: 'Atualiza o perfil de negócio (Cloud)',
    description:
      'Atualiza o perfil de negócio da WABA (about/endereço/descrição/e-mail/vertical/sites/foto). ' +
      'Só os campos presentes são enviados. 501 nas engines não-Cloud.',
  })
  @ApiOkResponse({ description: 'Perfil atualizado.', schema: OK_SCHEMA })
  @ApiResponse({ status: 501, description: NOT_CLOUD })
  async updateProfile(@Param('id') id: string, @Body() dto: UpdateProfileDto) {
    await this.svc.updateProfile(id, dto);
    return { ok: true };
  }

  @Get('phone-numbers')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({
    summary: 'Lista os números da WABA',
    description: 'Lista os números associados à WABA, com quality/tier/name_status.',
  })
  @ApiOkResponse({
    description: 'Números da WABA.',
    schema: { type: 'array', items: PHONE_NUMBER_SCHEMA },
  })
  @ApiResponse({ status: 501, description: NOT_CLOUD })
  phoneNumbers(@Param('id') id: string) {
    return this.svc.listPhoneNumbers(id);
  }

  @Get('phone-number')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({
    summary: 'Detalhe do número desta instância',
    description: 'Retorna os dados do número (phoneNumberId) configurado nesta instância.',
  })
  @ApiOkResponse({ description: 'Dados do número.', schema: PHONE_NUMBER_SCHEMA })
  @ApiResponse({ status: 501, description: NOT_CLOUD })
  phoneNumber(@Param('id') id: string) {
    return this.svc.getPhoneNumber(id);
  }

  @Post('request-code')
  @HttpCode(200)
  @RequireScope(ApiKeyAction.SETTING)
  @ApiOperation({
    summary: 'Solicita código de verificação',
    description: 'Dispara o envio do código de verificação do número por SMS ou voz.',
  })
  @ApiOkResponse({ description: 'Código solicitado.', schema: OK_SCHEMA })
  @ApiResponse({ status: 501, description: NOT_CLOUD })
  async requestCode(@Param('id') id: string, @Body() dto: RequestCodeDto) {
    await this.svc.requestCode(id, dto);
    return { ok: true };
  }

  @Post('verify-code')
  @HttpCode(200)
  @RequireScope(ApiKeyAction.SETTING)
  @ApiOperation({
    summary: 'Verifica o código recebido',
    description: 'Confirma o código enviado por SMS/voz para verificar o número.',
  })
  @ApiOkResponse({ description: 'Código verificado.', schema: OK_SCHEMA })
  @ApiResponse({ status: 501, description: NOT_CLOUD })
  async verifyCode(@Param('id') id: string, @Body() dto: VerifyCodeDto) {
    await this.svc.verifyCode(id, dto.code);
    return { ok: true };
  }

  @Post('register')
  @HttpCode(200)
  @RequireScope(ApiKeyAction.SETTING)
  @ApiOperation({
    summary: 'Registra o número (Cloud)',
    description: 'Registra o número na Cloud API usando o PIN de verificação em duas etapas (2FA).',
  })
  @ApiOkResponse({ description: 'Número registrado.', schema: OK_SCHEMA })
  @ApiResponse({ status: 501, description: NOT_CLOUD })
  async register(@Param('id') id: string, @Body() dto: RegisterNumberDto) {
    await this.svc.register(id, dto);
    return { ok: true };
  }

  @Post('deregister')
  @HttpCode(200)
  @RequireScope(ApiKeyAction.SETTING)
  @ApiOperation({
    summary: 'Desfaz o registro do número',
    description: 'Remove o registro do número na Cloud API.',
  })
  @ApiOkResponse({ description: 'Registro removido.', schema: OK_SCHEMA })
  @ApiResponse({ status: 501, description: NOT_CLOUD })
  async deregister(@Param('id') id: string) {
    await this.svc.deregister(id);
    return { ok: true };
  }

  @Post('pin')
  @HttpCode(200)
  @RequireScope(ApiKeyAction.SETTING)
  @ApiOperation({
    summary: 'Define/altera o PIN de 2FA',
    description: 'Define ou altera o PIN de verificação em duas etapas do número.',
  })
  @ApiOkResponse({ description: 'PIN definido.', schema: OK_SCHEMA })
  @ApiResponse({ status: 501, description: NOT_CLOUD })
  async setPin(@Param('id') id: string, @Body() dto: SetPinDto) {
    await this.svc.setPin(id, dto.pin);
    return { ok: true };
  }

  @Get('waba')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({
    summary: 'Info da WABA',
    description:
      'Dados da WhatsApp Business Account: nome, moeda, review status, país e namespace.',
  })
  @ApiOkResponse({ description: 'Informações da WABA.', schema: WABA_INFO_SCHEMA })
  @ApiResponse({ status: 501, description: NOT_CLOUD })
  waba(@Param('id') id: string) {
    return this.svc.wabaInfo(id);
  }

  @Post('subscribed-apps')
  @HttpCode(200)
  @RequireScope(ApiKeyAction.SETTING)
  @ApiOperation({
    summary: 'Subscreve o app aos webhooks da WABA',
    description: 'Subscreve o app do token atual aos webhooks da WABA.',
  })
  @ApiOkResponse({
    description: 'Resposta bruta da Graph API (tipicamente { success: true }).',
    schema: {
      type: 'object',
      properties: { success: { type: 'boolean', example: true } },
    },
  })
  @ApiResponse({ status: 501, description: NOT_CLOUD })
  subscribe(@Param('id') id: string) {
    return this.svc.subscribe(id);
  }

  @Get('subscribed-apps')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({
    summary: 'Lista os apps subscritos',
    description: 'Lista os apps subscritos aos webhooks da WABA.',
  })
  @ApiOkResponse({
    description: 'Resposta bruta da Graph API — { data: [...] } com os apps subscritos.',
    schema: {
      type: 'object',
      properties: { data: { type: 'array', items: { type: 'object' } } },
    },
  })
  @ApiResponse({ status: 501, description: NOT_CLOUD })
  subscribedApps(@Param('id') id: string) {
    return this.svc.subscribedApps(id);
  }

  @Delete('subscribed-apps')
  @RequireScope(ApiKeyAction.SETTING)
  @ApiOperation({
    summary: 'Remove a subscrição do app',
    description: 'Remove a subscrição do app aos webhooks da WABA.',
  })
  @ApiOkResponse({ description: 'Subscrição removida.', schema: OK_SCHEMA })
  @ApiResponse({ status: 501, description: NOT_CLOUD })
  async unsubscribe(@Param('id') id: string) {
    await this.svc.unsubscribe(id);
    return { ok: true };
  }

  @Get('analytics')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({
    summary: 'Analytics de mensagens',
    description: 'Métricas de mensagens (sent/delivered) da WABA na janela informada.',
  })
  @ApiOkResponse({ description: 'Analytics de mensagens.', schema: ANALYTICS_SCHEMA })
  @ApiResponse({ status: 501, description: NOT_CLOUD })
  analytics(@Param('id') id: string, @Query() q: MessagingAnalyticsQueryDto) {
    return this.svc.analytics(id, {
      start: q.start,
      end: q.end,
      granularity: q.granularity,
      phoneNumbers: csv(q.phoneNumbers),
      productTypes: csv(q.productTypes)?.map(Number),
      countryCodes: csv(q.countryCodes),
    });
  }

  @Get('conversation-analytics')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({
    summary: 'Analytics de conversas',
    description: 'Métricas de conversas (custo/volume por categoria) da WABA na janela informada.',
  })
  @ApiOkResponse({ description: 'Analytics de conversas.', schema: ANALYTICS_SCHEMA })
  @ApiResponse({ status: 501, description: NOT_CLOUD })
  conversationAnalytics(@Param('id') id: string, @Query() q: ConversationAnalyticsQueryDto) {
    return this.svc.conversationAnalytics(id, {
      start: q.start,
      end: q.end,
      granularity: q.granularity,
      metricTypes: csv(q.metricTypes),
      conversationCategories: csv(q.conversationCategories),
      dimensions: csv(q.dimensions),
    });
  }
}
