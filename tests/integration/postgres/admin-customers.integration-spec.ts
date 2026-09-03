import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { postgresIntegrationImports } from '../support/postgres-testing-module';
import { assertDestructiveOperationsAllowed } from '../support/integration-environment';
import { PrismaService } from '../../../src/infrastructure/database/prisma/prisma.service';
import { UserRepository } from '../../../src/modules/users/infrastructure/user.repository';
import { AdminCustomerRepository } from '../../../src/modules/users/infrastructure/admin-customer.repository';
import { VisitorRepository } from '../../../src/modules/visitors/infrastructure/visitor.repository';
import { UsersModule } from '../../../src/modules/users/users.module';
import { AdminCustomersModule } from '../../../src/modules/users/admin-customers.module';
import { VisitorsModule } from '../../../src/modules/visitors/visitors.module';

function uniquePhone(suffix: number): string {
  const national = `917${String(suffix).padStart(7, '0')}`.slice(0, 10);
  return `+98${national}`;
}

async function truncateCustomerTables(prisma: PrismaService): Promise<void> {
  assertDestructiveOperationsAllowed();
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "ReferralAttribution", "Visitor", "User" RESTART IDENTITY CASCADE',
  );
}

describe('Admin customer/store reads (integration, ADM-02)', () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let users: UserRepository;
  let adminCustomers: AdminCustomerRepository;
  let visitors: VisitorRepository;
  let phoneCounter = 1000;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ...postgresIntegrationImports([
          UsersModule,
          AdminCustomersModule,
          VisitorsModule,
        ]),
      ],
    }).compile();

    app = moduleRef;
    prisma = moduleRef.get(PrismaService);
    users = moduleRef.get(UserRepository);
    adminCustomers = moduleRef.get(AdminCustomerRepository);
    visitors = moduleRef.get(VisitorRepository);
    await app.init();
  });

  beforeEach(async () => {
    await truncateCustomerTables(prisma);
  });

  afterAll(async () => app.close());

  it('lists with referral evidence in one joined read and filters by hasReferral', async () => {
    const plain = await users.create({ phone: uniquePhone(phoneCounter++) });
    const referredUser = await users.create({
      phone: uniquePhone(phoneCounter++),
    });
    const visitor = await visitors.create({
      name: `Promoter ${randomUUID().slice(0, 8)}`,
    });
    await visitors.createAttribution({
      userId: referredUser.id,
      visitorId: visitor.id,
      referralCode: visitor.referralCode,
    });

    const all = await adminCustomers.list({
      page: 1,
      pageSize: 20,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });
    expect(all.total).toBe(2);
    expect(all.items).toHaveLength(2);
    const referred = all.items.find((item) => item.id === referredUser.id);
    expect(referred?.referral).toMatchObject({
      visitorId: visitor.id,
      referralCode: visitor.referralCode,
    });
    const unreferred = all.items.find((item) => item.id === plain.id);
    expect(unreferred?.referral).toBeNull();

    const onlyReferred = await adminCustomers.list({
      page: 1,
      pageSize: 20,
      sortBy: 'createdAt',
      sortOrder: 'desc',
      hasReferral: true,
    });
    expect(onlyReferred.total).toBe(1);
    expect(onlyReferred.items[0]?.id).toBe(referredUser.id);

    const onlyPlain = await adminCustomers.list({
      page: 1,
      pageSize: 20,
      sortBy: 'createdAt',
      sortOrder: 'desc',
      hasReferral: false,
    });
    expect(onlyPlain.total).toBe(1);
    expect(onlyPlain.items[0]?.id).toBe(plain.id);
  });

  it('supports phone search and isActive filter with stable id tie-break', async () => {
    const first = await users.create({ phone: uniquePhone(phoneCounter++) });
    const second = await users.create({ phone: uniquePhone(phoneCounter++) });
    await prisma.user.update({
      where: { id: second.id },
      data: { isActive: false },
    });

    const searched = await adminCustomers.list({
      page: 1,
      pageSize: 20,
      search: first.phone.slice(-4),
      sortBy: 'createdAt',
      sortOrder: 'asc',
    });
    expect(searched.items.map((item) => item.id)).toContain(first.id);

    const inactive = await adminCustomers.list({
      page: 1,
      pageSize: 20,
      sortBy: 'createdAt',
      sortOrder: 'asc',
      isActive: false,
    });
    expect(inactive.total).toBe(1);
    expect(inactive.items[0]?.id).toBe(second.id);
  });

  it('returns minimized detail with immutable referral evidence', async () => {
    const user = await users.create({ phone: uniquePhone(phoneCounter++) });
    const visitor = await visitors.create({
      name: `Promoter ${randomUUID().slice(0, 8)}`,
    });
    await visitors.createAttribution({
      userId: user.id,
      visitorId: visitor.id,
      referralCode: visitor.referralCode,
    });

    const detail = await adminCustomers.findById(user.id);
    expect(detail).not.toBeNull();
    expect(detail?.id).toBe(user.id);
    expect(detail?.phone).toBe(user.phone);
    expect(detail?.referral).toMatchObject({
      visitorId: visitor.id,
      visitorName: visitor.name,
      referralCode: visitor.referralCode,
    });
    expect(
      (detail as unknown as Record<string, unknown>)['passwordHash'],
    ).toBeUndefined();
  });

  it('returns null for unknown customer ids (controller maps to CUSTOMER_NOT_FOUND)', async () => {
    await expect(adminCustomers.findById(randomUUID())).resolves.toBeNull();
  });
});
