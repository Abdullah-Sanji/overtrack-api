import { Injectable } from '@nestjs/common';
import { DbOrTx, DrizzleService } from '@/database/drizzle.service';
import { roles, SYSTEM_ROLES } from '@/database/schema';

@Injectable()
export class RolesService {
  constructor(private readonly drizzle: DrizzleService) {}

  /** Inserts the six system roles when missing (matched case-insensitively by name) and returns name → id. */
  async ensureSystemRoles(db: DbOrTx = this.drizzle.db): Promise<Map<string, string>> {
    await db
      .insert(roles)
      .values(SYSTEM_ROLES.map((r) => ({ ...r, isSystem: true })))
      .onConflictDoNothing();
    const rows = await db.select({ id: roles.id, name: roles.name }).from(roles);
    return new Map(rows.map((r) => [r.name, r.id]));
  }
}
