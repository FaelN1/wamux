import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class StreamTransportDto {
  @ApiProperty({ description: 'Transporte habilitado?' })
  @IsBoolean()
  enabled!: boolean;

  @ApiProperty({
    type: [String],
    description: 'Eventos entregues por este transporte (vazio = todos).',
    example: [],
  })
  @IsArray()
  @IsString({ each: true })
  events!: string[];
}

class WebhookTransportDto extends StreamTransportDto {
  // URL só é validada como URL quando o webhook está habilitado.
  @ApiProperty({
    description: 'URL de destino do webhook (obrigatória quando enabled=true).',
    example: 'https://meu-app.com/webhooks/wa',
  })
  @ValidateIf((o: WebhookTransportDto) => o.enabled && !!o.url)
  @IsString()
  url!: string;
}

export class SetEventsDto {
  @ApiProperty({ type: WebhookTransportDto, description: 'Entrega via HTTP webhook.' })
  @ValidateNested()
  @Type(() => WebhookTransportDto)
  webhook!: WebhookTransportDto;

  @ApiPropertyOptional({ type: StreamTransportDto, description: 'Stream via WebSocket.' })
  @IsOptional()
  @ValidateNested()
  @Type(() => StreamTransportDto)
  websocket!: StreamTransportDto;

  @ApiPropertyOptional({ type: StreamTransportDto, description: 'Stream via RabbitMQ.' })
  @IsOptional()
  @ValidateNested()
  @Type(() => StreamTransportDto)
  rabbitmq!: StreamTransportDto;
}
