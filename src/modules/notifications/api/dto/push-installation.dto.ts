import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PushChannel, PushOs } from '../../domain/push-installation';

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

  @ApiProperty({ enum: PushChannel })
  @IsEnum(PushChannel)
  channel!: PushChannel;

  @ApiProperty({ enum: PushOs })
  @IsEnum(PushOs)
  os!: PushOs;
}

export class PushInstallationResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) installationId!: string;
  @ApiProperty({ enum: ['ACTIVE', 'REVOKED', 'INVALIDATED'] }) status!: string;
  @ApiProperty() permissionGranted!: boolean;
  @ApiProperty({ enum: PushChannel, nullable: true }) channel!: string | null;
  @ApiProperty({ enum: PushOs, nullable: true }) os!: string | null;
}

export class PushInstallationResponseEnvelopeDto {
  @ApiProperty({ type: PushInstallationResponseDto })
  data!: PushInstallationResponseDto;
}
