import { IsNotEmpty, IsString } from 'class-validator';

export class UpdateCommunitySubjectDto {
  @IsString() @IsNotEmpty() subject!: string;
}
