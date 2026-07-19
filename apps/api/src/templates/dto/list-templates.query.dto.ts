import { IsIn, IsOptional, IsString } from 'class-validator';

export class ListTemplatesQueryDto {
  @IsOptional()
  @IsIn(['AUTHENTICATION', 'MARKETING', 'UTILITY'])
  category?: 'AUTHENTICATION' | 'MARKETING' | 'UTILITY';

  @IsOptional()
  @IsIn([
    'PENDING',
    'IN_REVIEW',
    'APPROVED',
    'REJECTED',
    'PAUSED',
    'DISABLED',
    'PENDING_DELETION',
    'APPEAL_REQUESTED',
  ])
  status?: string;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsString()
  name?: string;
}
