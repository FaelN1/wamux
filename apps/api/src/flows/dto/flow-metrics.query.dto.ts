import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class FlowMetricsQueryDto {
  /** ex.: ENDPOINT_REQUEST_COUNT, ENDPOINT_AVAILABILITY. */
  @IsString()
  @IsNotEmpty()
  metric!: string;

  @IsIn(['DAY', 'HOUR', 'LIFETIME'])
  granularity!: 'DAY' | 'HOUR' | 'LIFETIME';

  @IsOptional()
  @IsString()
  since?: string;

  @IsOptional()
  @IsString()
  until?: string;
}
