import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class FlowMetricsQueryDto {
  /** ex.: ENDPOINT_REQUEST_COUNT, ENDPOINT_AVAILABILITY. */
  @ApiProperty({
    description: 'Nome da métrica.',
    example: 'ENDPOINT_REQUEST_COUNT',
  })
  @IsString()
  @IsNotEmpty()
  metric!: string;

  @ApiProperty({
    enum: ['DAY', 'HOUR', 'LIFETIME'],
    description: 'Granularidade da série.',
    example: 'DAY',
  })
  @IsIn(['DAY', 'HOUR', 'LIFETIME'])
  granularity!: 'DAY' | 'HOUR' | 'LIFETIME';

  @ApiPropertyOptional({ description: 'Início da janela (unix segundos).', example: '1719792000' })
  @IsOptional()
  @IsString()
  since?: string;

  @ApiPropertyOptional({ description: 'Fim da janela (unix segundos).', example: '1720396800' })
  @IsOptional()
  @IsString()
  until?: string;
}
