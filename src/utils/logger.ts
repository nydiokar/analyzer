import winston from 'winston';

const { createLogger: winstonCreateLogger, format, transports } = winston;
const { combine, timestamp, printf, colorize } = format;

const logFormat = printf(({ level, message, timestamp, ...metadata }) => {
  let msg = `${timestamp} [${level}] ${message}`;
  if (Object.keys(metadata).length > 0) {
    msg += ` ${JSON.stringify(metadata)}`;
  }
  return msg;
});

export const createLogger = (module: string) => {
  return winstonCreateLogger({
    format: combine(
      timestamp(),
      colorize(),
      logFormat
    ),
    transports: [
      new transports.Console({
        level: process.env.LOG_LEVEL || 'info'
      }),
      new transports.File({
        filename: `logs/error.log`,
        level: 'error'
      }),
      new transports.File({
        filename: `logs/combined.log`
      })
    ],
    defaultMeta: { module }
  });
};

export default createLogger('default');
