import { ArrayMinSize, IsArray, IsIn, IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ApiKeyAction } from '@wamux/shared';

export class CreateApiKeyDto {
  @ApiProperty({
    description: 'Rótulo legível da key — só pra reconhecê-la na listagem.',
    example: 'app-mobile',
  })
  @IsString()
  @IsNotEmpty()
  label!: string;

  @ApiProperty({
    isArray: true,
    enum: ApiKeyAction,
    description:
      'Ações liberadas para a key (mín. 1). Anti-escalonamento: a key criadora não pode conceder uma ação que ela própria não tenha.',
    example: [ApiKeyAction.READ, ApiKeyAction.SEND],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(Object.values(ApiKeyAction), { each: true })
  actions!: ApiKeyAction[];
}
