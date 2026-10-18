import { Controller, Get } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DrizzleService } from '@/database/drizzle.service';

@Controller('health')
export class HealthController {
  constructor(private readonly drizzle: DrizzleService) {}

  @Get()
  async check() {
    await this.drizzle.db.execute(sql`select 1`);
    return { data: { status: 'ok' } };
  }
}
