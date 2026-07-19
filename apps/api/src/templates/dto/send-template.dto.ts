import { IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { TemplateSendComponent } from '@wamux/shared';

export class SendTemplateDto {
  @IsString()
  @IsNotEmpty()
  to!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  /** código da língua, ex.: pt_BR. */
  @IsString()
  @IsNotEmpty()
  language!: string;

  /** parâmetros de body/header/button (preenchimento). */
  @IsOptional()
  @IsArray()
  components?: TemplateSendComponent[];

  @IsOptional()
  @IsString()
  quotedMessageId?: string;
}
