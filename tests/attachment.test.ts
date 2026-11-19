import { describe, expect, it } from 'vitest';
import {
  ControlActionError,
  assertNoDirtyDrafts,
  assertRevisionForward,
  attachmentControlState,
  attachmentCovers,
  attachmentOwnershipError,
  isAttachmentExpired,
  mergeTypstDocuments,
  resolveAttachPlan,
  resolveMarkdownUpdate,
  resolveTypstUpdate,
  typstPathAllowed,
  validateAttachmentDocuments,
  validateAttachmentTarget,
  type AttachmentRequest,
  type PreviewAttachment,
} from '../src/lib/control';
import { MAX_ATTACHMENT_PATHS } from '../src/lib/limits';

function attachment(overrides: Partial<PreviewAttachment> = {}): PreviewAttachment {
  return {
    owner: 'nvim-1',
    kind: 'typst',
    root: '/papers/main.typ',
    paths: ['/papers/main.typ', '/papers/chapter.typ'],
    revision: 3,
    lastSeen: 1_000,
    ...overrides,
  };
}

function request(overrides: Partial<AttachmentRequest> = {}): AttachmentRequest {
  return {
    path: '/papers/main.typ',
    kind: 'typst',
    paths: ['/papers/main.typ'],
    documents: [],
    ...overrides,
  };
}

