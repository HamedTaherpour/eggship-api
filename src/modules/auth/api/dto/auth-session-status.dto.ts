import { ApiProperty } from '@nestjs/swagger';

export class AuthSessionStatusDataDto {
  @ApiProperty({
    example: true,
    description:
      'Whether the client currently has an authenticated session after this operation. Token values are never returned in the body.',
  })
  authenticated!: boolean;
}

export class AuthSessionStatusResponseDto {
  @ApiProperty({ type: AuthSessionStatusDataDto })
  data!: AuthSessionStatusDataDto;
}
