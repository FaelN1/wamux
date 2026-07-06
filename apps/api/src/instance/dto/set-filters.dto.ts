import { IsArray, IsIn, IsOptional, IsString } from 'class-validator';

export class SetFiltersDto {
  @IsOptional() @IsArray() @IsString({ each: true })
  allowJids?: string[];

  @IsOptional() @IsArray() @IsString({ each: true })
  blockJids?: string[];

  @IsOptional() @IsIn(['inbound', 'outbound', 'both'])
  direction?: 'inbound' | 'outbound' | 'both';
}
