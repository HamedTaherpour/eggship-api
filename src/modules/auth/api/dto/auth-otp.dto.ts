import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { IsIranianMobilePhone } from '../iranian-phone.validator';

export class RequestOtpBodyDto {
  @ApiProperty({
    example: '09121234567',
    description: [
      'Iranian mobile number in a supported input form.',
      'Accepted examples include 09121234567, 9121234567, +989121234567, and 00989121234567.',
      'Normalized internally to canonical E.164 (+989xxxxxxxxx).',
      'Responses never reveal whether the phone already has an account.',
    ].join(' '),
    minLength: 10,
    maxLength: 32,
  })
  @IsString()
  @MinLength(10)
  @MaxLength(32)
  @IsIranianMobilePhone()
  phone!: string;
}

export class VerifyOtpBodyDto {
  @ApiProperty({
    format: 'uuid',
    example: '11111111-1111-4111-8111-111111111111',
    description: 'Challenge id returned by Auth_requestOtp.',
  })
  @IsUUID('4')
  challengeId!: string;

  @ApiProperty({
    example: '482913',
    description:
      'Exactly six ASCII digits. Leading zeros are allowed. Whitespace is rejected.',
    pattern: '^\\d{6}$',
    minLength: 6,
    maxLength: 6,
  })
  @IsString()
  @Matches(/^\d{6}$/u, {
    message: 'code must be exactly six ASCII digits',
  })
  code!: string;
}

export class RequestOtpDataDto {
  @ApiProperty({
    format: 'uuid',
    example: '11111111-1111-4111-8111-111111111111',
  })
  challengeId!: string;

  @ApiProperty({
    example: 300,
    description: 'Seconds until the challenge expires.',
    minimum: 0,
  })
  expiresInSeconds!: number;

  @ApiProperty({
    example: 60,
    description: 'Seconds until another OTP may be requested for this phone.',
    minimum: 0,
  })
  resendAfterSeconds!: number;
}

export class RequestOtpResponseDto {
  @ApiProperty({ type: RequestOtpDataDto })
  data!: RequestOtpDataDto;
}

export class VerifyOtpDataDto {
  @ApiProperty({
    format: 'uuid',
    example: '22222222-2222-4222-8222-222222222222',
    description: [
      'Short-lived, single-use server-side verification grant id.',
      'Not a session token. Required by later registration/login orchestration.',
      'Cannot be forged from a challenge id alone.',
    ].join(' '),
  })
  verificationGrantId!: string;

  @ApiProperty({
    example: 600,
    description: 'Seconds until the verification grant expires.',
    minimum: 0,
  })
  expiresInSeconds!: number;

  @ApiProperty({
    enum: ['customer_auth'],
    example: 'customer_auth',
    description:
      'OTP purpose bound to the grant (identity-neutral customer auth).',
  })
  purpose!: string;
}

export class VerifyOtpResponseDto {
  @ApiProperty({ type: VerifyOtpDataDto })
  data!: VerifyOtpDataDto;
}
