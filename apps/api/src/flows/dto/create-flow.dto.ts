import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { FlowCategory } from '@wamux/shared';

const CATEGORIES = [
  'SIGN_UP',
  'SIGN_IN',
  'APPOINTMENT_BOOKING',
  'LEAD_GENERATION',
  'CONTACT_US',
  'CUSTOMER_SUPPORT',
  'SURVEY',
  'OTHER',
] as const;

export class CreateFlowDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsIn(CATEGORIES, { each: true })
  categories!: FlowCategory[];

  /** flow JSON como string opaca. */
  @IsOptional()
  @IsString()
  flow_json?: string;

  @IsOptional()
  @IsString()
  clone_flow_id?: string;

  @IsOptional()
  @IsString()
  endpoint_uri?: string;

  @IsOptional()
  @IsBoolean()
  publish?: boolean;
}
