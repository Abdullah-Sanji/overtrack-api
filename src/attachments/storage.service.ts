import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReadStream } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Env } from '@/common/config/env';

@Injectable()
export class StorageService {
  private readonly root: string;
  constructor(config: ConfigService<Env, true>) { this.root = path.resolve(config.get('STORAGE_PATH')); }

  async save(buffer: Buffer, ext: string): Promise<string> {
    await mkdir(this.root, { recursive: true });
    const key = `${randomUUID()}.${ext}`;
    await writeFile(path.join(this.root, key), buffer);
    return key;
  }
  stream(key: string) { return createReadStream(path.join(this.root, key)); }
  async remove(key: string): Promise<void> { await unlink(path.join(this.root, key)).catch(() => undefined); }
}
