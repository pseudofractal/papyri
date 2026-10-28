import { afterEach, expect, it, vi } from 'vitest';
import { openDialog } from '../src/lib/dialog';

function dialogViewport() {
  const sizes = new Map<string, string>();
  const visual = Object.assign(new EventTarget(), {
    width: 1200,
    height: 800,
    offsetLeft: 0,
    offsetTop: 0,
  });
  const host = Object.assign(new EventTarget(), {
    innerWidth: 1200,
    innerHeight: 800,
    visualViewport: visual,
  });
  const dialog = {
    style: { setProperty: (key: string, value: string) => sizes.set(key, value) },
    showModal: vi.fn(),
    close: vi.fn(),
  };
  vi.stubGlobal('window', host);
  return {
    sizes,
    visual,
    host,
    dialog,
    open: () => openDialog(dialog as unknown as HTMLDialogElement),
  };
}

afterEach(() => vi.unstubAllGlobals());

it('sizes a dialog from the actual viewport before opening it', () => {
  const { open, sizes, dialog, host } = dialogViewport();
  host.visualViewport.width = 1185;
  open();
  expect(sizes.get('--dialog-viewport-width')).toBe('1185px');
  expect(sizes.get('--dialog-viewport-height')).toBe('800px');
  expect(dialog.showModal).toHaveBeenCalledOnce();
});

it('tracks window resizing and the visible viewport when it shrinks or pans', () => {
  const { open, sizes, host, visual } = dialogViewport();
  open();
  host.innerWidth = 900;
  host.dispatchEvent(new Event('resize'));
  expect(sizes.get('--dialog-viewport-width')).toBe('900px');
  Object.assign(visual, { width: 450, height: 300, offsetLeft: 20, offsetTop: 40 });
  visual.dispatchEvent(new Event('resize'));
  expect(sizes.get('--dialog-viewport-width')).toBe('450px');
  expect(sizes.get('--dialog-viewport-height')).toBe('300px');
  expect(sizes.get('--dialog-viewport-left')).toBe('20px');
  visual.offsetTop = 60;
  visual.dispatchEvent(new Event('scroll'));
  expect(sizes.get('--dialog-viewport-top')).toBe('60px');
});

it('removes viewport listeners when a dialog closes', () => {
  const { open, sizes, host, visual, dialog } = dialogViewport();
  const action = open();
  action.destroy();
  host.innerWidth = visual.width = 500;
  visual.offsetLeft = 50;
  host.dispatchEvent(new Event('resize'));
  visual.dispatchEvent(new Event('resize'));
  visual.dispatchEvent(new Event('scroll'));
  expect(sizes.get('--dialog-viewport-width')).toBe('1200px');
  expect(sizes.get('--dialog-viewport-left')).toBe('0px');
  expect(dialog.close).toHaveBeenCalledOnce();
});
