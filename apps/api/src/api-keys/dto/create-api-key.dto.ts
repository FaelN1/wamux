import { ArrayMinSize, IsArray, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiKeyAction } from '@wamux/shared';

export class CreateApiKeyDto {
  @IsString() @IsNotEmpty() label!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsIn(Object.values(ApiKeyAction), { each: true })
  actions!: ApiKeyAction[];

  @IsOptional() @IsIn(['generic', 'mcp']) kind?: 'generic' | 'mcp';
}
