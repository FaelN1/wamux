import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString } from 'class-validator';
import { BusinessVertical } from '@wamux/shared';

const VERTICALS = [
  'OTHER',
  'AUTO',
  'BEAUTY',
  'APPAREL',
  'EDU',
  'ENTERTAIN',
  'EVENT_PLAN',
  'FINANCE',
  'GROCERY',
  'GOVT',
  'HOTEL',
  'HEALTH',
  'NONPROFIT',
  'PROF_SERVICES',
  'RETAIL',
  'TRAVEL',
  'RESTAURANT',
  'ALCOHOL',
  'ONLINE_GAMBLING',
  'PHYSICAL_GAMBLING',
  'OTC_DRUGS',
] as const;

export class UpdateProfileDto {
  @IsOptional() @IsString() about?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() email?: string;

  @IsOptional()
  @IsIn(VERTICALS)
  vertical?: BusinessVertical;

  /** máx 2. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2)
  @IsString({ each: true })
  websites?: string[];

  @IsOptional() @IsString() profilePictureHandle?: string;
}
