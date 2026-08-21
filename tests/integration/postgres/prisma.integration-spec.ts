import type { INestApplicationContext } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { createConfigModuleOptions } from '../../../src/config/config-module.options';
import { PrismaModule } from '../../../src/infrastructure/database/prisma/prisma.module';
import { PrismaService } from '../../../src/infrastructure/database/prisma/prisma.service';

describe('Prisma PostgreSQL infrastructure (integration)', () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot(createConfigModuleOptions()),
        PrismaModule,
      ],
    }).compile();

    app = moduleRef;
    prisma = moduleRef.get(PrismaService);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('connects through Prisma and executes SELECT 1 against real PostgreSQL', async () => {
    const rows = await prisma.$queryRaw<Array<{ ok: number }>>`
      SELECT 1::int AS ok
    `;
    expect(rows).toEqual([{ ok: 1 }]);
  });

  it('reports safe database identity metadata without leaking credentials', async () => {
    const rows = await prisma.$queryRaw<
      Array<{ database_name: string; user_name: string }>
    >`
      SELECT current_database() AS database_name, current_user AS user_name
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.database_name.length).toBeGreaterThan(0);
    expect(rows[0]?.user_name.length).toBeGreaterThan(0);

    const config = app.get(ConfigService);
    const databaseUrl = config.getOrThrow<string>('DATABASE_URL');
    expect(databaseUrl).toBe(process.env['TEST_DATABASE_URL']);
    expect(databaseUrl).not.toContain('example.invalid');
  });

  it('rolls back an infrastructure-safe transaction without durable side effects', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        const probe = await tx.$queryRaw<Array<{ ok: number }>>`
          SELECT 1::int AS ok
        `;
        expect(probe).toEqual([{ ok: 1 }]);
        throw new Error('intentional integration rollback');
      }),
    ).rejects.toThrow('intentional integration rollback');

    const stillConnected = await prisma.$queryRaw<Array<{ ok: number }>>`
      SELECT 1::int AS ok
    `;
    expect(stillConnected).toEqual([{ ok: 1 }]);
  });
});
