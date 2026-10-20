import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import { Env } from '@/common/config/env';
import { DomainError } from '@/common/errors/domain-error';

export interface GoogleIdentity { email: string; emailVerified: boolean }

/** Verifies a Google Identity Services credential (ID token) against our OAuth client id. Overridden with a stub in tests. */
@Injectable()
export class GoogleTokenVerifier {
  private client?: OAuth2Client;
  constructor(private readonly config: ConfigService<Env, true>) {}

  async verify(credential: string): Promise<GoogleIdentity> {
    const clientId = this.config.get('GOOGLE_CLIENT_ID');
    try {
      this.client ??= new OAuth2Client(clientId);
      const ticket = await this.client.verifyIdToken({ idToken: credential, audience: clientId });
      const payload = ticket.getPayload();
      if (!payload?.email) throw new Error('no email in token');
      return { email: payload.email, emailVerified: payload.email_verified === true };
    } catch {
      throw new DomainError('GOOGLE_TOKEN_INVALID', 'Google sign-in failed, try again', 401);
    }
  }
}
