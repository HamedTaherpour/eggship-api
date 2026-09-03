import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { postgresIntegrationImports } from '../support/postgres-testing-module';
import { assertDestructiveOperationsAllowed } from '../support/integration-environment';
import { PrismaService } from '../../../src/infrastructure/database/prisma/prisma.service';
import { UserRepository } from '../../../src/modules/users/infrastructure/user.repository';
import { VisitorRepository } from '../../../src/modules/visitors/infrastructure/visitor.repository';
import { UsersModule } from '../../../src/modules/users/users.module';
import { VisitorsModule } from '../../../src/modules/visitors/visitors.module';

describe('Admin visitor/referral reads (integration, REF-04)', () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let users: UserRepository;
  let visitors: VisitorRepository;
  let phoneCounter = 3000;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [...postgresIntegrationImports([UsersModule, VisitorsModule])],
    }).compile();
    app = moduleRef;
    prisma = moduleRef.get(PrismaService);
    users = moduleRef.get(UserRepository);
    visitors = moduleRef.get(VisitorRepository);
    await app.init();
  });

  beforeEach(async () => {
    assertDestructiveOperationsAllowed();
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "ReferralAttribution", "Visitor", "User" RESTART IDENTITY CASCADE',
    );
  });

  afterAll(async () => app.close());

  it('joins bounded visitor and immutable referral evidence without credential fields', async () => {
    const visitor = await visitors.create({
      name: `Referral operator ${randomUUID()}`,
    });
    const user = await users.create({
      phone: `+98917${String(phoneCounter++).padStart(6, '0')}`,
    });
    await visitors.createAttribution({
      userId: user.id,
      visitorId: visitor.id,
      referralCode: visitor.referralCode,
    });

    await expect(visitors.findAdminById(visitor.id)).resolves.toMatchObject({
      id: visitor.id,
      attributionCount: 1,
    });
    const evidence = await visitors.listAdminReferrals({
      visitorId: visitor.id,
      page: 1,
      pageSize: 20,
      sortBy: 'attributedAt',
      sortOrder: 'desc',
    });
    expect(evidence).toMatchObject({
      total: 1,
      items: [
        {
          customerId: user.id,
          customerPhone: user.phone,
          visitorId: visitor.id,
        },
      ],
    });
    expect(Object.keys(evidence.items[0] ?? {})).not.toContain('passwordHash');
  });
});
