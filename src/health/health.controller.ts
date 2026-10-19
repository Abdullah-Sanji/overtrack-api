import { Controller, Get } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DrizzleService } from '@/database/drizzle.service';
import { Public } from '@/common/auth/public.decorator';

@Controller('health')
export class HealthController {
  constructor(private readonly drizzle: DrizzleService) {}

  @Public()
  @Get()
  async check() {
    await this.drizzle.db.execute(sql`select 1`);
    return { data: { status: 'ok' } };
  }
}
