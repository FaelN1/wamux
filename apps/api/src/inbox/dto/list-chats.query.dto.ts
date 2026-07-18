import { Type } from 'class-transformer';
import { IsBooleanString, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ListChatsQueryDto {
  /** cursor opaco = `lastMessageAt` do último item da página anterior. */
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsBooleanString() archived?: string;
  @IsOptional() @IsIn(['user', 'group', 'newsletter', 'broadcast']) type?: string;
  /** busca por nome/pushName/número (contém, case-insensitive). */
  @IsOptional() @IsString() q?: string;
}
