import { ArrayMinSize, IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateGroupDto {
  @IsString() @IsNotEmpty() subject!: string;

  /** jids (…@s.whatsapp.net) ou números dos participantes iniciais. */
  @IsArray() @ArrayMinSize(1) @IsString({ each: true })
  participants!: string[];

  @IsOptional() @IsString() description?: string;
}
