/** An editable snapshot and the file version from which it was loaded. */
export class EditorDraft {
  readonly path: string;
  text: string;
  private savedText: string;
  private savedStamp: string;

  constructor(path: string, text: string, stamp: string) {
    this.path = path;
    this.text = text;
    this.savedText = text;
    this.savedStamp = stamp;
  }

  get dirty(): boolean {
    return this.text !== this.savedText;
  }

  get expectedStamp(): string {
    return this.savedStamp;
  }

  get expectedText(): string {
    return this.savedText;
  }

  /** Record the exact snapshot written, retaining edits made while saving. */
  saved(text: string, stamp: string): void {
    this.savedText = text;
    this.savedStamp = stamp;
  }
}
