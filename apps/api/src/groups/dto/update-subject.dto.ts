import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class UpdateSubjectDto {
  @IsString() @IsNotEmpty() @MaxLength(100) subject!: string;
}
