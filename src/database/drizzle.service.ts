import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';
import { Env } from '@/common/config/env';

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

@Injectable()
export class DrizzleService implements OnModuleDestroy {
  readonly pool: Pool;
  readonly db: Db;

  constructor(config: ConfigService<Env, true>) {
    this.pool = new Pool({ connectionString: config.get('DATABASE_URL') });
    this.db = drizzle(this.pool, { schema });
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
