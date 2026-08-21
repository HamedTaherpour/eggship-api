import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { MAX_ADMIN_PASSWORD_LENGTH } from '../../../admins/domain/admin-password-policy';
import { MAX_ADMIN_EMAIL_LENGTH } from '../../../admins/domain/admin-email';

export class AdminLoginBodyDto {
  @ApiProperty({
    example: 'ops@example.test',
    description: [
      'Admin login email. Normalized to the canonical form (trim + lowercase).',
      'Synthetic example only — never a real or default credential.',
    ].join(' '),
    maxLength: MAX_ADMIN_EMAIL_LENGTH,
  })
  @IsString()
  @MinLength(3)
  @MaxLength(MAX_ADMIN_EMAIL_LENGTH)
  email!: string;

  @ApiProperty({
    example: 'a sufficiently long passphrase',
    description:
      'Admin password. Never returned. Maximum length bounds Argon2 work per request.',
    maxLength: MAX_ADMIN_PASSWORD_LENGTH,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_ADMIN_PASSWORD_LENGTH)
  password!: string;
}

export class AdminIdentityDto {
  @ApiProperty({
    format: 'uuid',
    example: '44444444-4444-4444-8444-444444444444',
  })
  id!: string;

  @ApiProperty({
    example: 'ops@example.test',
    description: 'Canonical Admin email. Synthetic example only.',
  })
  email!: string;

  @ApiProperty({
    type: 'string',
    description:
      'Persisted Admin role. Display only; authorization uses per-request permissions, not this field.',
  })
  role!: string;
}

export class AdminLoginDataDto {
  @ApiProperty({ example: true })
  authenticated!: boolean;

  @ApiProperty({ type: AdminIdentityDto })
  admin!: AdminIdentityDto;
}

export class AdminLoginResponseDto {
  @ApiProperty({ type: AdminLoginDataDto })
  data!: AdminLoginDataDto;
}

export class CurrentAdminDataDto {
  @ApiProperty({ type: AdminIdentityDto })
  admin!: AdminIdentityDto;
}

export class CurrentAdminResponseDto {
  @ApiProperty({ type: CurrentAdminDataDto })
  data!: CurrentAdminDataDto;
}
