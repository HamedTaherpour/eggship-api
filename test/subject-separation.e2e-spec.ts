import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.setup';
import { PrismaService } from '../src/infrastructure/database/prisma/prisma.service';
import { AuthSubjectType } from '../src/modules/auth/domain/subject-type';
import {
  bootstrapBrowserCsrf,
  browserRequest,
  type BrowserCsrfSession,
} from './helpers/csrf-browser';

/**
 * USER / ADMIN subject separation at the HTTP boundary.
 *
 * ADMIN access tokens are issued by `AccessTokenService` once an AdminAuthSession
 * exists (ADM-AUTH-01). This suite still signs tokens directly so wrong-subject
 * HTTP behavior can be asserted without going through login.
 *
 * The customer routes here reject the subject before any persistence access, so
 * PrismaService is a stub and no database is contacted.
 */
function signAccessToken(subjectType: AuthSubjectType): string {
  return jwt.sign(
    {
      sub: randomUUID(),
      subjectType,
      sessionId: randomUUID(),
      tokenUse: 'access',
    },
    process.env['JWT_ACCESS_SECRET'] ?? '',
    { algorithm: 'HS256', expiresIn: 900 },
  );
}

describe('USER / ADMIN subject separation (e2e)', () => {
  let app: INestApplication;
  let csrf: BrowserCsrfSession;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        onModuleInit: (): void => undefined,
        onModuleDestroy: (): void => undefined,
      })
      .compile();

    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    csrf = await bootstrapBrowserCsrf(server());
  });

  function server(): Server {
    return app.getHttpServer() as Server;
  }

  describe('missing or invalid authentication answers 401', () => {
    it('rejects an anonymous customer request', async () => {
      const response = await request(server())
        .get('/api/v1/auth/me')
        .expect(401);

      expect(response.body).toMatchObject({
        error: { code: 'AUTH_UNAUTHENTICATED' },
      });
    });

    it('rejects a malformed access token', async () => {
      const response = await request(server())
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer not-a-jwt')
        .expect(401);

      expect(response.body).toMatchObject({
        error: { code: 'AUTH_INVALID_TOKEN' },
      });
    });

    it('rejects an anonymous logout-all', async () => {
      await browserRequest(
        request(server()).post('/api/v1/auth/logout-all'),
        csrf,
      ).expect(401);
    });
  });

  describe('an authenticated ADMIN subject is forbidden on customer flows', () => {
    it('cannot read the current customer identity', async () => {
      const response = await request(server())
        .get('/api/v1/auth/me')
        .set(
          'Authorization',
          `Bearer ${signAccessToken(AuthSubjectType.ADMIN)}`,
        )
        .expect(403);

      expect(response.body).toMatchObject({
        error: {
          code: 'AUTH_FORBIDDEN',
          message: 'Insufficient permissions.',
          details: {},
        },
      });
      expect(JSON.stringify(response.body)).not.toMatch(/ADMIN|subjectType/u);
    });

    it('cannot update a customer profile', async () => {
      const response = await request(server())
        .patch('/api/v1/users/me')
        .set(
          'Authorization',
          `Bearer ${signAccessToken(AuthSubjectType.ADMIN)}`,
        )
        .send({})
        .expect(403);

      expect(response.body).toMatchObject({
        error: { code: 'AUTH_FORBIDDEN' },
      });
    });

    it('cannot revoke customer sessions through logout-all', async () => {
      const response = await request(server())
        .post('/api/v1/auth/logout-all')
        .set(
          'Authorization',
          `Bearer ${signAccessToken(AuthSubjectType.ADMIN)}`,
        )
        .expect(403);

      expect(response.body).toMatchObject({
        error: { code: 'AUTH_FORBIDDEN' },
      });
    });

    it('cannot revoke a customer session through logout', async () => {
      const response = await request(server())
        .post('/api/v1/auth/logout')
        .set(
          'Authorization',
          `Bearer ${signAccessToken(AuthSubjectType.ADMIN)}`,
        )
        .expect(403);

      expect(response.body).toMatchObject({
        error: { code: 'AUTH_FORBIDDEN' },
      });
    });

    it('cannot become a customer by supplying a role or a user id', async () => {
      // Mass-assignment probe: the principal is the only identity source, and
      // unknown properties are rejected at the DTO boundary.
      const token = signAccessToken(AuthSubjectType.ADMIN);

      await request(server())
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ userId: randomUUID(), role: 'SUPER_ADMIN', isActive: true })
        .expect(400);
    });
  });

  it('forbids an authenticated ADMIN on customer identity routes and a USER on Admin /me', async () => {
    const adminToken = signAccessToken(AuthSubjectType.ADMIN);
    const userToken = signAccessToken(AuthSubjectType.USER);

    await request(server())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(403);

    const adminMe = await request(server())
      .get('/api/v1/admin/auth/me')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);
    expect(adminMe.body).toMatchObject({
      error: { code: 'AUTH_FORBIDDEN' },
    });
  });

  it('does not expose Admin account-management routes yet', async () => {
    const token = signAccessToken(AuthSubjectType.ADMIN);

    for (const path of ['/api/v1/admins', '/api/v1/admin/admins']) {
      await request(server())
        .get(path)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    }
  });
});
