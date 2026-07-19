import { Type } from 'class-transformer';
import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

/** start/end em unix (segundos). templateIds/metricTypes separados por vírgula. */
export class TemplateAnalyticsQueryDto {
  @Type(() => Number)
  @IsNumber()
  start!: number;

  @Type(() => Number)
  @IsNumber()
  end!: number;

  /** ids de template separados por vírgula (máx 10). */
  @IsString()
  @IsNotEmpty()
  templateIds!: string;

  /** métricas separadas por vírgula (ex.: SENT,DELIVERED,READ,CLICKED). */
  @IsOptional()
  @IsString()
  metricTypes?: string;
}
