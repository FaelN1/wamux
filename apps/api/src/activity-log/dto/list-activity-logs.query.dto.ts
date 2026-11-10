import { Transform, Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
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
  @ApiPropertyOptional({
    description:
      'Cursor opaco de paginação = `createdAt` (unix ms) do último item da página anterior.',
    example: '1721764800000',
  })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({
    description: 'Itens por página (1..200). Padrão: 50.',
    minimum: 1,
    maximum: 200,
    example: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ description: 'Início do intervalo (unix ms).', example: 1721678400000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  from?: number;

  @ApiPropertyOptional({ description: 'Fim do intervalo (unix ms).', example: 1721764800000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  to?: number;

  @ApiPropertyOptional({
    isArray: true,
    enum: ActivityLogStatus,
    description:
      'Filtra por status (lista separada por vírgula, ex.: `success,failed`). Ignorado em `/facets` e `/histogram`.',
    example: [ActivityLogStatus.SUCCESS, ActivityLogStatus.FAILED],
  })
  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @IsIn(Object.values(ActivityLogStatus), { each: true })
  status?: ActivityLogStatus[];

  @ApiPropertyOptional({
    isArray: true,
    enum: ActivityLogType,
    description:
      'Filtra por tipo (lista separada por vírgula, ex.: `messaging,connection`). Ignorado em `/facets` e `/histogram`.',
    example: [ActivityLogType.MESSAGING, ActivityLogType.CONNECTION],
  })
  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @IsIn(Object.values(ActivityLogType), { each: true })
  type?: ActivityLogType[];

  @ApiPropertyOptional({ description: 'Filtra por código HTTP exato.', example: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  statusCode?: number;

  @ApiPropertyOptional({
    description: 'Filtra por rota (contém, case-insensitive).',
    example: '/instances',
  })
  @IsOptional()
  @IsString()
  route?: string;

  @ApiPropertyOptional({ description: 'Filtra pelo id (uuid) de uma instância.' })
  @IsOptional()
  @IsString()
  instanceId?: string;

  @ApiPropertyOptional({
    description: 'Filtra por plataforma/engine (ProviderType).',
    example: 'baileys',
  })
  @IsOptional()
  @IsString()
  platform?: string;

  @ApiPropertyOptional({
    description: 'Busca livre em `activity`+`message` (contém, case-insensitive).',
    example: 'timeout',
  })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({
    enum: ['hour', 'day'],
    description: 'Agrupamento do histograma. Só usado em `/histogram` (padrão: `hour`).',
    example: 'hour',
  })
  @IsOptional()
  @IsIn(['hour', 'day'])
  bucket?: 'hour' | 'day';
}
