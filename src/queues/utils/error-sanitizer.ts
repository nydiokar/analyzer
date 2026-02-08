/**
 * Sanitizes error messages for user-friendly display
 * Extracts the core error message without technical stack traces or internal details
 */
export function sanitizeErrorMessage(error: string | Error | unknown): string {
  if (!error) {
    return 'An unknown error occurred';
  }

  let errorString: string;

  if (typeof error === 'string') {
    errorString = error;
  } else if (error instanceof Error) {
    errorString = error.message;
  } else if (typeof error === 'object' && error !== null && 'message' in error) {
    errorString = String((error as { message: unknown }).message);
  } else {
    errorString = String(error);
  }

  // Handle Prisma validation errors - extract just the core issue
  if (errorString.includes('Invalid `prisma.')) {
    const match = errorString.match(/Invalid `([^`]+)` invocation/);
    if (match) {
      // Look for the actual error description
      const unknownArgMatch = errorString.match(/Unknown argument `([^`]+)`/);
      const missingArgMatch = errorString.match(/Argument `([^`]+)` is missing/);
      const invalidValueMatch = errorString.match(/Invalid value for argument `([^`]+)`/);

      if (unknownArgMatch) {
        return `Database validation error: Unknown field '${unknownArgMatch[1]}' in ${match[1]}()`;
      } else if (missingArgMatch) {
        return `Database validation error: Missing required field '${missingArgMatch[1]}' in ${match[1]}()`;
      } else if (invalidValueMatch) {
        return `Database validation error: Invalid value for '${invalidValueMatch[1]}' in ${match[1]}()`;
      }

      return `Database validation error in ${match[1]}()`;
    }
    return 'Database validation error occurred';
  }

  // Handle Prisma connection errors
  if (errorString.includes('PrismaClientKnownRequestError') || errorString.includes('P2002')) {
    return 'Database constraint violation - this record may already exist';
  }

  if (errorString.includes('PrismaClientInitializationError')) {
    return 'Database connection error - please try again';
  }

  // Handle other common database errors
  if (errorString.toLowerCase().includes('database') && errorString.toLowerCase().includes('connection')) {
    return 'Database connection error - please try again';
  }

  // Handle timeout errors
  if (errorString.toLowerCase().includes('timeout')) {
    return 'Operation timed out - please try again';
  }

  // Handle network errors
  if (errorString.toLowerCase().includes('econnrefused') || errorString.toLowerCase().includes('network')) {
    return 'Network connection error - please check your connection';
  }

  // Extract first line if it's a multi-line error
  const firstLine = errorString.split('\n')[0]?.trim();

  // If the first line is too long (more than 200 chars), it's likely a stack trace
  // In that case, try to find a more concise description
  if (firstLine && firstLine.length > 200) {
    // Look for common error patterns
    const patterns = [
      /Error: (.+?)(?:\n|$)/,
      /Exception: (.+?)(?:\n|$)/,
      /Failed to (.+?)(?:\n|$)/,
      /Cannot (.+?)(?:\n|$)/,
      /Unable to (.+?)(?:\n|$)/,
    ];

    for (const pattern of patterns) {
      const match = errorString.match(pattern);
      if (match && match[1] && match[1].length < 200) {
        return match[1].trim();
      }
    }

    // If still too long, just return a generic message
    return 'An error occurred during processing - please try again or contact support';
  }

  // Return the first line if it seems reasonable
  if (firstLine && firstLine.length > 0) {
    return firstLine;
  }

  return 'An error occurred during processing';
}
