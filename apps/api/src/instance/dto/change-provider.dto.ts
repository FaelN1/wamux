import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { ProviderType } from '../../providers/provider.types';

export class ChangeProviderDto {
  @IsEnum(ProviderType, {
    message: `provider deve ser um de: ${Object.values(ProviderType).join(', ')}`,
  })
  provider!: ProviderType;

  /** Tentar migrar as credenciais (trocar engine sem reparear). */
  @IsOptional()
  @IsBoolean()
  migrate?: boolean;
}
