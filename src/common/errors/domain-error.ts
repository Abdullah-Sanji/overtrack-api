export const ERROR_CODES = [
  'INVALID_CREDENTIALS', 'TOKEN_EXPIRED', 'TOKEN_REUSED', 'TOKEN_INVALID', 'USER_INACTIVE', 'UNAUTHORIZED', 'FORBIDDEN',
  'NOT_FOUND', 'CONFLICT', 'VALIDATION_FAILED', 'SHEET_NOT_EDITABLE', 'SHEET_VERSION_CONFLICT', 'SHEET_EMPTY', 'CHAIN_EMPTY', 'CHAIN_SELF_ONLY',
  'CHAIN_APPROVER_INACTIVE', 'NOT_CURRENT_APPROVER', 'INVALID_TRANSITION', 'ENTRY_OVERLAP', 'ENTRY_OUT_OF_PERIOD',
  'ENTRY_IN_FUTURE', 'ATTACHMENT_TOO_LARGE', 'ATTACHMENT_TYPE', 'ATTACHMENT_EXISTS', 'REASON_REQUIRED',
  'PAYMENT_REFERENCE_REQUIRED', 'ROLE_NAME_TAKEN', 'ROLE_IS_SYSTEM', 'ROLE_IN_USE', 'CANNOT_DEMOTE_SELF', 'USER_HAS_HISTORY', 'CANNOT_DELETE_SELF', 'TEAM_IN_USE', 'EMAIL_TAKEN', 'EMPLOYEE_CODE_TAKEN', 'TEAM_NAME_TAKEN', 'USER_HAS_NO_TEAM', 'RATE_LIMITED', 'INTERNAL',
  'GOOGLE_SIGNIN_DISABLED', 'GOOGLE_TOKEN_INVALID', 'GOOGLE_ACCOUNT_UNKNOWN',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: number = 400,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export const notFound = (what: string) => new DomainError('NOT_FOUND', `${what} not found`, 404);
export const forbidden = (msg = 'Forbidden') => new DomainError('FORBIDDEN', msg, 403);
