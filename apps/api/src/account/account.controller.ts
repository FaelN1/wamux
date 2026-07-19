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
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyAction } from '@wamux/shared';
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

@ApiTags('Conta / WABA (Cloud)')
@ApiSecurity('apikey')
@Controller('instances/:id/account')
@UseGuards(InstanceApiKeyGuard)
export class AccountController {
  constructor(private readonly svc: AccountService) {}

  @Put('profile')
  @HttpCode(200)
  @RequireScope(ApiKeyAction.SETTING)
  @ApiOperation({ summary: 'Atualiza o perfil de negócio (Cloud). 501 nas outras engines.' })
  async updateProfile(@Param('id') id: string, @Body() dto: UpdateProfileDto) {
    await this.svc.updateProfile(id, dto);
    return { ok: true };
  }

  @Get('phone-numbers')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({ summary: 'Lista os números da WABA (quality/tier/name_status).' })
  phoneNumbers(@Param('id') id: string) {
    return this.svc.listPhoneNumbers(id);
  }

  @Get('phone-number')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({ summary: 'Detalhe do número desta instância.' })
  phoneNumber(@Param('id') id: string) {
    return this.svc.getPhoneNumber(id);
  }

  @Post('request-code')
  @HttpCode(200)
  @RequireScope(ApiKeyAction.SETTING)
  @ApiOperation({ summary: 'Solicita código de verificação (SMS/VOICE).' })
  async requestCode(@Param('id') id: string, @Body() dto: RequestCodeDto) {
    await this.svc.requestCode(id, dto);
    return { ok: true };
  }

  @Post('verify-code')
  @HttpCode(200)
  @RequireScope(ApiKeyAction.SETTING)
  @ApiOperation({ summary: 'Verifica o código recebido.' })
  async verifyCode(@Param('id') id: string, @Body() dto: VerifyCodeDto) {
    await this.svc.verifyCode(id, dto.code);
    return { ok: true };
  }

  @Post('register')
  @HttpCode(200)
  @RequireScope(ApiKeyAction.SETTING)
  @ApiOperation({ summary: 'Registra o número (Cloud) com PIN de 2FA.' })
  async register(@Param('id') id: string, @Body() dto: RegisterNumberDto) {
    await this.svc.register(id, dto);
    return { ok: true };
  }

  @Post('deregister')
  @HttpCode(200)
  @RequireScope(ApiKeyAction.SETTING)
  @ApiOperation({ summary: 'Desfaz o registro do número.' })
  async deregister(@Param('id') id: string) {
    await this.svc.deregister(id);
    return { ok: true };
  }

  @Post('pin')
  @HttpCode(200)
  @RequireScope(ApiKeyAction.SETTING)
  @ApiOperation({ summary: 'Define/altera o PIN de verificação em duas etapas.' })
  async setPin(@Param('id') id: string, @Body() dto: SetPinDto) {
    await this.svc.setPin(id, dto.pin);
    return { ok: true };
  }

  @Get('waba')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({ summary: 'Info da WABA (nome, moeda, review status, país).' })
  waba(@Param('id') id: string) {
    return this.svc.wabaInfo(id);
  }

  @Post('subscribed-apps')
  @HttpCode(200)
  @RequireScope(ApiKeyAction.SETTING)
  @ApiOperation({ summary: 'Subscreve o app do token atual aos webhooks da WABA.' })
  subscribe(@Param('id') id: string) {
    return this.svc.subscribe(id);
  }

  @Get('subscribed-apps')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({ summary: 'Lista os apps subscritos aos webhooks da WABA.' })
  subscribedApps(@Param('id') id: string) {
    return this.svc.subscribedApps(id);
  }

  @Delete('subscribed-apps')
  @RequireScope(ApiKeyAction.SETTING)
  @ApiOperation({ summary: 'Remove a subscrição do app aos webhooks da WABA.' })
  async unsubscribe(@Param('id') id: string) {
    await this.svc.unsubscribe(id);
    return { ok: true };
  }

  @Get('analytics')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({ summary: 'Analytics de mensagens (sent/delivered).' })
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
  @ApiOperation({ summary: 'Analytics de conversas (custo/volume por categoria).' })
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
