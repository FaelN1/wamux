import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';

export class SetPresenceDto {
  @IsString() @IsNotEmpty() to!: string;

  @IsIn(['available', 'unavailable', 'composing', 'recording', 'paused'])
  state!: 'available' | 'unavailable' | 'composing' | 'recording' | 'paused';

  @IsOptional() @IsInt() @Min(0) @Max(60_000) durationMs?: number;
}
