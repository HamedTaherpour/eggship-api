import { ApiProperty } from '@nestjs/swagger';
import { createPaginatedResponseDto } from '../../../../common/list';
import type {
  AdminReferralEvidenceRecord,
  AdminVisitorRecord,
} from '../../domain/visitor';

export class AdminVisitorListItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'Tehran bazaar promoter' }) name!: string;
  @ApiProperty({ example: 'ABCD2345EF' }) referralCode!: string;
  @ApiProperty({ example: true }) isActive!: boolean;
  @ApiProperty({ example: 12, minimum: 0 }) attributionCount!: number;
  @ApiProperty({ example: '2026-08-21T12:00:00.000Z' }) createdAt!: string;
  @ApiProperty({ example: '2026-08-21T12:00:00.000Z' }) updatedAt!: string;
}

export class AdminVisitorDetailDto extends AdminVisitorListItemDto {}

export class AdminVisitorResponseDto {
  @ApiProperty({ type: AdminVisitorDetailDto }) data!: AdminVisitorDetailDto;
}

export class AdminReferralEvidenceDto {
  @ApiProperty({ format: 'uuid' }) attributionId!: string;
  @ApiProperty({ format: 'uuid' }) visitorId!: string;
  @ApiProperty({ format: 'uuid' }) customerId!: string;
  @ApiProperty({ example: '+989121234567' }) customerPhone!: string;
  @ApiProperty({ example: true }) customerIsActive!: boolean;
  @ApiProperty({ enum: ['VISITOR'], example: 'VISITOR' }) source!: 'VISITOR';
  @ApiProperty({ example: 'ABCD2345EF' }) referralCode!: string;
  @ApiProperty({ example: '2026-08-21T12:00:00.000Z' }) attributedAt!: string;
}

export const AdminVisitorListResponseDto = createPaginatedResponseDto(
  AdminVisitorListItemDto,
  { name: 'AdminVisitorListResponseDto' },
);
export const AdminReferralEvidenceListResponseDto = createPaginatedResponseDto(
  AdminReferralEvidenceDto,
  { name: 'AdminReferralEvidenceListResponseDto' },
);

export function toAdminVisitorDto(
  row: AdminVisitorRecord,
): AdminVisitorDetailDto {
  return {
    id: row.id,
    name: row.name,
    referralCode: row.referralCode,
    isActive: row.isActive,
    attributionCount: row.attributionCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toAdminReferralEvidenceDto(
  row: AdminReferralEvidenceRecord,
): AdminReferralEvidenceDto {
  return { ...row, attributedAt: row.attributedAt.toISOString() };
}
