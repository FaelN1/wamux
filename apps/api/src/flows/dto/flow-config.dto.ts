import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { FlowCategory, FlowSessionStatus } from '@wamux/shared';

const CATEGORIES = [
  'SIGN_UP',
  'SIGN_IN',
  'APPOINTMENT_BOOKING',
  'LEAD_GENERATION',
  'CONTACT_US',
  'CUSTOMER_SUPPORT',
  'SURVEY',
  'OTHER',
] as const;

export class UpdateFlowMetadataDto {
  @ApiPropertyOptional({ description: 'Novo nome do Flow.', example: 'agendamento_v2' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @ApiPropertyOptional({ type: [String], enum: CATEGORIES })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(CATEGORIES, { each: true })
  categories?: FlowCategory[];

  @ApiPropertyOptional({
    description: 'URL do endpoint de troca de dados registrada na Meta.',
    example: 'https://gateway.exemplo.com/api/webhooks/flows/<instanceId>',
  })
  @IsOptional()
  @IsString()
  endpoint_uri?: string;

  @ApiPropertyOptional({ description: 'ID do app da Meta conectado ao endpoint.' })
  @IsOptional()
  @IsString()
  application_id?: string;
}

export class SetFlowEncryptionDto {
  @ApiPropertyOptional({
    description:
      'Chave privada RSA (PEM, ≥2048 bits). Omitida = o gateway gera um par novo. ' +
      'A pública derivada é registrada na Meta; a privada nunca é devolvida.',
  })
  @IsOptional()
  @IsString()
  @MinLength(64)
  privateKey?: string;

  @ApiPropertyOptional({ description: 'Senha da chave privada, se ela for cifrada.' })
  @IsOptional()
  @IsString()
  passphrase?: string;
}

export class SetFlowEndpointDto {
  @ApiPropertyOptional({
    description:
      'URL do SEU serviço que decide a próxima tela (recebe o payload já decifrado). ' +
      '`null` remove.',
    example: 'https://meu-app.com/whatsapp/flow',
    nullable: true,
  })
  @ValidateIf((o: SetFlowEndpointDto) => o.url !== null)
  @IsUrl({ require_tld: false, protocols: ['http', 'https'], require_protocol: true })
  url!: string | null;
}

export class ListFlowSessionsQueryDto {
  @ApiPropertyOptional({ enum: ['sent', 'in_progress', 'completed', 'failed'] })
  @IsOptional()
  @IsIn(['sent', 'in_progress', 'completed', 'failed'])
  status?: FlowSessionStatus;

  @ApiPropertyOptional({ description: 'Filtra pelo destinatário.', example: '5511999999999' })
  @IsOptional()
  @IsString()
  contact?: string;

  @ApiPropertyOptional({ description: 'Filtra pelo ID do Flow.' })
  @IsOptional()
  @IsString()
  flowId?: string;

  @ApiPropertyOptional({ description: 'Máximo de itens (1–200).', default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ description: 'Cursor: só sessões criadas antes deste instante (ISO).' })
  @IsOptional()
  @IsISO8601()
  before?: string;
}
