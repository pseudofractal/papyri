import { afterEach, expect, it, vi } from 'vitest';

async function viewport(width: number, visualWidth = width, scale = 1) {
  const sizes = new Map<string, string>();
  const visual = Object.assign(new EventTarget(), { width: visualWidth, height: 800, scale });
  const frame = Object.assign(new EventTarget(), {
    innerWidth: width,
    innerHeight: 800,
    visualViewport: visual,
  });
  vi.stubGlobal('window', frame);
  vi.stubGlobal('document', {
    documentElement: {
      clientWidth: width * 1.5,
      style: { setProperty: (name: string, value: string) => sizes.set(name, value) },
    },
  });
  vi.resetModules();
  await import('../src/render/viewport');
  return { sizes, frame, visual };
}

afterEach(() => vi.unstubAllGlobals());

it('uses the frame viewport instead of WebKit’s scaled root dimensions', async () => {
  const { sizes, frame } = await viewport(375, 375.328125);
  expect(sizes.get('--viewport-width')).toBe('375px');
  frame.innerWidth = 500;
  frame.visualViewport.width = 500;
  frame.dispatchEvent(new Event('resize'));
  expect(sizes.get('--viewport-width')).toBe('500px');
});

it('accounts for scrollbar space and visual viewport changes', async () => {
  const { sizes, visual } = await viewport(600, 585);
  expect(sizes.get('--viewport-width')).toBe('585px');
  visual.width = 584.5;
  visual.dispatchEvent(new Event('resize'));
  expect(sizes.get('--viewport-width')).toBe('584.5px');
});

it('keeps the layout viewport during pinch zoom', async () => {
  const { sizes } = await viewport(600, 300, 2);
  expect(sizes.get('--viewport-width')).toBe('600px');
});
