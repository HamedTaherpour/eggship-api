import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import {
  AdminRole,
  ALL_ADMIN_ROLES,
} from '../../../../common/authz/admin-role';
import type { AdminRecord } from '../../domain/admin';
import { createPaginatedResponseDto } from '../../../../common/list';

export class CreateAdminBodyDto {
  @ApiProperty({ example: 'ops@example.com' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ minLength: 12, maxLength: 128, writeOnly: true })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;

  @ApiProperty({ enum: ALL_ADMIN_ROLES })
  @IsIn(ALL_ADMIN_ROLES)
  role!: AdminRole;
}

export class ChangeAdminRoleBodyDto {
  @ApiProperty({ enum: ALL_ADMIN_ROLES })
  @IsIn(ALL_ADMIN_ROLES)
  role!: AdminRole;
}

export class AdminManagementDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'ops@example.com' }) email!: string;
  @ApiProperty({ enum: ALL_ADMIN_ROLES }) role!: AdminRole;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}

export class AdminManagementResponseDto {
  @ApiProperty({ type: AdminManagementDto }) data!: AdminManagementDto;
}

export const AdminManagementListResponseDto = createPaginatedResponseDto(
  AdminManagementDto,
  { name: 'AdminManagementListResponseDto' },
);

export function toAdminManagementDto(record: AdminRecord): AdminManagementDto {
  return {
    id: record.id,
    email: record.email,
    role: record.role,
    isActive: record.isActive,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
