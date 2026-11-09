import { dirname, isTypst, normalize } from './paths';

export interface PreviewLocation {
  path: string;
  line: number;
  character: number;
}

/** Accept source locations only within the preview's project directory. */
export function previewLocation(value: unknown, mainFile: string): PreviewLocation | null {
  if (!value || typeof value !== 'object') return null;
  const jump = value as { filepath?: unknown; start?: unknown };
  if (
    typeof jump.filepath !== 'string' ||
    !jump.filepath.startsWith('/') ||
    jump.filepath.includes('\0')
  )
    return null;
  if (!Array.isArray(jump.start) || jump.start.length !== 2) return null;
  const [line, character] = jump.start;
  if (!Number.isSafeInteger(line) || line < 0 || !Number.isSafeInteger(character) || character < 0)
    return null;
  const path = normalize(jump.filepath);
  const root = dirname(mainFile);
  if (!isTypst(path) || (root !== '/' && path !== root && !path.startsWith(`${root}/`)))
    return null;
  return { path, line, character };
}

/** Validate the loopback-only port returned by Tinymist. */
export function previewPort(value: unknown): number {
  const port = (value as { staticServerPort?: unknown } | null)?.staticServerPort;
  if (!Number.isInteger(port) || (port as number) < 1 || (port as number) > 65535)
    throw new Error('Tinymist did not return a valid preview port.');
  return port as number;
}
