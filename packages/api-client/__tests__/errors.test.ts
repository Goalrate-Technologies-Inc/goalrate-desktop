import { describe, it, expect } from 'vitest';
import {
  ApiError,
  isApiError,
  statusToErrorCode,
  createApiError,
  createNetworkError,
  createTimeoutError,
} from '../src/errors';

describe('ApiError', () => {
  it('should create an error with correct properties', () => {
    const error = new ApiError('NOT_FOUND', 'Resource not found', 404, { id: '123' }, 'req-1');

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.name).toBe('ApiError');
    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toBe('Resource not found');
    expect(error.status).toBe(404);
    expect(error.details).toEqual({ id: '123' });
    expect(error.requestId).toBe('req-1');
  });

  it('should have default status of 0', () => {
    const error = new ApiError('UNKNOWN', 'Unknown error');
    expect(error.status).toBe(0);
  });

  it('should serialize to JSON correctly', () => {
    const error = new ApiError('VALIDATION_ERROR', 'Invalid input', 422, { field: 'email' });
    const json = error.toJSON();

    expect(json).toEqual({
      name: 'ApiError',
      code: 'VALIDATION_ERROR',
      message: 'Invalid input',
      status: 422,
      details: { field: 'email' },
      requestId: undefined,
    });
  });
});

describe('isApiError', () => {
  it('should return true for ApiError instances', () => {
    const error = new ApiError('NOT_FOUND', 'Not found', 404);
    expect(isApiError(error)).toBe(true);
  });

  it('should return false for regular Error instances', () => {
    const error = new Error('Regular error');
    expect(isApiError(error)).toBe(false);
  });

  it('should return false for non-error values', () => {
    expect(isApiError(null)).toBe(false);
    expect(isApiError(undefined)).toBe(false);
    expect(isApiError('error')).toBe(false);
    expect(isApiError({ code: 'NOT_FOUND' })).toBe(false);
  });
});

describe('statusToErrorCode', () => {
  it('should map 401 to UNAUTHORIZED', () => {
    expect(statusToErrorCode(401)).toBe('UNAUTHORIZED');
  });

  it('should map 403 to FORBIDDEN', () => {
    expect(statusToErrorCode(403)).toBe('FORBIDDEN');
  });

  it('should map 404 to NOT_FOUND', () => {
    expect(statusToErrorCode(404)).toBe('NOT_FOUND');
  });

  it('should map 409 to CONFLICT', () => {
    expect(statusToErrorCode(409)).toBe('CONFLICT');
  });

  it('should map 400 to VALIDATION_ERROR', () => {
    expect(statusToErrorCode(400)).toBe('VALIDATION_ERROR');
  });

  it('should map 422 to VALIDATION_ERROR', () => {
    expect(statusToErrorCode(422)).toBe('VALIDATION_ERROR');
  });

  it('should map 429 to RATE_LIMITED', () => {
    expect(statusToErrorCode(429)).toBe('RATE_LIMITED');
  });

  it('should map 500+ to SERVER_ERROR', () => {
    expect(statusToErrorCode(500)).toBe('SERVER_ERROR');
    expect(statusToErrorCode(502)).toBe('SERVER_ERROR');
    expect(statusToErrorCode(503)).toBe('SERVER_ERROR');
  });

  it('should map unknown status codes to UNKNOWN', () => {
    expect(statusToErrorCode(418)).toBe('UNKNOWN');
    expect(statusToErrorCode(0)).toBe('UNKNOWN');
  });
});

describe('createApiError', () => {
  it('should create error from status and message', () => {
    const error = createApiError(404, 'Not found');

    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toBe('Not found');
    expect(error.status).toBe(404);
  });

  it('should extract details from object data', () => {
    const error = createApiError(422, 'Validation failed', { errors: ['field required'] });

    expect(error.details).toEqual({ errors: ['field required'] });
  });

  it('should wrap non-object data in raw property', () => {
    const error = createApiError(500, 'Server error', 'Raw error text');

    expect(error.details).toEqual({ raw: 'Raw error text' });
  });

  it('should include request ID', () => {
    const error = createApiError(500, 'Server error', null, 'req-123');

    expect(error.requestId).toBe('req-123');
  });
});

describe('createNetworkError', () => {
  it('should create a network error', () => {
    const error = createNetworkError('Failed to connect');

    expect(error.code).toBe('NETWORK_ERROR');
    expect(error.message).toBe('Failed to connect');
    expect(error.status).toBe(0);
  });

  it('should preserve cause', () => {
    const cause = new TypeError('fetch failed');
    const error = createNetworkError('Network error', cause);

    expect(error.cause).toBe(cause);
  });
});

describe('createTimeoutError', () => {
  it('should create a timeout error with duration', () => {
    const error = createTimeoutError(30000);

    expect(error.code).toBe('TIMEOUT');
    expect(error.message).toBe('Request timed out after 30000ms');
    expect(error.status).toBe(408);
  });
});
