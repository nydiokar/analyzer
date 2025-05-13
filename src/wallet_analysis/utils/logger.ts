import winston from 'winston';
import chalk from 'chalk';

const { createLogger: winstonCreateLogger, format, transports } = winston;
const { combine, timestamp, printf, colorize, errors } = format;

const levelColors: { [key: string]: (text: string) => string } = {
  error: chalk.red,
  warn: chalk.yellow,
  info: chalk.cyan,
  http: chalk.magenta,
  verbose: chalk.blue,
  debug: chalk.gray,
  silly: chalk.white
};

const logFormat = printf(({ level, message, timestamp, module, stack, ...metadata }) => {
  const ts = chalk.grey(new Date(timestamp as string).toISOString());
  const levelString = level.toUpperCase();
  const coloredLevel = levelColors[level] ? levelColors[level](levelString) : levelString;
  const moduleString = module ? chalk.yellow(`[${module}]`) : '';
  
  // Color numbers white in the main message
  let formattedMessage = String(message).replace(/\b(\d+(\.\d+)?)\b/g, chalk.white('$1'));

  let msg = `${ts} ${coloredLevel} ${moduleString} ${formattedMessage}`;

  if (Object.keys(metadata).length > 0) {
    msg += ` ${chalk.grey(JSON.stringify(metadata))}`;
  }

  if (stack) {
    msg += `\n${chalk.red(stack)}`;
  }

  return msg;
});

// --- Create a single, shared logger instance ---
const globalLogger = winstonCreateLogger({
  level: process.env.LOG_LEVEL || 'debug',
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
    new transports.File({
      filename: `logs/error.log`,
      level: 'error',
      // handleExceptions: false, // Let the console transport handle exceptions primarily
    }),
    new transports.File({
      filename: `logs/combined.log`,
      // handleExceptions: false, // Let the console transport handle exceptions primarily
    })
  ],
});

// Function to get a child logger with a specific module name
// This reuses the transports of the globalLogger and its exception handling settings
export const createLogger = (moduleName: string) => {
  return globalLogger.child({ module: moduleName });
};

// Export a default logger instance (child of global) for convenience if some module needs a quick default.
// This default child logger will also use the globalLogger's transports and settings.
export default createLogger('default');
