/**
 * ErrorHandler - Centralized error handling for Claude chat
 */

export class ErrorHandler {
  /**
   * Handle parsing errors
   */
  static handleParseError(error: any, data: any): {
    message: string;
    details: string;
  } {
    console.error('[ErrorHandler] Parse error:', error, 'Data:', data);

    return {
      message: 'Failed to parse message from Claude',
      details: error instanceof Error ? error.message : String(error),
    };
  }

  /**
   * Handle stream errors
   */
  static handleStreamError(error: any): {
    message: string;
    details: string;
  } {
    console.error('[ErrorHandler] Stream error:', error);

    if (error instanceof Error) {
      // Check for specific error types
      if (error.message.includes('ENOENT')) {
        return {
          message: 'Claude CLI not found',
          details: 'Please install Claude Code first.',
        };
      }

      if (error.message.includes('EACCES')) {
        return {
          message: 'Permission denied',
          details: 'Unable to execute Claude CLI. Please check file permissions.',
        };
      }

      if (error.message.includes('ECONNREFUSED')) {
        return {
          message: 'Connection refused',
          details: 'Unable to connect to Claude API. Please check your internet connection.',
        };
      }

      return {
        message: 'Claude process error',
        details: error.message,
      };
    }

    return {
      message: 'Unknown error',
      details: String(error),
    };
  }

  /**
   * Handle API errors
   */
  static handleApiError(error: any, statusCode?: number): {
    message: string;
    details: string;
  } {
    console.error('[ErrorHandler] API error:', error, 'Status:', statusCode);

    if (statusCode === 401) {
      return {
        message: 'Authentication failed',
        details: 'Please check your API key.',
      };
    }

    if (statusCode === 429) {
      return {
        message: 'Rate limit exceeded',
        details: 'Please try again later.',
      };
    }

    if (statusCode === 500) {
      return {
        message: 'Server error',
        details: 'Claude API is experiencing issues. Please try again later.',
      };
    }

    if (error instanceof Error) {
      return {
        message: 'API request failed',
        details: error.message,
      };
    }

    return {
      message: 'API error',
      details: String(error),
    };
  }

  /**
   * Handle permission errors
   */
  static handlePermissionError(error: any): {
    message: string;
    details: string;
  } {
    console.error('[ErrorHandler] Permission error:', error);

    return {
      message: 'Permission error',
      details: error instanceof Error ? error.message : String(error),
    };
  }

  /**
   * Handle file system errors
   */
  static handleFileSystemError(error: any, operation: string): {
    message: string;
    details: string;
  } {
    console.error('[ErrorHandler] File system error:', error, 'Operation:', operation);

    if (error instanceof Error) {
      if (error.message.includes('ENOENT')) {
        return {
          message: `File or directory not found`,
          details: `Failed to ${operation}.`,
        };
      }

      if (error.message.includes('EACCES')) {
        return {
          message: `Permission denied`,
          details: `Unable to ${operation}.`,
        };
      }

      if (error.message.includes('EEXIST')) {
        return {
          message: `File or directory already exists`,
          details: `Failed to ${operation}.`,
        };
      }

      return {
        message: `File system error`,
        details: error.message,
      };
    }

    return {
      message: `File system error`,
      details: String(error),
    };
  }

  /**
   * Format error for display
   */
  static formatError(error: { message: string; details: string }): string {
    return `${error.message}\n\n${error.details}`;
  }

  /**
   * Check if error is recoverable
   */
  static isRecoverable(error: any): boolean {
    if (error instanceof Error) {
      // Network errors are often recoverable
      if (
        error.message.includes('ECONNREFUSED') ||
        error.message.includes('ETIMEDOUT') ||
        error.message.includes('ENETUNREACH')
      ) {
        return true;
      }

      // Rate limit errors are recoverable
      if (error.message.includes('429')) {
        return true;
      }

      // Server errors might be recoverable
      if (error.message.includes('500') || error.message.includes('503')) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get retry delay for recoverable errors
   */
  static getRetryDelay(error: any, attempt: number): number {
    if (error instanceof Error && error.message.includes('429')) {
      // Exponential backoff for rate limits
      return Math.min(1000 * Math.pow(2, attempt), 30000);
    }

    // Standard retry delay
    return Math.min(1000 * attempt, 5000);
  }
}
