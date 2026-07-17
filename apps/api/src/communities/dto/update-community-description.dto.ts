import { IsString } from 'class-validator';

export class UpdateCommunityDescriptionDto {
  /** string vazia remove a descrição. */
  @IsString() description!: string;
}
