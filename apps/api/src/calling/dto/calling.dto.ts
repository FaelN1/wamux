import { IsIn, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export class RequestPermissionDto {
  @IsString()
  @IsNotEmpty()
  to!: string;

  @IsOptional()
  @IsString()
  text?: string;
}

export class ConnectCallDto {
  /** business-initiated (connect). */
  @IsOptional()
  @IsString()
  to?: string;

  /** user-initiated (pre_accept/accept/reject/terminate). */
  @IsOptional()
  @IsString()
  callId?: string;

  @IsIn(['connect', 'pre_accept', 'accept', 'reject', 'terminate'])
  action!: 'connect' | 'pre_accept' | 'accept' | 'reject' | 'terminate';

  /** { type: 'offer'|'answer', sdp: '<RFC8866>' }. */
  @IsOptional()
  @IsObject()
  sdp?: { type: 'offer' | 'answer'; sdp: string };

  @IsOptional()
  @IsString()
  callbackData?: string;
}
