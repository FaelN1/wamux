import { IsIn, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SendFlowDto {
  @ApiProperty({ description: 'Destinatário (número E.164 ou JID).', example: '5511999999999' })
  @IsString()
  @IsNotEmpty()
  to!: string;

  /** exatamente um de flowId/flowName. */
  @ApiPropertyOptional({
    description: 'ID do Flow a enviar. Exatamente um de flowId/flowName.',
    example: '1234567890',
  })
  @IsOptional()
  @IsString()
  flowId?: string;

  @ApiPropertyOptional({
    description: 'Nome do Flow a enviar. Exatamente um de flowId/flowName.',
    example: 'agendamento_consulta',
  })
  @IsOptional()
  @IsString()
  flowName?: string;

  @ApiProperty({
    description: 'Texto do botão (call-to-action). Máx 30 chars.',
    maxLength: 30,
    example: 'Agendar',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  cta!: string;

  @ApiPropertyOptional({ description: 'Cabeçalho da mensagem.', example: 'Consulta médica' })
  @IsOptional()
  @IsString()
  header?: string;

  @ApiProperty({ description: 'Corpo da mensagem.', example: 'Escolha o melhor horário.' })
  @IsString()
  @IsNotEmpty()
  body!: string;

  @ApiPropertyOptional({ description: 'Rodapé da mensagem.', example: 'Powered by WAMux' })
  @IsOptional()
  @IsString()
  footer?: string;

  @ApiPropertyOptional({
    enum: ['published', 'draft'],
    description: 'Usa a versão publicada ou o rascunho do Flow.',
    example: 'published',
  })
  @IsOptional()
  @IsIn(['published', 'draft'])
  mode?: 'published' | 'draft';

  /** ÚNICO por usuário/sessão (correlação com o nfm_reply). */
  @ApiProperty({
    description: 'Token ÚNICO por usuário/sessão — correlação com o nfm_reply.',
    example: 'flow-token-abc123',
  })
  @IsString()
  @IsNotEmpty()
  flowToken!: string;

  @ApiPropertyOptional({
    enum: ['navigate', 'data_exchange'],
    description: 'Ação do Flow (default navigate).',
    example: 'navigate',
  })
  @IsOptional()
  @IsIn(['navigate', 'data_exchange'])
  action?: 'navigate' | 'data_exchange';

  /** obrigatório se action=navigate. */
  @ApiPropertyOptional({
    description: 'Tela inicial — obrigatório se action=navigate.',
    example: 'WELCOME_SCREEN',
  })
  @IsOptional()
  @IsString()
  screen?: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description: 'Dados iniciais passados à tela. Se presente, não pode ser vazio.',
    example: { userName: 'Maria' },
  })
  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'ID de uma mensagem a citar (reply).',
    example: 'wamid.HBgM...',
  })
  @IsOptional()
  @IsString()
  quotedMessageId?: string;
}
