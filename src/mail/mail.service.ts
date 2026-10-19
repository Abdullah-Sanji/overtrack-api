import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { Transporter } from 'nodemailer';
import { Env } from '@/common/config/env';

export interface MailMessage { to: string; subject: string; html: string }

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter;
  readonly sent: MailMessage[] = [];
  private readonly isTest: boolean;

  constructor(private readonly config: ConfigService<Env, true>) {
    this.isTest = config.get('NODE_ENV') === 'test';
    this.transporter = this.isTest ? nodemailer.createTransport({ jsonTransport: true }) : nodemailer.createTransport(config.get('SMTP_URL'));
  }

  async send(msg: MailMessage): Promise<void> {
    if (this.isTest) { this.sent.push(msg); return; }
    try {
      await this.transporter.sendMail({ from: this.config.get('MAIL_FROM'), ...msg });
    } catch (err) {
      this.logger.error(`Failed to send "${msg.subject}" to ${msg.to}: ${(err as Error).message}`);
    }
  }
}
