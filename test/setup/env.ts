// Vitest passes globalSetup-provided env to workers via process.env when set before workers spawn.
// Guard defaults for running a single spec directly.
process.env.NODE_ENV ??= 'test';
process.env.JWT_SECRET ??= 'test-secret-test-secret-test-secret-1234';
process.env.WEB_URL ??= 'http://localhost:5173';
process.env.CORS_ORIGIN ??= 'http://localhost:5173';
process.env.SMTP_URL ??= 'smtp://localhost:1025';
process.env.MAIL_FROM ??= 'test@overtrack.local';
process.env.STORAGE_PATH ??= './storage-test';
