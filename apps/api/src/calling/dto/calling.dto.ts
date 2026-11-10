import { IsIn, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RequestPermissionDto {
  @ApiProperty({
    description: 'Número/wa_id do destinatário a quem pedir permissão de chamada.',
    example: '5511999999999',
  })
  @IsString()
  @IsNotEmpty()
  to!: string;

  @ApiPropertyOptional({
    description: 'Texto opcional exibido na mensagem de pedido de permissão.',
    example: 'Podemos te ligar para finalizar seu atendimento?',
  })
  @IsOptional()
  @IsString()
  text?: string;
}

export class ConnectCallDto {
  @ApiPropertyOptional({
    description: 'Destinatário da chamada (obrigatório na ação business-initiated "connect").',
    example: '5511999999999',
  })
  @IsOptional()
  @IsString()
  to?: string;

  @ApiPropertyOptional({
    description: 'ID da chamada (obrigatório nas ações pre_accept/accept/reject/terminate).',
    example: 'wacid.ABGGH...',
  })
  @IsOptional()
  @IsString()
  callId?: string;

  @ApiProperty({
    enum: ['connect', 'pre_accept', 'accept', 'reject', 'terminate'],
    description: 'Ação do ciclo da chamada.',
    example: 'connect',
  })
  @IsIn(['connect', 'pre_accept', 'accept', 'reject', 'terminate'])
  action!: 'connect' | 'pre_accept' | 'accept' | 'reject' | 'terminate';

  @ApiPropertyOptional({
    type: 'object',
    description: 'SDP WebRTC — offer (connect) ou answer (pre_accept/accept), no formato RFC 8866.',
    properties: {
      type: { type: 'string', enum: ['offer', 'answer'] },
      sdp: { type: 'string', description: 'corpo do SDP (RFC 8866)' },
    },
    example: { type: 'offer', sdp: 'v=0\r\no=- ...' },
  })
  @IsOptional()
  @IsObject()
  sdp?: { type: 'offer' | 'answer'; sdp: string };

  @ApiPropertyOptional({
    description: 'Dado opaco (biz_opaque_callback_data) ecoado no webhook de terminate.',
    example: 'pedido-4821',
  })
  @IsOptional()
  @IsString()
  callbackData?: string;
}
