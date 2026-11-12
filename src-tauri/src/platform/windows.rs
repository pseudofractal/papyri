//! Windows-specific platform helpers.
//!
//! The control transport uses a loopback token endpoint and atomic file
//! replacement uses `MoveFileExW`. Compiler processes run directly because
//! Windows has no bubblewrap equivalent in the standard distribution.
