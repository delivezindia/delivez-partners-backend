import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';

// Error contract (plan §13.1): { error: { code, message, details, correlationId } }
export class ApiError extends HttpException {
  constructor(
    status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message, status);
  }
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ApiException');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { correlationId?: string }>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'Something went wrong';
    let details: unknown;

    if (exception instanceof ApiError) {
      status = exception.getStatus();
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      code = HttpStatus[status] ?? 'HTTP_ERROR';
      message = typeof body === 'string' ? body : ((body as { message?: string }).message ?? exception.message);
    } else {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception), req.correlationId);
    }

    res.status(status).json({ error: { code, message, details, correlationId: req.correlationId } });
  }
}
