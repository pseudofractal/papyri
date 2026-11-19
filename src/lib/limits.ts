export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
export const MAX_PDF_BYTES = 64 * 1024 * 1024;
export const MAX_DIAGRAM_CHARACTERS = 50_000;
/** Maximum source paths an external editor may claim in one attachment. */
export const MAX_ATTACHMENT_PATHS = 64;
/** Maximum documents accepted by one attach or update request. */
export const MAX_ATTACHMENT_DOCUMENTS = 64;
/** Combined encoded document budget. Keep in sync with `MAX_REQUEST_BYTES` in
 * `src-tauri/src/control.rs` and `max_request_bytes` in `editors/nvim/lua/papyri/config.lua`. */
export const MAX_ATTACHMENT_REQUEST_BYTES = 31 * 1024 * 1024;
