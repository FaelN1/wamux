import { Transform, Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ActivityLogStatus, ActivityLogType } from '@wamux/shared';

/** `?status=success,failed` → `['success','failed']`. */
const toArray = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.split(',').filter(Boolean) : value;

/**
 * Filtros compartilhados por `GET activity-logs` (lista), `/facets`,
 * `/histogram` e `/export` — cada rota usa o subconjunto que faz sentido
 * (facets/histogram ignoram `status`/`type`, já que são eles próprios a
 * faceta/série sendo calculada).
 */
export class ListActivityLogsQueryDto {
  /** cursor opaco = `createdAt` (unix ms) do último item da página anterior. */
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;

  /** unix (ms). */
  @IsOptional() @Type(() => Number) @IsInt() from?: number;
  @IsOptional() @Type(() => Number) @IsInt() to?: number;

  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @IsIn(Object.values(ActivityLogStatus), { each: true })
  status?: ActivityLogStatus[];

  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @IsIn(Object.values(ActivityLogType), { each: true })
  type?: ActivityLogType[];

  @IsOptional() @Type(() => Number) @IsInt() statusCode?: number;
  @IsOptional() @IsString() route?: string;
  @IsOptional() @IsString() instanceId?: string;
  @IsOptional() @IsString() platform?: string;
  /** busca livre em `activity`+`message` (contém, case-insensitive). */
  @IsOptional() @IsString() q?: string;

  /** só `/histogram`. */
  @IsOptional() @IsIn(['hour', 'day']) bucket?: 'hour' | 'day';
}
