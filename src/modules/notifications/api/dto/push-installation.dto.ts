import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterPushInstallationDto {
  @ApiProperty({ format: 'uuid' })
  @IsString()
  installationId!: string;

  @ApiProperty({ maxLength: 512, writeOnly: true })
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  providerToken!: string;

  @ApiProperty({
    description: 'Whether browser/OS permission currently allows push.',
  })
  @IsBoolean()
  permissionGranted!: boolean;
}

export class PushInstallationResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) installationId!: string;
  @ApiProperty({ enum: ['ACTIVE', 'REVOKED', 'INVALIDATED'] }) status!: string;
  @ApiProperty() permissionGranted!: boolean;
}

export class PushInstallationResponseEnvelopeDto {
  @ApiProperty({ type: PushInstallationResponseDto })
  data!: PushInstallationResponseDto;
}
