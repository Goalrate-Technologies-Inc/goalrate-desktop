import { describe, it, expect } from 'vitest';
import {
  createStorageError,
  wrapSuccess,
  wrapError,
  isSuccess,
  isError,
  isStorageError,
  toStorageError,
  tryCatch,
  getErrorMessage,
  unwrap,
  unwrapOr,
  mapResult,
} from '../src/errors';
import type { StorageError } from '../src/interface';

describe('Error Utilities', () => {
  describe('createStorageError', () => {
    it('creates error with required fields', () => {
      const error = createStorageError('ITEM_NOT_FOUND', 'Item not found');
      expect(error.code).toBe('ITEM_NOT_FOUND');
      expect(error.message).toBe('Item not found');
    });

    it('includes cause when provided', () => {
      const cause = new Error('Original error');
      const error = createStorageError('UNKNOWN_ERROR', 'Wrapped error', cause);
      expect(error.cause).toBe(cause);
    });

    it('includes details when provided', () => {
      const error = createStorageError('VALIDATION_ERROR', 'Invalid input', undefined, {
        field: 'name',
        reason: 'required',
      });
      expect(error.details).toEqual({ field: 'name', reason: 'required' });
    });
  });

  describe('wrapSuccess / wrapError', () => {
    it('wraps successful data', () => {
      const result = wrapSuccess({ id: '123' });
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ id: '123' });
    });

    it('wraps error', () => {
      const error = createStorageError('ITEM_NOT_FOUND', 'Not found');
      const result = wrapError<string>(error);
      expect(result.success).toBe(false);
      expect(result.error).toBe(error);
    });
  });

  describe('isSuccess / isError', () => {
    it('correctly identifies success', () => {
      const success = wrapSuccess('test');
      const failure = wrapError(createStorageError('UNKNOWN_ERROR', 'test'));

      expect(isSuccess(success)).toBe(true);
      expect(isSuccess(failure)).toBe(false);
    });

    it('correctly identifies error', () => {
      const success = wrapSuccess('test');
      const failure = wrapError(createStorageError('UNKNOWN_ERROR', 'test'));

      expect(isError(failure)).toBe(true);
      expect(isError(success)).toBe(false);
    });
  });

  describe('isStorageError', () => {
    it('identifies StorageError', () => {
      const error = createStorageError('ITEM_NOT_FOUND', 'Not found');
      expect(isStorageError(error)).toBe(true);
    });

    it('rejects non-StorageError', () => {
      expect(isStorageError(null)).toBe(false);
      expect(isStorageError({})).toBe(false);
      expect(isStorageError({ code: 'TEST' })).toBe(false);
      expect(isStorageError(new Error('test'))).toBe(false);
    });
  });

  describe('toStorageError', () => {
    it('passes through StorageError unchanged', () => {
      const original = createStorageError('ITEM_NOT_FOUND', 'Not found');
      const result = toStorageError(original);
      expect(result).toBe(original);
    });

    it('converts Error to StorageError', () => {
      const error = new Error('Something went wrong');
      const result = toStorageError(error);
      expect(result.code).toBe('UNKNOWN_ERROR');
      expect(result.message).toBe('Something went wrong');
      expect(result.cause).toBe(error);
    });

    it('converts string to StorageError', () => {
      const result = toStorageError('Error message');
      expect(result.code).toBe('UNKNOWN_ERROR');
      expect(result.message).toBe('Error message');
    });

    it('uses fallback for unknown types', () => {
      const result = toStorageError({ random: 'object' }, 'Fallback message');
      expect(result.code).toBe('UNKNOWN_ERROR');
      expect(result.message).toBe('Fallback message');
    });

    it('detects network errors', () => {
      const error = new TypeError('fetch failed');
      const result = toStorageError(error);
      expect(result.code).toBe('NETWORK_ERROR');
    });

    it('detects not found errors', () => {
      const error = new Error('Item not found');
      const result = toStorageError(error);
      expect(result.code).toBe('ITEM_NOT_FOUND');
    });
  });

  describe('tryCatch', () => {
    it('wraps successful async operation', async () => {
      const result = await tryCatch(async () => 'success');
      expect(isSuccess(result)).toBe(true);
      expect(result.data).toBe('success');
    });

    it('catches and wraps errors', async () => {
      const result = await tryCatch(async () => {
        throw new Error('Operation failed');
      });
      expect(isError(result)).toBe(true);
      expect(result.error?.message).toBe('Operation failed');
    });
  });

  describe('getErrorMessage', () => {
    it('returns user-friendly messages for error codes', () => {
      expect(getErrorMessage('VAULT_NOT_FOUND')).toContain('vault');
      expect(getErrorMessage('NETWORK_ERROR')).toContain('network');
      expect(getErrorMessage('PERMISSION_DENIED')).toContain('permission');
    });
  });

  describe('unwrap / unwrapOr', () => {
    it('unwraps successful result', () => {
      const result = wrapSuccess('value');
      expect(unwrap(result)).toBe('value');
    });

    it('throws on unwrap of error', () => {
      const result = wrapError(createStorageError('UNKNOWN_ERROR', 'Test error'));
      expect(() => unwrap(result)).toThrow('Test error');
    });

    it('returns default on error with unwrapOr', () => {
      const result = wrapError<string>(createStorageError('UNKNOWN_ERROR', 'Test error'));
      expect(unwrapOr(result, 'default')).toBe('default');
    });

    it('returns value on success with unwrapOr', () => {
      const result = wrapSuccess('value');
      expect(unwrapOr(result, 'default')).toBe('value');
    });
  });

  describe('mapResult', () => {
    it('maps successful result', () => {
      const result = wrapSuccess(5);
      const mapped = mapResult(result, (n) => n * 2);
      expect(isSuccess(mapped)).toBe(true);
      expect(mapped.data).toBe(10);
    });

    it('passes through error unchanged', () => {
      const error = createStorageError('UNKNOWN_ERROR', 'Test');
      const result = wrapError<number>(error);
      const mapped = mapResult(result, (n) => n * 2);
      expect(isError(mapped)).toBe(true);
      expect(mapped.error).toBe(error);
    });
  });
});
