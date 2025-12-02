import winston from 'winston';
import chalk from 'chalk';
import DailyRotateFile from 'winston-daily-rotate-file';

// Extend Winston Logger interface to include trace method
declare module 'winston' {
  interface Logger {
    trace: (message: string, ...meta: any[]) => winston.Logger;
  }
}

// Note: For NestJS Logger, we use 'verbose' as the most detailed logging level
// since NestJS Logger doesn't have a 'trace' level

// Define our custom logger interface with all supported levels
interface CustomLogger extends winston.Logger {
  trace: (message: string, ...meta: any[]) => CustomLogger;
}

const { createLogger: winstonCreateLogger, format, transports } = winston;
const { combine, timestamp, printf, colorize, errors } = format;

const levelColors: { [key: string]: (text: string) => string } = {
  error: chalk.red,
  warn: chalk.yellow,
  info: chalk.cyan,
  http: chalk.magenta,
  verbose: chalk.blue,
  debug: chalk.gray,
  silly: chalk.white,
  trace: chalk.white
};

const logFormat = printf(({ level, message, timestamp, module, stack, ...metadata }) => {
  const ts = chalk.grey(new Date(timestamp as string).toISOString());
  const levelString = level.toUpperCase();
  const coloredLevel = levelColors[level] ? levelColors[level](levelString) : levelString;
  const moduleString = module ? chalk.yellow(`[${module}]`) : '';
  
  let formattedMessage = String(message);

  // Highlight Solana-like addresses (32-44 alphanumeric chars)
  formattedMessage = formattedMessage.replace(/\b([1-9A-HJ-NP-Za-km-z]{32,44})\b/g, chalk.blueBright('$1'));

  // Highlight numbers (integers and decimals)
  formattedMessage = formattedMessage.replace(/\b(\d+\.\d+|\d+)\b/g, (match, p1) => {
    // Avoid re-coloring parts of already colored addresses if they happen to be all numbers (unlikely for Solana)
    if (formattedMessage.includes(chalk.blueBright(p1))) return p1; 
    return chalk.whiteBright(match);
  });

  // Highlight progress indicators like X/Y or (X/Y)
  formattedMessage = formattedMessage.replace(/\b(\d+\/\d+)\b/g, chalk.magentaBright('$1'));
  formattedMessage = formattedMessage.replace(/\((\d+\/\d+)\)/g, `(${chalk.magentaBright('$1')})`);

  let msg = `${ts} ${coloredLevel} ${moduleString} ${formattedMessage}`;

  if (Object.keys(metadata).length > 0) {
    msg += ` ${chalk.grey(JSON.stringify(metadata))}`;
  }

  if (stack) {
    msg += `\n${chalk.red(stack)}`;
  }

  return msg;
});

// Custom log levels with trace as most verbose
const customLevels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  verbose: 4,
  debug: 5,
  silly: 6,
  trace: 7
};

// --- Create a single, shared logger instance ---
const globalLogger = winstonCreateLogger({
  level: process.env.LOG_LEVEL || 'debug',
  levels: customLevels,
  format: combine(
    errors({ stack: true }),
    timestamp(),
    logFormat
  ),
  transports: [
    new transports.Console({
      format: combine(
        colorize({ all: true }),
        logFormat
      ),
      handleExceptions: true, // Centralized exception handling
      handleRejections: true  // Centralized rejection handling
    }),
    new DailyRotateFile({
      filename: 'logs/error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxSize: '10m', // 10MB max file size
      maxFiles: '14d', // Keep 14 days of error logs
      zippedArchive: true, // Compress old log files
      handleExceptions: false,
    }),
    new DailyRotateFile({
      filename: 'logs/combined-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m', // 20MB max file size
      maxFiles: '7d', // Keep 7 days of combined logs
      zippedArchive: true, // Compress old log files
      handleExceptions: false,
    })
  ],
});

// Function to get a child logger with a specific module name
// This reuses the transports of the globalLogger and its exception handling settings
export const createLogger = (moduleName: string): CustomLogger => {
  return globalLogger.child({ module: moduleName }) as CustomLogger;
};

// Export a default logger instance (child of global) for convenience if some module needs a quick default.
// This default child logger will also use the globalLogger's transports and settings.
export default createLogger('default');