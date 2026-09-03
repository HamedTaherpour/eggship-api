import { ApiProperty } from '@nestjs/swagger';
import { createPaginatedResponseDto } from '../../../../common/list';
import type {
  AdminCustomerRecord,
  AdminCustomerReferralView,
} from '../../domain/customer-admin';

export class AdminCustomerReferralDto {
  @ApiProperty({ format: 'uuid' })
  visitorId!: string;

  @ApiProperty({ example: 'Tehran bazaar promoter' })
  visitorName!: string;

  @ApiProperty({ example: true })
  visitorIsActive!: boolean;

  @ApiProperty({ example: 'ABCD2345EF' })
  referralCode!: string;

  @ApiProperty({ example: '2026-08-21T12:00:00.000Z' })
  attributedAt!: string;
}

/** Admin customer/store list item. Phone is purpose-limited to CUSTOMER_READ operators. */
export class AdminCustomerListItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: '+989121234567' })
  phone!: string;

  @ApiProperty({ example: true })
  isActive!: boolean;

  @ApiProperty({ example: '2026-08-21T12:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-08-21T12:00:00.000Z' })
  updatedAt!: string;

  @ApiProperty({ example: true })
  hasReferral!: boolean;

  @ApiProperty({ example: 'ABCD2345EF', nullable: true })
  referralCode!: string | null;
}

/** Admin customer/store detail with immutable referral evidence. */
export class AdminCustomerDetailDto extends AdminCustomerListItemDto {
  @ApiProperty({ type: AdminCustomerReferralDto, nullable: true })
  referral!: AdminCustomerReferralDto | null;
}

export class AdminCustomerResponseDto {
  @ApiProperty({ type: AdminCustomerDetailDto })
  data!: AdminCustomerDetailDto;
}

export const AdminCustomerListResponseDto = createPaginatedResponseDto(
  AdminCustomerListItemDto,
  { name: 'AdminCustomerListResponseDto' },
);

function toListItem(record: AdminCustomerRecord): AdminCustomerListItemDto {
  return {
    id: record.id,
    phone: record.phone,
    isActive: record.isActive,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    hasReferral: record.referral !== null,
    referralCode: record.referral?.referralCode ?? null,
  };
}

function toReferralDto(
  referral: AdminCustomerReferralView,
): AdminCustomerReferralDto {
  return {
    visitorId: referral.visitorId,
    visitorName: referral.visitorName,
    visitorIsActive: referral.visitorIsActive,
    referralCode: referral.referralCode,
    attributedAt: referral.attributedAt.toISOString(),
  };
}

export function toAdminCustomerListItemDto(
  record: AdminCustomerRecord,
): AdminCustomerListItemDto {
  return toListItem(record);
}

export function toAdminCustomerDetailDto(
  record: AdminCustomerRecord,
): AdminCustomerDetailDto {
  return {
    ...toListItem(record),
    referral: record.referral === null ? null : toReferralDto(record.referral),
  };
}
