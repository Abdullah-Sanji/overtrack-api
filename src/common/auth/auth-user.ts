import { RoleLevel } from '@/database/schema';
export interface AuthUser { id: string; roleId: string; level: RoleLevel; teamId: string | null }
export const MANAGER_LEVELS: RoleLevel[] = ['manager', 'finance', 'admin'];
export const isAdmin = (u: Pick<AuthUser, 'level'>) => u.level === 'admin';
export const isFinanceOrAdmin = (u: Pick<AuthUser, 'level'>) => u.level === 'finance' || u.level === 'admin';
