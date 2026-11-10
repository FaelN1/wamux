import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RequestLocationDto {
  @ApiProperty({
    description: 'Destino: número em dígitos (5511999999999) ou jid completo do WhatsApp.',
    example: '5511999999999',
  })
  @IsString()
  @IsNotEmpty()
  to!: string;

  /** texto do pedido (corpo do location_request_message). */
  @ApiProperty({
    description: 'Texto do pedido (corpo do location_request_message).',
    example: 'Pode compartilhar sua localização?',
  })
  @IsString()
  @IsNotEmpty()
  text!: string;
}
