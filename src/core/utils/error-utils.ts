/**
 * Utility functions for safe error handling and serialization
 */

/**
 * Extracts a clean, loggable error message from any error type
 * Handles Error objects, AxiosError, and unknown error types
 */
export const getErrorMessage = (error: unknown): string => {
  if (!error) {
    return 'Unknown error';
  }

  // Handle standard Error objects
  if (error instanceof Error) {
    return error.message;
  }

  // Handle AxiosError specifically (common in HTTP services)
  if (typeof error === 'object' && error !== null) {
    const err = error as any;

    // AxiosError pattern
    if (err.isAxiosError) {
      const status = err.response?.status;
      const statusText = err.response?.statusText;
      const data = err.response?.data;

      if (status) {
        let message = `HTTP ${status}`;
        if (statusText) message += ` ${statusText}`;
        if (data?.message) message += `: ${data.message}`;
        else if (data?.error) message += `: ${data.error}`;
        return message;
      }

      if (err.code) {
        return `${err.code}: ${err.message || 'Network error'}`;
      }

      return err.message || 'HTTP request failed';
    }

    // Generic object with message property
    if ('message' in err && typeof err.message === 'string') {
      return err.message;
    }

    // Generic object - try to stringify
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }

  // Fallback for primitives
  return String(error);
};

/**
 * Extracts a concise error summary suitable for logging
 * Includes error type, message, and optional context
 */
export const getErrorSummary = (error: unknown, context?: string): string => {
  const message = getErrorMessage(error);

  if (error instanceof Error) {
    const errorType = error.name !== 'Error' ? `[${error.name}] ` : '';
    const contextStr = context ? `(${context}) ` : '';
    return `${contextStr}${errorType}${message}`;
  }

  const contextStr = context ? `(${context}) ` : '';
  return `${contextStr}${message}`;
};

/**
 * Extracts error details for debugging (includes stack trace info)
 * Only use this for error-level logging, not for warnings
 */
export const getErrorDetails = (error: unknown): { message: string; stack?: string; cause?: string } => {
  const message = getErrorMessage(error);

  if (error instanceof Error) {
    return {
      message,
      stack: error.stack?.split('\n').slice(0, 5).join('\n'), // First 5 lines only
      cause: error.cause ? getErrorMessage(error.cause) : undefined,
    };
  }

  return { message };
};

/**
 * Safe error object for logging - removes circular references and sensitive data
 */
export const sanitizeErrorForLogging = (error: unknown): Record<string, any> => {
  if (!error) {
    return { message: 'Unknown error' };
  }

  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.cause && { cause: getErrorMessage(error.cause) }),
    };
  }

  if (typeof error === 'object' && error !== null) {
    const err = error as any;

    // AxiosError
    if (err.isAxiosError) {
      return {
        type: 'AxiosError',
        message: getErrorMessage(error),
        status: err.response?.status,
        statusText: err.response?.statusText,
        code: err.code,
      };
    }

    // Generic error object - extract safe fields
    const safeFields: Record<string, any> = {};
    for (const key of ['name', 'message', 'code', 'status', 'statusCode']) {
      if (key in err && typeof err[key] !== 'object') {
        safeFields[key] = err[key];
      }
    }

    return Object.keys(safeFields).length > 0 ? safeFields : { message: String(error) };
  }

  return { message: String(error) };
};
