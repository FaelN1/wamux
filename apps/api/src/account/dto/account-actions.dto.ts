import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class RequestCodeDto {
  @IsIn(['SMS', 'VOICE'])
  codeMethod!: 'SMS' | 'VOICE';

  /** ex.: pt_BR, en_US. */
  @IsString()
  @IsNotEmpty()
  language!: string;
}

export class VerifyCodeDto {
  @IsString()
  @IsNotEmpty()
  code!: string;
}

export class RegisterNumberDto {
  /** PIN de 2FA (6 dígitos). */
  @IsString()
  @IsNotEmpty()
  pin!: string;

  @IsOptional()
  @IsString()
  dataLocalizationRegion?: string;
}

export class SetPinDto {
  @IsString()
  @IsNotEmpty()
  pin!: string;
}
