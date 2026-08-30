import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { createConfigModuleOptions } from '../../../src/config/config-module.options';
import { PrismaModule } from '../../../src/infrastructure/database/prisma/prisma.module';
import { PrismaService } from '../../../src/infrastructure/database/prisma/prisma.service';
import { PrismaTransactionContext } from '../../../src/infrastructure/database/prisma/prisma-transaction-context';
import { AuditLogRepository } from '../../../src/modules/audit/infrastructure/audit-log.repository';
import {
  AuditAction,
  AuditActorType,
  AuditEntityType,
  normalizeAuditEvent,
} from '../../../src/modules/audit/domain/audit-event';

describe('AuditLog PostgreSQL contract (integration)', () => {
  let prisma: PrismaService;
  let repository: AuditLogRepository;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot(createConfigModuleOptions()),
        PrismaModule,
      ],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    repository = new AuditLogRepository(prisma);
  });

  afterEach(async () => {
    await prisma.auditLog.deleteMany({
      where: { correlationId: 'aud01-test' },
    });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  function event(
    entityId = '11111111-1111-4111-8111-111111111111',
  ): ReturnType<typeof normalizeAuditEvent> {
    return {
      ...normalizeAuditEvent({
        action: AuditAction.ORDER_CREATED,
        actorType: AuditActorType.SYSTEM,
        actorId: null,
        entityType: AuditEntityType.ORDER,
        entityId,
        metadata: undefined,
      }),
      requestId: 'req_aud01',
      correlationId: 'aud01-test',
    };
  }

  it('commits with a caller-owned transaction and rolls back with it', async () => {
    await prisma.$transaction(async (client) => {
      await repository.append(event(), new PrismaTransactionContext(client));
    });
    expect(
      await prisma.auditLog.count({ where: { correlationId: 'aud01-test' } }),
    ).toBe(1);
    await expect(
      prisma.$transaction(async (client) => {
        await repository.append(event(), new PrismaTransactionContext(client));
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(
      await prisma.auditLog.count({ where: { correlationId: 'aud01-test' } }),
    ).toBe(1);
  });

  it('commits business mutation and audit append atomically, and rolls both back on failure', async () => {
    const visitorId = '33333333-3333-4333-8333-333333333333';
    await prisma.$transaction(async (client) => {
      await client.visitor.create({
        data: {
          id: visitorId,
          name: 'AUD01',
          referralCode: 'AUDRAB',
          isActive: true,
        },
      });
      await repository.append(
        event(visitorId),
        new PrismaTransactionContext(client),
      );
    });
    expect(
      await prisma.visitor.findUnique({ where: { id: visitorId } }),
    ).not.toBeNull();
    expect(
      await prisma.auditLog.count({ where: { entityId: visitorId } }),
    ).toBe(1);
    await prisma.visitor.delete({ where: { id: visitorId } });

    const duplicate = event();
    await repository.append(duplicate);
    const rollbackVisitorId = '44444444-4444-4444-8444-444444444444';
    await expect(
      prisma.$transaction(async (client) => {
        await client.visitor.create({
          data: {
            id: rollbackVisitorId,
            name: 'AUD01-ROLLBACK',
            referralCode: 'AUDRBH',
            isActive: true,
          },
        });
        await repository.append(
          duplicate,
          new PrismaTransactionContext(client),
        );
      }),
    ).rejects.toThrow();
    expect(
      await prisma.visitor.findUnique({ where: { id: rollbackVisitorId } }),
    ).toBeNull();
  });

  it('does not require actor/entity rows and supports concurrent appends', async () => {
    await Promise.all(
      Array.from({ length: 20 }, () => repository.append(event())),
    );
    expect(
      await prisma.auditLog.count({ where: { correlationId: 'aud01-test' } }),
    ).toBe(20);
  });
});
