import { IsNotEmpty, IsString } from 'class-validator';

export class RequestLocationDto {
  @IsString()
  @IsNotEmpty()
  to!: string;

  /** texto do pedido (corpo do location_request_message). */
  @IsString()
  @IsNotEmpty()
  text!: string;
}
