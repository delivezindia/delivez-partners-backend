import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

// Propagates X-Correlation-Id so logs, events and error bodies can be traced to one request.
export function correlationId(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header('x-correlation-id');
  const id = incoming && incoming.length <= 64 ? incoming : `req_${randomUUID()}`;
  (req as Request & { correlationId: string }).correlationId = id;
  res.setHeader('x-correlation-id', id);
  next();
}
