import { IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateCloudGroupDto {
  @IsString()
  @IsNotEmpty()
  subject!: string;

  /** participantes iniciais (números). Máx 8 no total (limite da Cloud). */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  participants?: string[];
}

export class RemoveParticipantDto {
  @IsString()
  @IsNotEmpty()
  waId!: string;
}
