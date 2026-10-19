import { UserRole } from '@/database/schema';
export interface AuthUser { id: string; role: UserRole; teamId: string | null }
export const ADMIN: UserRole[] = ['admin'];
export const FINANCE_OR_ADMIN: UserRole[] = ['finance', 'admin'];
export const MANAGER_ROLES: UserRole[] = ['tech_lead', 'delivery_manager', 'cto', 'finance', 'admin'];
