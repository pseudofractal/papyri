/** Timeouts shared by the control bridge and preview scrolling. */
export const PREVIEW_READY_TIMEOUT_MS = 10_000;
export const PREVIEW_POLL_MS = 25;
export const HEADINGS_READY_TIMEOUT_MS = 10_000;
export const HEADINGS_POLL_MS = 50;
export const PREVIEW_RETRY_TIMEOUT_MS = 10_000;
export const PREVIEW_RETRY_DELAY_MS = 100;
export const PREVIEW_FRAME_WAIT_MS = 2_000;
export const PREVIEW_ACK_TIMEOUT_MS = 2_000;
/** Maximum time a control reveal waits for a preview acknowledgement. */
export const CONTROL_REVEAL_WAIT_MS = 250;
export const CONTROL_PUBLISH_INTERVAL_MS = 100;
/** Minimum interval between Markdown viewport events. */
export const VIEWPORT_PUBLISH_MS = 50;
/** An attached editor must heartbeat before its preview overlay is dropped. */
export const ATTACHMENT_LEASE_MS = 15_000;
export const ATTACHMENT_SWEEP_MS = 2_000;
