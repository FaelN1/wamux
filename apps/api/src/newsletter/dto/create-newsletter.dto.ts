import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateNewsletterDto {
  @ApiProperty({ description: 'Nome do canal.', example: 'Novidades da Loja' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({ description: 'Descrição do canal.', example: 'Promoções e lançamentos' })
  @IsOptional()
  @IsString()
  description?: string;
}
