export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function notFound(message = 'The requested record was not found.') {
  return new AppError(404, 'NOT_FOUND', message);
}

export function conflict(code: string, message: string) {
  return new AppError(409, code, message);
}

export function validationError(message: string, details?: unknown) {
  return new AppError(400, 'INVALID_REQUEST', message, details);
}
