import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DrizzleService } from '@/database/drizzle.service';
import { settings } from '@/database/schema';
import { Env } from '@/common/config/env';
import { OvertimeTypesService } from '@/overtime-types/overtime-types.service';

/** Idempotent first-run data (default overtime types, settings row). Tests truncate and seed their own. */
@Injectable()
export class BootstrapService implements OnModuleInit {
  constructor(private readonly drizzle: DrizzleService, private readonly types: OvertimeTypesService, private readonly config: ConfigService<Env, true>) {}

  async onModuleInit(): Promise<void> {
    if (this.config.get('NODE_ENV') === 'test') return;
    await this.types.ensureDefaults();
    await this.drizzle.db.insert(settings).values({ id: 1, defaultTimezone: this.config.get('DEFAULT_TIMEZONE') }).onConflictDoNothing();
  }
}
