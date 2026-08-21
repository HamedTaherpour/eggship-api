import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { UsersController } from './api/users.controller';
import { CustomerProfileService } from './application/customer-profile.service';
import { UserRepository } from './infrastructure/user.repository';

@Module({
  imports: [PrismaModule, forwardRef(() => AuthModule)],
  controllers: [UsersController],
  providers: [UserRepository, CustomerProfileService],
  exports: [UserRepository, CustomerProfileService],
})
export class UsersModule {}
