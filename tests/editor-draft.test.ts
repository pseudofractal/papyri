import { describe, expect, it } from 'vitest';
import { EditorDraft } from '../src/lib/editor-draft';

describe('editor drafts', () => {
  it('tracks edits and returns to clean when text is restored', () => {
    const draft = new EditorDraft('/paper.typ', 'original', 'first');
    expect(draft.dirty).toBe(false);
    draft.text = 'changed';
    expect(draft.dirty).toBe(true);
    draft.text = 'original';
    expect(draft.dirty).toBe(false);
  });

  it('keeps edits made while a save was in progress', () => {
    const draft = new EditorDraft('/paper.tex', 'original', 'first');
    draft.text = 'saving';
    const snapshot = draft.text;
    draft.text = 'newer edit';
    draft.saved(snapshot, 'second');
    expect(draft.dirty).toBe(true);
    expect(draft.expectedStamp).toBe('second');
    draft.text = snapshot;
    expect(draft.dirty).toBe(false);
  });
});
