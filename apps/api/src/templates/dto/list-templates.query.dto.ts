import { IsIn, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListTemplatesQueryDto {
  @ApiPropertyOptional({
    enum: ['AUTHENTICATION', 'MARKETING', 'UTILITY'],
    description: 'Filtra por categoria.',
    example: 'UTILITY',
  })
  @IsOptional()
  @IsIn(['AUTHENTICATION', 'MARKETING', 'UTILITY'])
  category?: 'AUTHENTICATION' | 'MARKETING' | 'UTILITY';

  @ApiPropertyOptional({
    enum: [
      'PENDING',
      'IN_REVIEW',
      'APPROVED',
      'REJECTED',
      'PAUSED',
      'DISABLED',
      'PENDING_DELETION',
      'APPEAL_REQUESTED',
    ],
    description: 'Filtra por status de review.',
    example: 'APPROVED',
  })
  @IsOptional()
  @IsIn([
    'PENDING',
    'IN_REVIEW',
    'APPROVED',
    'REJECTED',
    'PAUSED',
    'DISABLED',
    'PENDING_DELETION',
    'APPEAL_REQUESTED',
  ])
  status?: string;

  @ApiPropertyOptional({ description: 'Filtra pelo código da língua.', example: 'pt_BR' })
  @IsOptional()
  @IsString()
  language?: string;

  @ApiPropertyOptional({
    description: 'Filtra pelo nome do template.',
    example: 'pedido_confirmado',
  })
  @IsOptional()
  @IsString()
  name?: string;
}
