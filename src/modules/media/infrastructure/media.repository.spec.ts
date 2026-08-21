import type { MediaListQuery } from '../domain/media';
import { buildMediaListWhereForTest } from './media.repository';

describe('MediaRepository query mapping', () => {
  it('searches originalFileName only and maps allowlisted sort intent', () => {
    const query: MediaListQuery = {
      page: 1,
      pageSize: 20,
      search: 'egg',
      sortBy: 'createdAt',
      sortOrder: 'desc',
      mimeType: 'image/png',
      createdFrom: new Date('2026-01-01T00:00:00.000Z'),
      createdTo: new Date('2026-01-31T23:59:59.999Z'),
    };

    expect(buildMediaListWhereForTest(query)).toEqual({
      mimeType: 'image/png',
      originalFileName: { contains: 'egg', mode: 'insensitive' },
      createdAt: {
        gte: new Date('2026-01-01T00:00:00.000Z'),
        lte: new Date('2026-01-31T23:59:59.999Z'),
      },
    });
  });

  it('does not search storageKey', () => {
    const where = buildMediaListWhereForTest({
      page: 1,
      pageSize: 20,
      search: 'media/2026',
      sortBy: 'originalFileName',
      sortOrder: 'asc',
    });
    expect(where).not.toHaveProperty('storageKey');
    expect(where.originalFileName).toEqual({
      contains: 'media/2026',
      mode: 'insensitive',
    });
  });
});
