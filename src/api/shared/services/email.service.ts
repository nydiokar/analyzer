import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { EmailEventService } from './email-event.service';
import { Resend } from 'resend';
import { render } from '@react-email/render';
import { VerificationEmail } from '../../../emails/VerificationEmail';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter | null = null;
  private isConfigured = false;
  private readonly provider: 'smtp' | 'resend';
  private readonly resendApiKey?: string;
  private readonly mailFrom?: string;
  private resendClient: Resend | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly emailEventService: EmailEventService,
  ) {
    this.provider = (this.configService.get<string>('MAIL_PROVIDER') as 'smtp' | 'resend') || 'smtp';
    this.resendApiKey = this.configService.get<string>('RESEND_API_KEY') || undefined;
    this.mailFrom = this.configService.get<string>('SMTP_FROM_EMAIL') || this.configService.get<string>('MAIL_FROM') || undefined;
    this.initializeTransporter();
  }

  private initializeTransporter() {
    if (this.provider === 'resend') {
      if (!this.resendApiKey || !this.mailFrom) {
        this.logger.warn('Resend selected but RESEND_API_KEY or MAIL_FROM missing; email will be logged only');
        return;
      }
      this.resendClient = new Resend(this.resendApiKey);
      this.isConfigured = true;
      this.logger.log('Email service configured for Resend');
      return;
    }

    // SMTP fallback
    const smtpHost = this.configService.get<string>('SMTP_HOST');
    const smtpPort = this.configService.get<number>('SMTP_PORT');
    const smtpUser = this.configService.get<string>('SMTP_USER');
    const smtpPass = this.configService.get<string>('SMTP_PASS');
    const fromEmail = this.mailFrom;

    if (!smtpHost || !smtpPort || !smtpUser || !smtpPass || !fromEmail) {
      this.logger.warn('Email service not configured - missing SMTP environment variables');
      this.logger.warn('Required: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM_EMAIL or MAIL_FROM');
      return;
    }

    try {
      this.transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465, // true for 465, false for other ports
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
      });

      this.isConfigured = true;
      this.logger.log('Email service configured successfully (SMTP)');
    } catch (error) {
      this.logger.error('Failed to configure email service:', error);
    }
  }

  async sendVerificationEmail(email: string, token: string): Promise<boolean> {
    if (await this.emailEventService.isSuppressed(email)) {
      this.logger.warn(`Skipping verification email to suppressed address: ${email}`);
      return false;
    }

    const appName = this.configService.get<string>('APP_NAME', 'Sova Intel');
    const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000');
    const verificationUrl = `${frontendUrl}/verify?token=${token}`;

    const subject = `Verify your ${appName} account`;

    // Render React Email template to HTML
    const html = await render(
      VerificationEmail({
        verificationUrl,
        appName,
      })
    );

    // Plain text fallback (used by email clients that don't support HTML)
    const text = `Verify your email

Welcome to ${appName}. Click the link below to verify your email address and start analyzing on-chain wallet behavior.

${verificationUrl}

This link will expire in 24 hours.

If you didn't create an account, you can safely ignore this email.`.trim();

    return this.sendEmail({
      to: email,
      subject,
      html,
      text,
      devLog: `Verification email to ${email} with URL: ${verificationUrl}`,
    });
  }

  async sendPasswordResetEmail(email: string, token: string): Promise<boolean> {
    if (await this.emailEventService.isSuppressed(email)) {
      this.logger.warn(`Skipping password reset email to suppressed address: ${email}`);
      return false;
    }

    const appName = this.configService.get<string>('APP_NAME', 'Sova Intel');
    const subject = `Reset your ${appName} password`;
    const html = `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <title>Password reset</title>
          </head>
          <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #333;">Password reset request</h2>
            <p>Use the token below to reset your password. If you did not request this, you can ignore this email.</p>
            <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0; font-family: monospace; font-size: 16px; text-align: center;">
              <strong>${token}</strong>
            </div>
            <p>This token will expire in 1 hour.</p>
          </body>
          </html>
        `;
    const text = `Use this token to reset your password: ${token}\nThis token expires in 1 hour.`;

    return this.sendEmail({
      to: email,
      subject,
      html,
      text,
      devLog: `Password reset email to ${email} token: ${token}`,
    });
  }

  private async sendEmail(params: {
    to: string;
    subject: string;
    html: string;
    text?: string;
    devLog?: string;
  }): Promise<boolean> {
    if (!(await this.isSendConfigured())) {
      if (params.devLog) {
        this.logger.warn(`Email not configured - would send: ${params.devLog}`);
      } else {
        this.logger.warn(`Email not configured - would send to ${params.to} with subject ${params.subject}`);
      }
      return false;
    }

    try {
      if (this.provider === 'resend' && this.resendApiKey && this.mailFrom) {
        if (!this.resendClient) {
          this.resendClient = new Resend(this.resendApiKey);
        }

        // Format sender with app name: "App Name <email@domain.com>"
        const appName = this.configService.get<string>('APP_NAME', 'Sova Intel');
        const fromAddress = `${appName} <${this.mailFrom}>`;

        const res = await this.resendClient.emails.send({
          from: fromAddress,
          to: params.to,
          subject: params.subject,
          html: params.html,
          text: params.text,
        });
        if (res.error) {
          this.logger.error(`Resend send failed to ${params.to}: ${res.error.message}`);
          return false;
        }
        this.logger.log(`Email sent via Resend to ${params.to}`);
        return true;
      }

      if (this.transporter && this.mailFrom) {
        const mailOptions = {
          from: this.mailFrom,
          to: params.to,
          subject: params.subject,
          html: params.html,
          text: params.text,
        } as any;

        await this.transporter.sendMail(mailOptions);
        this.logger.log(`Email sent via SMTP to ${params.to}`);
        return true;
      }

      this.logger.error('Email provider configured but transporter missing');
      return false;
    } catch (error) {
      this.logger.error(`Failed to send email to ${params.to}:`, error);
      return false;
    }
  }

  isEmailConfigured(): boolean {
    return this.isConfigured;
  }

  private async isSendConfigured(): Promise<boolean> {
    if (this.provider === 'resend') {
      return Boolean(this.isConfigured && this.resendApiKey && this.mailFrom);
    }
    return Boolean(this.isConfigured && this.transporter);
  }
}
