import { SetMetadata } from '@nestjs/common';
import { RoleLevel } from '@/database/schema';
export const LEVELS_KEY = 'levels';
export const Levels = (...levels: RoleLevel[]) => SetMetadata(LEVELS_KEY, levels);
