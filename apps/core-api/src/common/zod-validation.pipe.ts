import { HttpStatus, PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';
import { ApiError } from './api-exception.filter';

// Usage: @Body(new ZodValidationPipe(schema)) body: z.infer<typeof schema>
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Request is invalid', result.error.flatten());
    }
    return result.data;
  }
}
