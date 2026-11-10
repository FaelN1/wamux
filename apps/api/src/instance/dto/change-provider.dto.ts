import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProviderType } from '../../providers/provider.types';

export class ChangeProviderDto {
  @ApiProperty({
    enum: ProviderType,
    description: 'Nova engine da instância.',
    example: ProviderType.WHATSMEOW,
  })
  @IsEnum(ProviderType, {
    message: `provider deve ser um de: ${Object.values(ProviderType).join(', ')}`,
  })
  provider!: ProviderType;

  @ApiPropertyOptional({
    description:
      'Tentar migrar as credenciais (trocar engine sem reparear). Só entre engines com portableCredentials.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  migrate?: boolean;
}
