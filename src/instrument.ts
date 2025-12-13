import * as Sentry from "@sentry/nestjs";
import { nodeProfilingIntegration } from "@sentry/profiling-node";
import * as dotenv from 'dotenv';

// Load environment variables FIRST
dotenv.config();

// Only initialize Sentry if DSN is provided
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'production',

    // Performance Monitoring
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

    // Profiling
    profilesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    integrations: [nodeProfilingIntegration()],

    // Enable logs
    enableLogs: true,

    // Release tracking
    release: process.env.npm_package_version,
  });

  console.log('🔍 Sentry monitoring initialized');
} else {
  console.warn('⚠️  SENTRY_DSN not set - monitoring disabled');
}
