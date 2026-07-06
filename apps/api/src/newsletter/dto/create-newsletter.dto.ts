import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateNewsletterDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsString() description?: string;
}
