//! Bounded reading and retention for compiler diagnostics.
use std::io::{self, BufRead, BufReader, Read};

pub(crate) const MAX_LINE_BYTES: usize = 8 * 1024;
const TRUNCATION_MARKER: &[u8] = b"[truncated] ";

fn mark_truncated(line: &mut Vec<u8>) {
  line.splice(0..0, TRUNCATION_MARKER.iter().copied());
}

/// Read one line, retaining up to `limit` bytes of diagnostic text plus a
/// truncation marker when the line is longer.
///
/// The retained text is prefixed with a truncation marker when the line is
/// longer than `limit`. Returns the number of bytes consumed from `reader`.
pub(crate) fn read_line(
  reader: &mut impl BufRead,
  line: &mut Vec<u8>,
  limit: usize,
) -> io::Result<usize> {
  line.clear();
  let mut read = 0;
  let mut truncated = false;
  loop {
    let available = reader.fill_buf()?;
    if available.is_empty() {
      if truncated {
        mark_truncated(line);
      }
      return Ok(read);
    }
    let newline = available.iter().position(|byte| *byte == b'\n');
    let take = newline.map_or(available.len(), |index| index + 1);
    let chunk = &available[..take];
    if line.len() + chunk.len() <= limit {
      line.extend_from_slice(chunk);
    } else {
      truncated = true;
      retain_tail(line, chunk, limit);
    }
    reader.consume(take);
    read += take;
    if newline.is_some() {
      if truncated {
        mark_truncated(line);
      }
      return Ok(read);
    }
  }
}

/// Retain at most `limit` bytes at the end of `buffer` after appending `bytes`.
pub(crate) fn retain_tail(buffer: &mut Vec<u8>, bytes: &[u8], limit: usize) {
  if bytes.len() >= limit {
    buffer.clear();
    buffer.extend_from_slice(&bytes[bytes.len() - limit..]);
    return;
  }
  let keep = limit - bytes.len();
  if buffer.len() > keep {
    buffer.drain(..buffer.len() - keep);
  }
  buffer.extend_from_slice(bytes);
}

/// Read a compiler stream, retain the newest `limit` bytes, and report each line.
pub(crate) fn stream(
  mut pipe: impl Read,
  limit: usize,
  mut record: impl FnMut(&[u8]),
) -> Result<Vec<u8>, String> {
  let mut reader = BufReader::new(&mut pipe);
  let mut result = Vec::new();
  let mut line = Vec::new();
  loop {
    let read =
      read_line(&mut reader, &mut line, MAX_LINE_BYTES).map_err(|error| error.to_string())?;
    if read == 0 {
      return Ok(result);
    }
    record(&line);
    retain_tail(&mut result, &line, limit);
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::io::{BufReader, Cursor};

  #[test]
  fn reads_complete_lines() {
    let input = b"first\nsecond\n";
    let mut reader = BufReader::new(&input[..]);
    let mut line = Vec::new();

    assert_eq!(
      read_line(&mut reader, &mut line, MAX_LINE_BYTES).unwrap(),
      6
    );
    assert_eq!(line, b"first\n");
    assert_eq!(
      read_line(&mut reader, &mut line, MAX_LINE_BYTES).unwrap(),
      7
    );
    assert_eq!(line, b"second\n");
    assert_eq!(
      read_line(&mut reader, &mut line, MAX_LINE_BYTES).unwrap(),
      0
    );
  }

  #[test]
  fn truncates_overlong_lines_and_resumes_at_the_next_line() {
    let mut input = vec![b'x'; MAX_LINE_BYTES + 32];
    input.push(b'\n');
    input.extend_from_slice(b"next\n");
    let mut reader = BufReader::new(Cursor::new(input));
    let mut line = Vec::new();

    let read = read_line(&mut reader, &mut line, MAX_LINE_BYTES).unwrap();
    assert!(read > MAX_LINE_BYTES);
    assert!(line.starts_with(TRUNCATION_MARKER));
    assert!(line.ends_with(b"x\n"));
    assert_eq!(
      read_line(&mut reader, &mut line, MAX_LINE_BYTES).unwrap(),
      5
    );
    assert_eq!(line, b"next\n");
  }

  #[test]
  fn retains_the_newest_diagnostic_bytes() {
    let mut buffer = b"old".to_vec();
    retain_tail(&mut buffer, b"012345", 8);
    assert_eq!(buffer, b"ld012345");

    retain_tail(&mut buffer, b"0123456789", 8);
    assert_eq!(buffer, b"23456789");
  }
}
