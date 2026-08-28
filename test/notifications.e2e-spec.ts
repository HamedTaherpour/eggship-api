import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.setup';
import { createOpenApiDocument } from '../src/common/openapi/openapi.document';
import { PrismaService } from '../src/infrastructure/database/prisma/prisma.service';
import type { NotificationRecord } from '../src/modules/notifications/domain/notification';
import { NotificationInboxService } from '../src/modules/notifications/application/notification-inbox.service';
import { AuthSubjectType } from '../src/modules/auth/domain/subject-type';

const notificationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function sign(
  subjectType: AuthSubjectType,
  subjectId: string = randomUUID(),
): string {
  return jwt.sign(
    {
      sub: subjectId,
      subjectType,
      sessionId: randomUUID(),
      tokenUse: 'access',
    },
    process.env['JWT_ACCESS_SECRET'] ?? '',
    { algorithm: 'HS256', expiresIn: 900 },
  );
}

function sample(ownerId: string): NotificationRecord {
  return {
    id: notificationId,
    userId: ownerId,
    type: 'ORDER_STATUS',
    source: 'SYSTEM',
    title: 'Order updated',
    body: 'Your order is ready.',
    payload: { destination: 'orders' },
    createdAt: new Date('2026-08-28T10:00:00.000Z'),
    readAt: null,
  };
}

class FakeNotificationInboxService {
  ownerIds: string[] = [];
  markReadResult: NotificationRecord | null = null;

  listOwned(
    ownerId: string,
    query: { page?: number; pageSize?: number },
  ): Promise<{
    data: NotificationRecord[];
    meta: { page: number; pageSize: number; total: number; totalPages: number };
  }> {
    this.ownerIds.push(ownerId);
    const item = sample(ownerId);
    return Promise.resolve({
      data: [item],
      meta: {
        page: query.page ?? 1,
        pageSize: query.pageSize ?? 20,
        total: 1,
        totalPages: 1,
      },
    });
  }

  countUnread(ownerId: string): Promise<number> {
    this.ownerIds.push(ownerId);
    return Promise.resolve(1);
  }

  markRead(ownerId: string, _id: string): Promise<NotificationRecord> {
    void _id;
    this.ownerIds.push(ownerId);
    return this.markReadResult === null
      ? Promise.reject(new Error('unexpected test setup'))
      : Promise.resolve(this.markReadResult);
  }

  markAllRead(ownerId: string): Promise<number> {
    this.ownerIds.push(ownerId);
    return Promise.resolve(1);
  }
}

describe('Customer notification inbox HTTP (NOT-02, e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let fake: FakeNotificationInboxService;
  let userId: string;

  beforeAll(async () => {
    fake = new FakeNotificationInboxService();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(NotificationInboxService)
      .useValue(fake)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApplication(app);
    await app.init();
    server = app.getHttpServer() as Server;
  });

  beforeEach(() => {
    fake.ownerIds = [];
    userId = randomUUID();
    fake.markReadResult = sample(userId);
  });

  afterAll(async () => app.close());

  it('enforces authentication and customer subject separation', async () => {
    await request(server).get('/api/v1/notifications').expect(401);
    await request(server)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${sign(AuthSubjectType.ADMIN)}`)
      .expect(403);
    expect(fake.ownerIds).toEqual([]);
  });

  it('lists with principal-bound pagination and minimizes the response', async () => {
    const response = await request(server)
      .get('/api/v1/notifications?page=2&pageSize=10')
      .set('Authorization', `Bearer ${sign(AuthSubjectType.USER, userId)}`)
      .expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(fake.ownerIds).toEqual([userId]);
    const body = response.body as {
      data: Array<Record<string, unknown>>;
      meta: Record<string, unknown>;
    };
    expect(body.meta).toMatchObject({ page: 2, pageSize: 10 });
    expect(body.data[0]).toMatchObject({
      id: notificationId,
      type: 'ORDER_STATUS',
    });
    expect(body.data[0]).not.toHaveProperty('userId');
    expect(body.data[0]).not.toHaveProperty('source');
  });

  it('rejects unknown queries and protects cookie mutations with global CSRF', async () => {
    const token = sign(AuthSubjectType.USER, userId);
    await request(server)
      .get('/api/v1/notifications?userId=spoof')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    await request(server)
      .patch(`/api/v1/notifications/${notificationId}/read`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await request(server)
      .patch(`/api/v1/notifications/${notificationId}/read`)
      .set('Cookie', 'eggship_at=cookie-authenticated-token')
      .expect(403);
    expect(fake.ownerIds).toContain(userId);
  });

  it('documents the four deterministic inbox operations', () => {
    const document = createOpenApiDocument(app);
    expect(document.paths['/api/v1/notifications']?.get?.operationId).toBe(
      'Notifications_list',
    );
    expect(
      document.paths['/api/v1/notifications/unread-count']?.get?.operationId,
    ).toBe('Notifications_unreadCount');
    expect(
      document.paths['/api/v1/notifications/{id}/read']?.patch?.operationId,
    ).toBe('Notifications_markRead');
    expect(
      document.paths['/api/v1/notifications/read-all']?.post?.operationId,
    ).toBe('Notifications_markAllRead');
  });
});
