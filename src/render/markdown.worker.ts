import { renderMarkdown } from './markdown';
self.onmessage = (
  event: MessageEvent<{ text: string; delimiters: import('../lib/types').Delimiter[] }>,
) => {
  try {
    self.postMessage({ result: renderMarkdown(event.data.text, event.data.delimiters) });
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
