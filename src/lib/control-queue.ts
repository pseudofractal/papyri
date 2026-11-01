/** Error returned when a queued request has already outlived its client timeout. */
export const CONTROL_REQUEST_EXPIRED = 'The control request expired before it could run.';

/** Whether an absolute epoch-millisecond deadline has passed. */
export function controlRequestExpired(deadline: number | undefined, now = Date.now()): boolean {
  return deadline !== undefined && now >= deadline;
}

/**
 * Serialize mutations while skipping work whose deadline passed before it
 * reached the front of the queue. Work already in progress is not cancelled.
 */
export function createMutationQueue(now = Date.now) {
  let tail = Promise.resolve();
  return <T>(operation: () => Promise<T>, deadline?: number): Promise<T> => {
    const task = tail.then(() => {
      if (controlRequestExpired(deadline, now())) throw new Error(CONTROL_REQUEST_EXPIRED);
      return operation();
    });
    tail = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  };
}
