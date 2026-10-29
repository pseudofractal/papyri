declare module 'markdown-it-task-lists';
declare module 'markdown-it-texmath';
declare module 'pdfjs-dist/legacy/build/pdf.mjs' {
  export * from 'pdfjs-dist';
}
declare module 'pdfjs-dist/legacy/web/pdf_viewer.mjs' {
  export { PDFViewer } from 'pdfjs-dist/types/web/pdf_viewer';
  export { PDFLinkService } from 'pdfjs-dist/types/web/pdf_link_service';
  export { PDFFindController } from 'pdfjs-dist/types/web/pdf_find_controller';
  export { EventBus } from 'pdfjs-dist/types/web/event_utils';
}
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs' {
  const source: string;
  export default source;
}
declare module 'papyri:pdf-resources' {
  const resources: Record<string, string>;
  export default resources;
}
