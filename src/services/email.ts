/** SMTP delivery for the renderer-neutral daily report. */
import nodemailer from 'nodemailer';

import type { EmailConfig } from '../config/schema.js';
import type { DailyReport } from '../report/model.js';
import { renderEmailHtml, renderEmailText } from '../report/render/email.js';
import { EmailError } from '../util/errors.js';

export interface EmailStatus {
  reachable: boolean;
  detail: string;
}

interface MailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailTransport {
  verify(): Promise<unknown>;
  sendMail(message: MailMessage): Promise<unknown>;
}

export type EmailTransportFactory = (options: {
  host: string;
  port: number;
  secure: boolean;
  auth: { user: string; pass: string };
}) => EmailTransport;

export interface EmailServiceOptions {
  createTransport?: EmailTransportFactory;
  environment?: NodeJS.ProcessEnv;
}

/** Sends and verifies SMTP without owning report assembly or run failure policy. */
export class EmailService {
  private readonly transport: EmailTransport;

  public constructor(
    private readonly config: EmailConfig,
    options: EmailServiceOptions = {},
  ) {
    const missingField = [
      ['email.to', config.to],
      ['email.from', config.from],
      ['email.smtp.host', config.smtp.host],
      ['email.smtp.user', config.smtp.user],
    ].find(([, value]) => !value?.trim());
    if (missingField) {
      throw new EmailError(`SMTP delivery is not configured: ${missingField[0]} is required.`);
    }
    const environment = options.environment ?? process.env;
    const password = environment.EMPLOYED_SMTP_PASSWORD?.trim() || config.smtp.password.trim();
    if (!password) {
      throw new EmailError(
        'SMTP password is missing. Set EMPLOYED_SMTP_PASSWORD (recommended) and retry.',
      );
    }
    const createTransport = options.createTransport ?? nodemailer.createTransport;
    this.transport = createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: { user: config.smtp.user, pass: password },
    });
  }

  public async sendDigest(report: DailyReport): Promise<void> {
    try {
      await this.transport.sendMail({
        from: this.config.from,
        to: this.config.to,
        subject: buildSubject(report),
        text: renderEmailText(report),
        html: renderEmailHtml(report),
      });
    } catch (error: unknown) {
      throw new EmailError(`Email digest could not be sent: ${errorMessage(error)}`, {
        cause: error,
      });
    }
  }

  public async verify(): Promise<EmailStatus> {
    try {
      await this.transport.verify();
      return { reachable: true, detail: `${this.config.smtp.host}:${this.config.smtp.port}` };
    } catch (error: unknown) {
      return { reachable: false, detail: errorMessage(error) };
    }
  }
}

export function buildSubject(report: DailyReport): string {
  const newJobs = Object.values(report.newJobsByBand).reduce(
    (total, jobs) => total + jobs.length,
    0,
  );
  const aBand = report.newJobsByBand.A.length;
  const roleLabel = newJobs === 1 ? 'role' : 'roles';
  return `employed — ${newJobs} new ${roleLabel} (${aBand} A-band) — ${report.date}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
