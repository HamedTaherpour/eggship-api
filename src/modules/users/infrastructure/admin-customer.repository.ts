import { Injectable } from '@nestjs/common';
import { toSkipTake, type PageResult } from '../../../common/list';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import type {
  AdminCustomerListQuery,
  AdminCustomerRecord,
  AdminCustomerSortField,
} from '../domain/customer-admin';

type PrismaAdminCustomerRow = {
  id: string;
  phone: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  referralAttribution: {
    referralCode: string;
    attributedAt: Date;
    visitor: {
      id: string;
      name: string;
      isActive: boolean;
    };
  } | null;
};

const SORT_FIELD_MAP: Record<
  AdminCustomerSortField,
  'createdAt' | 'updatedAt'
> = {
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
};

const adminCustomerInclude = {
  referralAttribution: {
    include: {
      visitor: {
        select: { id: true, name: true, isActive: true },
      },
    },
  },
} as const;

/**
 * Read-only Admin persistence boundary for store/customer (User) accounts.
 *
 * Single-query `include` of the immutable referral attribution + Visitor
 * display fields avoids N+1 fan-out. No mutation API lives here by design
 * (ADM-02 out of scope: editing identity credentials).
 */
@Injectable()
export class AdminCustomerRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    query: AdminCustomerListQuery,
  ): Promise<PageResult<AdminCustomerRecord>> {
    const where = buildAdminCustomerWhere(query);
    const { skip, take } = toSkipTake({
      page: query.page,
      pageSize: query.pageSize,
    });
    const orderField = SORT_FIELD_MAP[query.sortBy];

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        include: adminCustomerInclude,
        orderBy: [{ [orderField]: query.sortOrder }, { id: query.sortOrder }],
        skip,
        take,
      }),
    ]);

    return { items: rows.map(mapAdminCustomer), total };
  }

  async findById(id: string): Promise<AdminCustomerRecord | null> {
    const found = await this.prisma.user.findUnique({
      where: { id },
      include: adminCustomerInclude,
    });
    return found === null ? null : mapAdminCustomer(found);
  }
}

export function buildAdminCustomerWhere(
  query: Pick<AdminCustomerListQuery, 'search' | 'isActive' | 'hasReferral'>,
): Prisma.UserWhereInput {
  const where: Prisma.UserWhereInput = {};

  if (query.search !== undefined) {
    where.phone = { contains: query.search, mode: 'insensitive' };
  }

  if (query.isActive !== undefined) {
    where.isActive = query.isActive;
  }

  if (query.hasReferral !== undefined) {
    where.referralAttribution =
      query.hasReferral === true ? { isNot: null } : { is: null };
  }

  return where;
}

function mapAdminCustomer(row: PrismaAdminCustomerRow): AdminCustomerRecord {
  const attribution = row.referralAttribution;
  return {
    id: row.id,
    phone: row.phone,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    referral:
      attribution === null
        ? null
        : {
            visitorId: attribution.visitor.id,
            visitorName: attribution.visitor.name,
            visitorIsActive: attribution.visitor.isActive,
            referralCode: attribution.referralCode,
            attributedAt: attribution.attributedAt,
          },
  };
}