describe('attachment decisions', () => {
  it('keeps Typst paths under the main document directory', () => {
    expect(typstPathAllowed('/papers/main.typ', '/papers/main.typ')).toBe(true);
    expect(typstPathAllowed('/papers/main.typ', '/papers/chapter.typ')).toBe(true);
    expect(typstPathAllowed('/papers/main.typ', '/papers/sub/part.typ')).toBe(true);
    expect(typstPathAllowed('/papers/main.typ', '/other/part.typ')).toBe(false);
    expect(typstPathAllowed('/papers/main.typ', '/papers/notes.md')).toBe(false);
    expect(typstPathAllowed('/main.typ', '/chapter.typ')).toBe(false);
  });

  it('covers attached files and their parent directories only', () => {
    const current = attachment();
    expect(attachmentCovers(current, '/papers/chapter.typ')).toBe(true);
    expect(attachmentCovers(current, '/papers')).toBe(true);
    expect(attachmentCovers(current, '/papers-other')).toBe(false);
    expect(attachmentCovers(null, '/papers/main.typ')).toBe(false);
  });

  it('reports the loss reason for an inactive attachment', () => {
    expect(attachmentControlState(attachment(), null)).toMatchObject({
      active: true,
      owner: 'nvim-1',
      revision: 3,
      reason: null,
    });
    expect(attachmentControlState(null, 'expired')).toMatchObject({
      active: false,
      paths: [],
      reason: 'expired',
    });
  });

  it('distinguishes replaced and expired ownership errors', () => {
    expect(attachmentOwnershipError(attachment()).code).toBe('attachment-replaced');
    expect(attachmentOwnershipError(null).code).toBe('attachment-expired');
  });

  it('refuses dirty drafts before mutating an attachment', () => {
    expect(() => assertNoDirtyDrafts(['/papers/chapter.typ'], () => null)).not.toThrow();
    try {
      assertNoDirtyDrafts(['/papers/chapter.typ'], () => '/papers/chapter.typ');
      throw new Error('expected a dirty-draft error');
    } catch (error) {
      expect(error).toBeInstanceOf(ControlActionError);
      expect((error as ControlActionError).code).toBe('attachment-dirty');
      expect((error as Error).message).toContain('/papers/chapter.typ');
    }
  });

  it('refuses takeover without the flag and reuses a same-owner Typst pane', () => {
    expect(resolveAttachPlan(attachment(), request(), 'nvim-1', false)).toEqual({
      previousPaths: ['/papers/main.typ', '/papers/chapter.typ'],
      reuseTypstPane: true,
      replacingOwner: false,
    });
    expect(() => resolveAttachPlan(attachment(), request(), 'other', false)).toThrow(
      'Take it over to replace it',
    );
    expect(() => resolveAttachPlan(attachment(), request(), 'other', false)).toThrow(
      ControlActionError,
    );
    expect(resolveAttachPlan(attachment(), request(), 'other', true).replacingOwner).toBe(true);
  });

  it('does not reuse a Typst pane for a different root or Markdown', () => {
    expect(
      resolveAttachPlan(attachment(), request({ path: '/papers/other.typ' }), 'nvim-1', false)
        .reuseTypstPane,
    ).toBe(false);
    expect(
      resolveAttachPlan(
        attachment(),
        request({ path: '/notes.md', kind: 'markdown', paths: ['/notes.md'] }),
        'nvim-1',
        false,
      ).reuseTypstPane,
    ).toBe(false);
  });

  it('validates attach targets before opening anything', () => {
    expect(() =>
      validateAttachmentTarget('/notes.md', 'markdown', ['/notes.md'], true),
    ).not.toThrow();
    expect(() => validateAttachmentTarget('/notes.md', 'markdown', [], true)).toThrow(
      'only own its document',
    );
    expect(() => validateAttachmentTarget('/notes.md', 'markdown', ['/notes.md'], false)).toThrow(
      'No document source',
    );
    expect(() =>
      validateAttachmentTarget('/papers/main.typ', 'typst', ['/papers/main.typ'], true),
    ).not.toThrow();
    expect(() =>
      validateAttachmentTarget('/papers/main.typ', 'typst', ['/other/main.typ'], true),
    ).toThrow('must include its main document');
    expect(() =>
      validateAttachmentTarget(
        '/papers/main.typ',
        'typst',
        ['/papers/main.typ', '/other/a.typ'],
        true,
      ),
    ).toThrow('stay under');
    expect(() => validateAttachmentTarget('/main.typ', 'typst', ['/main.typ'], true)).toThrow(
      'filesystem root',
    );
  });

  it('normalizes documents and rejects paths outside the attachment', () => {
    expect(
      validateAttachmentDocuments(
        ['/papers/main.typ'],
        [{ path: '/papers/./main.typ', text: '= Main' }],
      ),
    ).toEqual([{ path: '/papers/main.typ', text: '= Main' }]);
    expect(() =>
      validateAttachmentDocuments(['/papers/main.typ'], [{ path: '/other/chapter.typ', text: '' }]),
    ).toThrow('Not attached');
  });

  it('requires strictly increasing revisions', () => {
    expect(() => assertRevisionForward(attachment(), 4)).not.toThrow();
    expect(() => assertRevisionForward(attachment(), 3)).toThrow('must move forward');
    expect(() => assertRevisionForward(attachment(), 2)).toThrow(ControlActionError);
  });

  it('plans Markdown replacement and rejects unknown paths', () => {
    const markdown = attachment({
      kind: 'markdown',
      root: '/notes.md',
      paths: ['/notes.md'],
    });
    expect([...resolveMarkdownUpdate(markdown, [{ path: '/notes.md', text: '# Hi' }])]).toEqual([
      ['/notes.md', '# Hi'],
    ]);
    expect([...resolveMarkdownUpdate(markdown, [])]).toEqual([]);
    expect(() => resolveMarkdownUpdate(markdown, [{ path: '/other.md', text: '' }])).toThrow(
      'Not attached',
    );
  });

  it('plans Typst additions, rejects limits and outside files, and merges overlays', () => {
    const current = attachment();
    const { next, additions } = resolveTypstUpdate(
      current,
      [
        { path: '/papers/chapter.typ', text: '= Updated' },
        { path: '/papers/new.typ', text: '= New' },
      ],
      () => null,
    );
    expect(additions).toEqual(['/papers/new.typ']);
    expect(next.get('/papers/new.typ')).toBe('= New');
    expect(mergeTypstDocuments([{ path: '/papers/main.typ', text: '= Main' }], next)).toEqual([
      { path: '/papers/main.typ', text: '= Main' },
      { path: '/papers/chapter.typ', text: '= Updated' },
      { path: '/papers/new.typ', text: '= New' },
    ]);
    expect(() =>
      resolveTypstUpdate(current, [{ path: '/other/new.typ', text: '' }], () => null),
    ).toThrow('Not attached');
    expect(() =>
      resolveTypstUpdate(current, [{ path: '/papers/new.typ', text: '' }], () => '/papers/new.typ'),
    ).toThrow('unsaved source changes');
    const full = attachment({
      paths: Array.from({ length: MAX_ATTACHMENT_PATHS }, (_, index) => `/papers/${index}.typ`),
    });
    expect(() =>
      resolveTypstUpdate(full, [{ path: '/papers/extra.typ', text: '' }], () => null),
    ).toThrow(`at most ${MAX_ATTACHMENT_PATHS}`);
  });

  it('expires only after the lease interval', () => {
    expect(isAttachmentExpired(attachment(), 1_000 + 15_000, 15_000)).toBe(false);
    expect(isAttachmentExpired(attachment(), 1_000 + 15_001, 15_000)).toBe(true);
  });
});
