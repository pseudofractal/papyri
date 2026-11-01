import { describe, expect, it, vi } from 'vitest';
import {
  CONTROL_REQUEST_EXPIRED,
  controlRequestExpired,
  createMutationQueue,
} from '../src/lib/control-queue';

describe('control mutation queue', () => {
  it('skips work whose deadline passed before it reached the front', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const enqueue = createMutationQueue(() => 1_000);
    const first = enqueue(async () => {
      await gate;
      return 'first';
    });
    const expired = vi.fn(async () => 'expired');
    const second = enqueue(expired, 999);
    release();
    await expect(first).resolves.toBe('first');
    await expect(second).rejects.toThrow(CONTROL_REQUEST_EXPIRED);
    expect(expired).not.toHaveBeenCalled();
  });

  it('runs work that still has time and preserves order', async () => {
    const order: number[] = [];
    const enqueue = createMutationQueue(() => 1_000);
    const first = enqueue(async () => {
      order.push(1);
    }, 1_001);
    const second = enqueue(async () => {
      order.push(2);
    }, 1_001);
    await Promise.all([first, second]);
    expect(order).toEqual([1, 2]);
  });

  it('treats an absent deadline as unbounded', () => {
    expect(controlRequestExpired(undefined)).toBe(false);
    expect(controlRequestExpired(1_000, 999)).toBe(false);
    expect(controlRequestExpired(1_000, 1_000)).toBe(true);
  });
});
