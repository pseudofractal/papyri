import { invokeHost } from './native';

const enabled =
  (window as unknown as { __PAPYRI_STARTUP_TRACE__?: boolean }).__PAPYRI_STARTUP_TRACE__ === true;
const recorded = new Set<string>();
type StartupStage =
  | 'shell'
  | 'folder'
  | 'source-ready'
  | 'file-ready'
  | 'preview-start'
  | 'parser-ready'
  | 'renderer-ready'
  | 'assets-ready'
  | 'frame-built'
  | 'document'
  | 'pdf-page';

export function traceStartup(stage: StartupStage) {
  if (!enabled || recorded.has(stage)) return;
  recorded.add(stage);
  void invokeHost('startup_trace', { stage, navigationMs: performance.now() }).catch((error) =>
    console.error('Startup trace failed:', error),
  );
}

export function traceStartupPaint(stage: StartupStage) {
  if (!enabled || recorded.has(stage)) return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => traceStartup(stage));
  });
}
