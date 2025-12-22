Route A: AWS SES

Create sending identity: mail.sovaintel.com. Verify domain.

Add DNS: 3 DKIM CNAMEs, SPF TXT (“v=spf1 include:amazonses.com -all”), DMARC TXT (“v=DMARC1; p=quarantine; rua=mailto:dmarc@…; ruf=mailto:dmarc@…”).

Request production access in SES console; set region (eu-central-1 or eu-west-1).

Create IAM user with SES SendEmail permission; store AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY.

Build a BullMQ mail queue to decouple send latency from API responses.

.env (SES SMTP or API—prefer API):

MAIL_PROVIDER=ses
AWS_REGION=eu-central-1
AWS_ACCESS_KEY_ID=xxxxx
AWS_SECRET_ACCESS_KEY=xxxxx
MAIL_FROM=no-reply@mail.sovaintel.com


NestJS minimal sender (AWS SDK v3, API path):

import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

@Injectable()
export class MailService {
  private ses = new SESv2Client({ region: process.env.AWS_REGION });

  async send(opts: { to: string; subject: string; html: string; text?: string; idempotencyKey?: string }) {
    const cmd = new SendEmailCommand({
      FromEmailAddress: process.env.MAIL_FROM,
      Destination: { ToAddresses: [opts.to] },
      Content: {
        Simple: {
          Subject: { Data: opts.subject, Charset: "UTF-8" },
          Body: {
            Html: { Data: opts.html, Charset: "UTF-8" },
            Text: { Data: opts.text ?? "", Charset: "UTF-8" }
          }
        }
      }
    });
    const res = await this.ses.send(cmd, { requestChecksum: { requestValidation: "ENFORCE" } });
    return res.MessageId;
  }
}


Webhook handling:

Set SNS → HTTPS webhook to your backend for Bounce and Complaint notifications.

Persist in suppression table: {email, reason, ts}. Check before every send.

BullMQ policy:

Attempts: 5; backoff: exponential with jitter; starting delay 2s; max 2m.

Rate limit per provider quotas (SES: start low, e.g., 5 req/s, then increase as SES raises limits).

Idempotency: jobId = hash(to, template, payload); drop duplicates.

Route B: Resend (or SendGrid)

Create sending domain mail.sovaintel.com. Verify DKIM/SPF/DMARC via provider-given DNS.

Create API key.

Implement send with provider SDK; same queueing, suppression, and logging patterns.

.env:

MAIL_PROVIDER=resend
RESEND_API_KEY=re_****
MAIL_FROM=no-reply@mail.sovaintel.com


NestJS minimal sender (Resend):

import { Resend } from "resend";
@Injectable()
export class MailService {
  private resend = new Resend(process.env.RESEND_API_KEY);
  async send({ to, subject, html, text }: { to: string; subject: string; html: string; text?: string }) {
    const res = await this.resend.emails.send({ from: process.env.MAIL_FROM!, to, subject, html, text });
    return res.id;
  }
}


Template strategy:

Use a server-side templater (e.g., nunjucks/handlebars) or React Email compiled to HTML at build-time.

Store templates with semantic versioning, e.g., auth/verify-email@1.2.

Keep inline CSS, no remote assets for critical transactional mail.

Plain-text alternative mandatory.

Environment tiering:

Local dev: log tokens + optional Gmail app password for quick smoke tests.

Staging: provider sandbox or low-volume plan with real sends to a seed list.

Prod: SES or Resend/SendGrid with warmed domain, monitoring, and alarms.

Monitoring and alerts:

Track: sent, delivered, bounce, complaint, block, deferred; per template and per ISP.

Alarms: bounce >2% in 24h, complaint >0.1%, hard-bounces spike, 4xx deferrals sustained.

Seed inboxes across Gmail/Outlook/Yahoo to spot deliverability drift.

Decision:

If you want lowest cost and maximal control: Route A (AWS SES).

If you want speed and simpler ops with good tooling: Route B (Resend; SendGrid as alternative).