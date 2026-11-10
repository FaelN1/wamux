import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FlowCategory } from '@wamux/shared';

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

export class CreateFlowDto {
  @ApiProperty({ description: 'Nome do Flow.', example: 'agendamento_consulta' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({
    type: [String],
    enum: CATEGORIES,
    description: 'Categorias do Flow (ao menos uma).',
    example: ['APPOINTMENT_BOOKING'],
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(CATEGORIES, { each: true })
  categories!: FlowCategory[];

  /** flow JSON como string opaca. */
  @ApiPropertyOptional({
    description: 'Flow JSON como string opaca (define as telas do formulário).',
    example: '{"version":"7.3","screens":[]}',
  })
  @IsOptional()
  @IsString()
  flow_json?: string;

  @ApiPropertyOptional({
    description: 'ID de um Flow existente para clonar.',
    example: '1234567890',
  })
  @IsOptional()
  @IsString()
  clone_flow_id?: string;

  @ApiPropertyOptional({
    description: 'Endpoint criptografado (data_exchange). Vazio = Flow estático.',
    example: 'https://meu-app.com/flow-endpoint',
  })
  @IsOptional()
  @IsString()
  endpoint_uri?: string;

  @ApiPropertyOptional({
    description: 'Publica o Flow logo após criar (torna-se imutável).',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  publish?: boolean;
}
