/** 新規コードでは createLogger() を使うこと。既存の new Logger() も動作する。 */
export function createLogger(context: string): Logger {
  return new Logger(context);
}

export class Logger {
  private context: string;

  constructor(context: string) {
    this.context = context;
  }

  private formatMessage(level: string, message: string, data?: any): string {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level}] [${this.context}]`;

    if (data) {
      return `${prefix} ${message}\n${JSON.stringify(data, null, 2)}`;
    }
    return `${prefix} ${message}`;
  }

  debug(message: string, data?: any) {
    const isDebug = process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development';
    if (isDebug) {
      console.log(this.formatMessage('DEBUG', message, data));
    }
  }

  info(message: string, data?: any) {
    console.log(this.formatMessage('INFO', message, data));
  }

  warn(message: string, data?: any) {
    console.warn(this.formatMessage('WARN', message, data));
  }

  error(message: string, error?: any) {
    const errorData = error instanceof Error ? {
      errorMessage: error.message,
      stack: error.stack,
      ...error
    } : error;
    console.error(this.formatMessage('ERROR', message, errorData));
  }
}