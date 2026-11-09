import { renderMarkdown } from './markdown';
import { renderSource } from './source';
import type { BuildRenderOptions } from './source';
self.onmessage = (
  event: MessageEvent<{
    text: string;
    delimiters: import('../lib/types').Delimiter[];
    language?: 'typst' | 'latex';
    build?: BuildRenderOptions;
  }>,
) => {
  try {
    const { text, delimiters, language, build } = event.data;
    self.postMessage({
      result: language ? renderSource(text, language, build) : renderMarkdown(text, delimiters),
    });
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
