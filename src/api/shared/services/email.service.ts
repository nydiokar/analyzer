import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { EmailEventService } from './email-event.service';
import { Resend } from 'resend';
import { render } from '@react-email/render';
import { VerificationEmail } from '../../../emails/VerificationEmail';
import { getErrorMessage, getErrorDetails } from '../../../core/utils/error-utils';


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
      this.logger.error('Failed to configure email service:', getErrorMessage(error));
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
    const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000');
    const resetUrl = `${frontendUrl}/reset-password?token=${token}&email=${encodeURIComponent(email)}`;

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
            <p>Click the button below to reset your password. If you did not request this, you can safely ignore this email.</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${resetUrl}" style="background: #3b82f6; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">Reset Password</a>
            </div>
            <p style="color: #666; font-size: 14px;">Or copy and paste this URL into your browser:</p>
            <p style="background: #f5f5f5; padding: 10px; border-radius: 5px; word-break: break-all; font-size: 12px;">${resetUrl}</p>
            <p style="color: #999; font-size: 12px;">This link will expire in 1 hour.</p>
          </body>
          </html>
        `;
    const text = `Reset your password by clicking this link: ${resetUrl}\n\nThis link expires in 1 hour.\n\nIf you didn't request this, you can safely ignore this email.`;

    return this.sendEmail({
      to: email,
      subject,
      html,
      text,
      devLog: `Password reset email to ${email} token: ${token}`,
    });
  }

  async sendPasswordResetConfirmationEmail(email: string): Promise<boolean> {
    if (await this.emailEventService.isSuppressed(email)) {
      this.logger.warn(`Skipping password reset confirmation email to suppressed address: ${email}`);
      return false;
    }

    const appName = this.configService.get<string>('APP_NAME', 'Sova Intel');
    const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000');
    const timestamp = new Date().toLocaleString('en-US', {
      timeZone: 'UTC',
      dateStyle: 'medium',
      timeStyle: 'short'
    });

    const subject = `Your ${appName} password was changed`;
    const html = `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <title>Password changed</title>
          </head>
          <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: #10b981; color: white; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
              <h2 style="margin: 0; font-size: 18px;">✓ Password Changed Successfully</h2>
            </div>
            <p>Your ${appName} password was successfully changed at ${timestamp} UTC.</p>
            <p>If you made this change, no further action is needed.</p>
            <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; border-radius: 3px;">
              <p style="margin: 0; color: #92400e;"><strong>Didn't make this change?</strong></p>
              <p style="margin: 10px 0 0 0; color: #92400e;">If you didn't reset your password, your account may be compromised. Please contact support immediately.</p>
            </div>
            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
              <p style="color: #666; font-size: 14px; margin: 5px 0;"><strong>Security tips:</strong></p>
              <ul style="color: #666; font-size: 14px; line-height: 1.6;">
                <li>Use a unique password for ${appName}</li>
                <li>Never share your password with anyone</li>
              </ul>
            </div>
            <p style="color: #999; font-size: 12px; margin-top: 30px;">
              Need help? Visit <a href="${frontendUrl}" style="color: #3b82f6;">${frontendUrl}</a>
            </p>
          </body>
          </html>
        `;
    const text = `Your ${appName} password was successfully changed at ${timestamp} UTC.

If you made this change, no further action is needed.

DIDN'T MAKE THIS CHANGE?
If you didn't reset your password, your account may be compromised. Please contact support immediately.

Security tips:
- Use a unique password for ${appName}
- Never share your password with anyone

Need help? Visit ${frontendUrl}`;

    return this.sendEmail({
      to: email,
      subject,
      html,
      text,
      devLog: `Password reset confirmation email sent to ${email}`,
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
      this.logger.error(`Failed to send email to ${params.to}:`, getErrorMessage(error));
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
