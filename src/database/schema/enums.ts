import { pgEnum } from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', ['employee', 'tech_lead', 'delivery_manager', 'cto', 'finance', 'admin']);
export const sheetStatusEnum = pgEnum('sheet_status', ['draft', 'submitted', 'approved', 'rejected', 'paid']);
export const approvalStepStatusEnum = pgEnum('approval_step_status', ['pending', 'approved', 'rejected', 'skipped']);
export const passwordTokenPurposeEnum = pgEnum('password_token_purpose', ['invite', 'reset']);

export type UserRole = (typeof userRoleEnum.enumValues)[number];
export type SheetStatus = (typeof sheetStatusEnum.enumValues)[number];
export type ApprovalStepStatus = (typeof approvalStepStatusEnum.enumValues)[number];
