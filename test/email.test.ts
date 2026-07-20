/** Verifies pure digest rendering and transport-isolated SMTP behavior. */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { EmailConfig } from '../src/config/schema.js';
import type { DailyReport } from '../src/report/model.js';
import { renderEmailHtml, renderEmailText } from '../src/report/render/email.js';
import {
  EmailService,
  type EmailTransport,
  type EmailTransportFactory,
} from '../src/services/email.js';
import { EmailError } from '../src/util/errors.js';

test('email renderers use the DailyReport and omit empty optional sections', () => {
  const report = dailyReport();
  const html = renderEmailHtml(report);
  const text = renderEmailText(report);

  assert.match(html, /Band A/);
  assert.match(html, /New Grad &lt;Engineer&gt;/);
  assert.match(html, /title-only/);
  assert.doesNotMatch(html, /Auto-applied/);
  assert.doesNotMatch(html, /Needs attention/);
  assert.match(text, /35 · Example · New Grad <Engineer> \[title-only\]/);
  assert.doesNotMatch(text, /Auto-applied/);
});

test('SMTP uses the environment password first and sends multipart signal', async () => {
  let transportOptions: Parameters<EmailTransportFactory>[0] | null = null;
  let sentMessage: Parameters<EmailTransport['sendMail']>[0] | null = null;
  const transport: EmailTransport = {
    verify: () => Promise.resolve(),
    sendMail: (message) => {
      sentMessage = message;
      return Promise.resolve();
    },
  };
  const service = new EmailService(emailConfig('plaintext-fallback'), {
    environment: { EMPLOYED_SMTP_PASSWORD: 'environment-secret' },
    createTransport: (options) => {
      transportOptions = options;
      return transport;
    },
  });

  await service.sendDigest(dailyReport());

  assert.equal(transportOptions?.auth.pass, 'environment-secret');
  assert.equal(sentMessage?.subject, 'employed — 1 new role (1 A-band) — 2026-07-20');
  assert.match(sentMessage?.html ?? '', /<html>/);
  assert.match(sentMessage?.text ?? '', /New Grad/);
});

test('SMTP failures become typed EmailError while verify returns status data', async () => {
  const transport: EmailTransport = {
    verify: () => Promise.reject(new Error('connection refused')),
    sendMail: () => Promise.reject(new Error('mailbox unavailable')),
  };
  const service = new EmailService(emailConfig('secret'), {
    environment: {},
    createTransport: () => transport,
  });

  await assert.rejects(() => service.sendDigest(dailyReport()), EmailError);
  assert.deepEqual(await service.verify(), {
    reachable: false,
    detail: 'connection refused',
  });
});

function emailConfig(password: string): EmailConfig {
  return {
    enabled: true,
    to: 'recipient@example.com',
    from: 'sender@example.com',
    smtp: {
      host: 'smtp.example.com',
      port: 465,
      user: 'sender@example.com',
      password,
    },
  };
}

function dailyReport(): DailyReport {
  return {
    date: '2026-07-20',
    runStats: null,
    newJobsByBand: {
      A: [
        {
          score: 35,
          band: 'A',
          company: 'Example',
          title: 'New Grad <Engineer>',
          location: 'Remote',
          url: 'https://example.com/jobs/1?a=1&b=2',
          ageDays: 0,
          titleOnly: true,
        },
      ],
      B: [],
      C: [],
      D: [],
    },
    autoApplied: [],
    needsAttention: [],
  };
}
