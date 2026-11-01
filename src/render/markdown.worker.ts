import { renderMarkdown } from './markdown';
import { renderSource } from './source';
self.onmessage = (
  event: MessageEvent<{
    text: string;
    delimiters: import('../lib/types').Delimiter[];
    language?: 'typst' | 'latex';
  }>,
) => {
  try {
    const { text, delimiters, language } = event.data;
    self.postMessage({
      result: language ? renderSource(text, language) : renderMarkdown(text, delimiters),
    });
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
