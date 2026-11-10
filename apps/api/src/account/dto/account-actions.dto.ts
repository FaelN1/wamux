import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RequestCodeDto {
  @ApiProperty({
    enum: ['SMS', 'VOICE'],
    description: 'Meio de entrega do código de verificação.',
    example: 'SMS',
  })
  @IsIn(['SMS', 'VOICE'])
  codeMethod!: 'SMS' | 'VOICE';

  @ApiProperty({
    description: 'Idioma/locale do código (ex.: pt_BR, en_US).',
    example: 'pt_BR',
  })
  @IsString()
  @IsNotEmpty()
  language!: string;
}

export class VerifyCodeDto {
  @ApiProperty({
    description: 'Código de verificação recebido por SMS/voz.',
    example: '123456',
  })
  @IsString()
  @IsNotEmpty()
  code!: string;
}

export class RegisterNumberDto {
  @ApiProperty({
    description: 'PIN de verificação em duas etapas (2FA, 6 dígitos).',
    example: '123456',
  })
  @IsString()
  @IsNotEmpty()
  pin!: string;

  @ApiPropertyOptional({
    description: 'Região de localização de dados (data residency), ex.: BR.',
    example: 'BR',
  })
  @IsOptional()
  @IsString()
  dataLocalizationRegion?: string;
}

export class SetPinDto {
  @ApiProperty({
    description: 'Novo PIN de verificação em duas etapas (2FA, 6 dígitos).',
    example: '123456',
  })
  @IsString()
  @IsNotEmpty()
  pin!: string;
}
