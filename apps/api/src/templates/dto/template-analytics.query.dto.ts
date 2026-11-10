import { Type } from 'class-transformer';
import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** start/end em unix (segundos). templateIds/metricTypes separados por vírgula. */
export class TemplateAnalyticsQueryDto {
  @ApiProperty({
    description: 'Início da janela em unix (segundos).',
    example: 1719792000,
  })
  @Type(() => Number)
  @IsNumber()
  start!: number;

  @ApiProperty({ description: 'Fim da janela em unix (segundos).', example: 1720396800 })
  @Type(() => Number)
  @IsNumber()
  end!: number;

  /** ids de template separados por vírgula (máx 10). */
  @ApiProperty({
    description: 'IDs de template separados por vírgula (máx 10).',
    example: '123456789,987654321',
  })
  @IsString()
  @IsNotEmpty()
  templateIds!: string;

  /** métricas separadas por vírgula (ex.: SENT,DELIVERED,READ,CLICKED). */
  @ApiPropertyOptional({
    description: 'Métricas separadas por vírgula.',
    example: 'SENT,DELIVERED,READ,CLICKED',
  })
  @IsOptional()
  @IsString()
  metricTypes?: string;
}
