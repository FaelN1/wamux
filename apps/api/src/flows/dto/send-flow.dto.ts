import { IsIn, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class SendFlowDto {
  @IsString()
  @IsNotEmpty()
  to!: string;

  /** exatamente um de flowId/flowName. */
  @IsOptional()
  @IsString()
  flowId?: string;

  @IsOptional()
  @IsString()
  flowName?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  cta!: string;

  @IsOptional()
  @IsString()
  header?: string;

  @IsString()
  @IsNotEmpty()
  body!: string;

  @IsOptional()
  @IsString()
  footer?: string;

  @IsOptional()
  @IsIn(['published', 'draft'])
  mode?: 'published' | 'draft';

  /** ÚNICO por usuário/sessão (correlação com o nfm_reply). */
  @IsString()
  @IsNotEmpty()
  flowToken!: string;

  @IsOptional()
  @IsIn(['navigate', 'data_exchange'])
  action?: 'navigate' | 'data_exchange';

  /** obrigatório se action=navigate. */
  @IsOptional()
  @IsString()
  screen?: string;

  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  quotedMessageId?: string;
}
