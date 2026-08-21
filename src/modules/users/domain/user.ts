/**
 * Persistence-facing user identity record (not a Prisma type).
 */
export interface UserRecord {
  id: string;
  phone: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserInput {
  phone: string;
  isActive?: boolean;
}
