import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

class StreamTransportDto {
  @IsBoolean()
  enabled!: boolean;

  @IsArray()
  @IsString({ each: true })
  events!: string[];
}

class WebhookTransportDto extends StreamTransportDto {
  // URL só é validada como URL quando o webhook está habilitado.
  @ValidateIf((o: WebhookTransportDto) => o.enabled && !!o.url)
  @IsString()
  url!: string;
}

export class SetEventsDto {
  @ValidateNested()
  @Type(() => WebhookTransportDto)
  webhook!: WebhookTransportDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => StreamTransportDto)
  websocket!: StreamTransportDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => StreamTransportDto)
  rabbitmq!: StreamTransportDto;
}
