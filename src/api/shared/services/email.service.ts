import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter | null = null;
  private isConfigured = false;

  constructor(private readonly configService: ConfigService) {
    this.initializeTransporter();
  }

  private initializeTransporter() {
    // Check if email is configured via environment variables
    const smtpHost = this.configService.get<string>('SMTP_HOST');
    const smtpPort = this.configService.get<number>('SMTP_PORT');
    const smtpUser = this.configService.get<string>('SMTP_USER');
    const smtpPass = this.configService.get<string>('SMTP_PASS');
    const fromEmail = this.configService.get<string>('SMTP_FROM_EMAIL');

    if (!smtpHost || !smtpPort || !smtpUser || !smtpPass || !fromEmail) {
      this.logger.warn('Email service not configured - missing SMTP environment variables');
      this.logger.warn('Required: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM_EMAIL');
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
      this.logger.log('Email service configured successfully');
    } catch (error) {
      this.logger.error('Failed to configure email service:', error);
    }
  }

  async sendVerificationEmail(email: string, token: string): Promise<boolean> {
    if (!this.isConfigured || !this.transporter) {
      this.logger.warn(`Email not configured - would send verification email to ${email} with token: ${token}`);
      return false;
    }

    const fromEmail = this.configService.get<string>('SMTP_FROM_EMAIL');
    const appName = this.configService.get<string>('APP_NAME', 'Sova Intel');
    const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000');

    try {
      const mailOptions = {
        from: `"${appName}" <${fromEmail}>`,
        to: email,
        subject: `Verify your ${appName} account`,
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <title>Verify your email</title>
          </head>
          <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #333;">Welcome to ${appName}!</h2>
            <p>Please verify your email address to complete your account setup.</p>
            <p>Your verification token is:</p>
            <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0; font-family: monospace; font-size: 16px; text-align: center;">
              <strong>${token}</strong>
            </div>
            <p>Copy and paste this token into the verification field in your account settings.</p>
            <p>This token will expire in 24 hours.</p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
            <p style="color: #666; font-size: 12px;">
              If you didn't create an account with ${appName}, you can safely ignore this email.
            </p>
          </body>
          </html>
        `,
        text: `
          Welcome to ${appName}!
          
          Please verify your email address to complete your account setup.
          
          Your verification token is: ${token}
          
          Copy and paste this token into the verification field in your account settings.
          This token will expire in 24 hours.
          
          If you didn't create an account with ${appName}, you can safely ignore this email.
        `,
      };

      await this.transporter.sendMail(mailOptions);
      this.logger.log(`Verification email sent successfully to ${email}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to send verification email to ${email}:`, error);
      return false;
    }
  }

  isEmailConfigured(): boolean {
    return this.isConfigured;
  }
}