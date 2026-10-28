import { invoke } from '@tauri-apps/api/core';
/** The per-process token is injected into the top-level host only, never a document frame. */
export function invokeHost<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  const token = (window as unknown as { __MDVIEW_HOST_TOKEN__?: string }).__MDVIEW_HOST_TOKEN__;
  if (!token) return Promise.reject(new Error('The native host session is unavailable.'));
  return invoke<T>(command, { ...args, hostToken: token });
}
