import { Module, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisModule } from '../../infrastructure/redis/redis.module';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module';
import { AdminsModule } from '../admins/admins.module';
import { UsersModule } from '../users/users.module';
import { VisitorsModule } from '../visitors/visitors.module';
import { AccessTokenGuard } from './api/access-token.guard';
import { CsrfGuard } from './api/csrf.guard';
import { CsrfService } from './api/csrf.service';
import { AdminAuthController } from './api/admin-auth.controller';
import { AuthController } from './api/auth.controller';
import { AdminLoginService } from './application/admin-login.service';
import { AdminSessionLifecycleService } from './application/admin-session-lifecycle.service';
import { CustomerAuthCompletionService } from './application/customer-auth-completion.service';
import { OtpService } from './application/otp.service';
import { SessionLifecycleService } from './application/session-lifecycle.service';
import {
  OTP_CODE_ISSUER,
  OTP_STORE,
  OTP_VERIFICATION_GRANT_STORE,
  PASSWORD_HASHER,
  SMS_PROVIDER,
} from './auth.tokens';
import type { OtpCodeIssuer } from './domain/otp-code-issuer';
import type { SmsProvider } from './domain/sms-provider';
import { AccessTokenService } from './infrastructure/access-token.service';
import { AdminAuthSessionRepository } from './infrastructure/admin-auth-session.repository';
import { AdminLoginAbuseLimiterService } from './infrastructure/admin-login-abuse.limiter';
import { Argon2PasswordHasher } from './infrastructure/argon2-password-hasher';
import { AuthSessionRepository } from './infrastructure/auth-session.repository';
import { DevelopmentOtpCodeIssuer } from './infrastructure/development-otp-code-issuer';
import { DevelopmentSmsProvider } from './infrastructure/development-sms-provider';
import { FetchKavenegarHttpTransport } from './infrastructure/kavenegar-http-transport';
import { KavenegarSmsProvider } from './infrastructure/kavenegar-sms-provider';
import { RedisOtpStore } from './infrastructure/redis-otp-store';
import { RedisOtpVerificationGrantStore } from './infrastructure/redis-otp-verification-grant-store';
import { RefreshTokenService } from './infrastructure/refresh-token.service';
import { SecureOtpCodeIssuer } from './infrastructure/secure-otp-code-issuer';

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => UsersModule),
    forwardRef(() => AdminsModule),
    RedisModule,
    VisitorsModule,
  ],
  controllers: [AuthController, AdminAuthController],
  providers: [
    AuthSessionRepository,
    AdminAuthSessionRepository,
    AccessTokenService,
    RefreshTokenService,
    AccessTokenGuard,
    CsrfGuard,
    CsrfService,
    SessionLifecycleService,
    AdminSessionLifecycleService,
    AdminLoginService,
    AdminLoginAbuseLimiterService,
    CustomerAuthCompletionService,
    OtpService,
    RedisOtpStore,
    RedisOtpVerificationGrantStore,
    {
      provide: OTP_STORE,
      useExisting: RedisOtpStore,
    },
    {
      provide: OTP_VERIFICATION_GRANT_STORE,
      useExisting: RedisOtpVerificationGrantStore,
    },
    Argon2PasswordHasher,
    {
      provide: PASSWORD_HASHER,
      useExisting: Argon2PasswordHasher,
    },
    {
      provide: OTP_CODE_ISSUER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): OtpCodeIssuer => {
        const provider = config.getOrThrow<'development' | 'kavenegar'>(
          'OTP_PROVIDER',
        );
        const nodeEnv = config.getOrThrow<string>('NODE_ENV');
        if (provider === 'development') {
          if (nodeEnv === 'production') {
            throw new Error(
              'Development OTP code issuer cannot be used when NODE_ENV=production.',
            );
          }
          return new DevelopmentOtpCodeIssuer(
            config.getOrThrow<string>('OTP_DEV_CODE'),
          );
        }
        return new SecureOtpCodeIssuer();
      },
    },
    {
      provide: SMS_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): SmsProvider => {
        const provider = config.getOrThrow<'development' | 'kavenegar'>(
          'OTP_PROVIDER',
        );
        const nodeEnv = config.getOrThrow<string>('NODE_ENV');
        if (provider === 'development') {
          if (nodeEnv === 'production') {
            throw new Error(
              'Development SMS provider cannot be used when NODE_ENV=production.',
            );
          }
          return new DevelopmentSmsProvider();
        }
        return new KavenegarSmsProvider({
          apiKey: config.getOrThrow<string>('KAVENEGAR_API_KEY'),
          template: config.getOrThrow<string>('KAVENEGAR_OTP_TEMPLATE'),
          transport: new FetchKavenegarHttpTransport(),
        });
      },
    },
  ],
  exports: [
    AuthSessionRepository,
    AdminAuthSessionRepository,
    AccessTokenService,
    RefreshTokenService,
    AccessTokenGuard,
    CsrfGuard,
    CsrfService,
    SessionLifecycleService,
    AdminSessionLifecycleService,
    AdminLoginService,
    CustomerAuthCompletionService,
    OtpService,
    PASSWORD_HASHER,
    OTP_STORE,
    OTP_VERIFICATION_GRANT_STORE,
    SMS_PROVIDER,
    OTP_CODE_ISSUER,
  ],
})
export class AuthModule {}
