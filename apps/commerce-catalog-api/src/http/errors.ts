import { AppError } from '@ocp-catalog/shared';
import { ZodError } from 'zod';
import { logRequest } from './request-context';

export function handleHttpError(input: {
  error: unknown;
  request: Request;
  requestStartedAt?: number;
  requestPathname?: string;
  set: { status?: number | string };
}) {
  const durationMs = input.requestStartedAt ? performance.now() - input.requestStartedAt : undefined;

  if (input.error instanceof AppError) {
    input.set.status = input.error.status;
    logRequest({
      request: input.request,
      pathname: input.requestPathname,
      status: input.error.status,
      durationMs,
      error: input.error,
    });
    return {
      error: {
        code: input.error.code,
        message: input.error.message,
        status: input.error.status,
        details: input.error.details,
      },
    };
  }

  if (input.error instanceof ZodError) {
    input.set.status = 400;
    logRequest({
      request: input.request,
      pathname: input.requestPathname,
      status: 400,
      durationMs,
      error: input.error,
    });
    return {
      error: {
        code: 'validation_error',
        message: 'Invalid request body',
        status: 400,
        details: input.error.issues,
      },
    };
  }

  input.set.status = 500;
  logRequest({
    request: input.request,
    pathname: input.requestPathname,
    status: 500,
    durationMs,
    error: input.error,
  });
  return {
    error: {
      code: 'internal_error',
      message: input.error instanceof Error ? input.error.message : 'Unknown error',
      status: 500,
    },
  };
}
