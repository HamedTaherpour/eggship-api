import { ApiProperty } from '@nestjs/swagger';
import {
  CommerceOverrideMode,
  formatLocalTime,
  type CommerceScheduleOverrideRecord,
  type CommerceSettingsRecord,
} from '../../domain/commerce-policy';

export class CommerceSettingsDto {
  @ApiProperty() orderingScheduleEnabled!: boolean;
  @ApiProperty({ example: '07:00' }) orderingOpensAt!: string;
  @ApiProperty({ example: '16:00' }) orderingClosesAt!: string;
  @ApiProperty({ minimum: 1 }) minimumOrderQuantity!: number;
  @ApiProperty({ minimum: 1 }) revision!: number;
  @ApiProperty({ format: 'uuid' }) createdByAdminId!: string;
  @ApiProperty({ format: 'uuid' }) updatedByAdminId!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class CommerceSettingsResponseDto {
  @ApiProperty({ type: CommerceSettingsDto, nullable: true })
  data!: CommerceSettingsDto | null;
}

export class CommerceOverrideDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'date', example: '2026-08-25' }) localDate!: string;
  @ApiProperty({ enum: Object.values(CommerceOverrideMode) })
  mode!: CommerceOverrideMode;
  @ApiProperty({ nullable: true, example: '18:00' }) opensAt!: string | null;
  @ApiProperty({ nullable: true, example: '02:00' }) closesAt!: string | null;
  @ApiProperty({ format: 'uuid' }) createdByAdminId!: string;
  @ApiProperty({ format: 'uuid' }) updatedByAdminId!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class CommerceOverrideMutationDataDto {
  @ApiProperty({ minimum: 1 }) revision!: number;
  @ApiProperty({ type: CommerceOverrideDto }) override!: CommerceOverrideDto;
}
export class CommerceOverrideMutationResponseDto {
  @ApiProperty({ type: CommerceOverrideMutationDataDto })
  data!: CommerceOverrideMutationDataDto;
}
export class CommerceOverrideListDataDto {
  @ApiProperty({ minimum: 1 }) revision!: number;
  @ApiProperty({ type: [CommerceOverrideDto] })
  overrides!: CommerceOverrideDto[];
}
export class CommerceOverrideListResponseDto {
  @ApiProperty({ type: CommerceOverrideListDataDto })
  data!: CommerceOverrideListDataDto;
}

export function toSettingsDto(
  value: CommerceSettingsRecord,
): CommerceSettingsDto {
  return {
    orderingScheduleEnabled: value.orderingScheduleEnabled,
    orderingOpensAt: formatLocalTime(value.orderingOpensAtLocalMinute),
    orderingClosesAt: formatLocalTime(value.orderingClosesAtLocalMinute),
    minimumOrderQuantity: value.minimumOrderQuantity,
    revision: value.revision,
    createdByAdminId: value.createdByAdminId,
    updatedByAdminId: value.updatedByAdminId,
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
  };
}
export function toOverrideDto(
  value: CommerceScheduleOverrideRecord,
): CommerceOverrideDto {
  return {
    id: value.id,
    localDate: value.localDate,
    mode: value.mode,
    opensAt:
      value.opensAtLocalMinute === null
        ? null
        : formatLocalTime(value.opensAtLocalMinute),
    closesAt:
      value.closesAtLocalMinute === null
        ? null
        : formatLocalTime(value.closesAtLocalMinute),
    createdByAdminId: value.createdByAdminId,
    updatedByAdminId: value.updatedByAdminId,
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
  };
}
