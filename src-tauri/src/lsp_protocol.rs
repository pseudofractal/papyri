//! Bounded Language Server Protocol messages over a server's standard streams.
use std::io::{self, BufRead, ErrorKind, Read, Write};

const MAX_HEADER_BYTES: usize = 8192;
const MAX_MESSAGE_BYTES: usize = 16 * 1024 * 1024;

pub fn read_message(reader: &mut impl BufRead) -> io::Result<Option<String>> {
  let mut header_bytes = 0;
  let mut content_length = None;
  loop {
    let mut line = String::new();
    let remaining = MAX_HEADER_BYTES - header_bytes + 1;
    let bytes = Read::take(&mut *reader, remaining as u64).read_line(&mut line)?;
    if bytes == 0 {
      return if header_bytes == 0 {
        Ok(None)
      } else {
        Err(io::Error::new(
          ErrorKind::UnexpectedEof,
          "Incomplete LSP header",
        ))
      };
    }
    header_bytes += bytes;
    if header_bytes > MAX_HEADER_BYTES {
      return Err(io::Error::new(
        ErrorKind::InvalidData,
        "LSP header is too large",
      ));
    }
    if line == "\r\n" {
      break;
    }
    let (name, value) = line
      .trim_end_matches(['\r', '\n'])
      .split_once(':')
      .ok_or_else(|| io::Error::new(ErrorKind::InvalidData, "Malformed LSP header"))?;
    if name.eq_ignore_ascii_case("content-length") {
      if content_length.is_some() {
        return Err(io::Error::new(
          ErrorKind::InvalidData,
          "Duplicate LSP content length",
        ));
      }
      let length = value
        .trim()
        .parse::<usize>()
        .map_err(|_| io::Error::new(ErrorKind::InvalidData, "Invalid LSP content length"))?;
      if length > MAX_MESSAGE_BYTES {
        return Err(io::Error::new(
          ErrorKind::InvalidData,
          "LSP message is too large",
        ));
      }
      content_length = Some(length);
    }
  }
  let length = content_length
    .ok_or_else(|| io::Error::new(ErrorKind::InvalidData, "Missing LSP content length"))?;
  let mut body = vec![0; length];
  reader.read_exact(&mut body)?;
  String::from_utf8(body)
    .map(Some)
    .map_err(|error| io::Error::new(ErrorKind::InvalidData, error))
}

pub fn write_message(writer: &mut impl Write, message: &str) -> io::Result<()> {
  if message.len() > MAX_MESSAGE_BYTES {
    return Err(io::Error::new(
      ErrorKind::InvalidInput,
      "LSP message is too large",
    ));
  }
  write!(writer, "Content-Length: {}\r\n\r\n", message.len())?;
  writer.write_all(message.as_bytes())?;
  writer.flush()
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::io::Cursor;

  #[test]
  fn round_trips_multiple_unicode_messages() {
    let mut bytes = Vec::new();
    write_message(&mut bytes, r#"{"text":"数学"}"#).unwrap();
    write_message(&mut bytes, "{}").unwrap();
    let mut reader = Cursor::new(bytes);
    assert_eq!(
      read_message(&mut reader).unwrap().unwrap(),
      r#"{"text":"数学"}"#
    );
    assert_eq!(read_message(&mut reader).unwrap().unwrap(), "{}");
    assert!(read_message(&mut reader).unwrap().is_none());
  }

  #[test]
  fn rejects_invalid_and_truncated_messages() {
    for bytes in [
      b"Content-Length: 3\r\n\r\n{}".as_slice(),
      b"Content-Length: nope\r\n\r\n".as_slice(),
      b"Content-Length: 1\r\nContent-Length: 1\r\n\r\n{}".as_slice(),
      b"Content-Length: 16777217\r\n\r\n".as_slice(),
      b"Content-Type: application/json\r\n\r\n".as_slice(),
    ] {
      assert!(read_message(&mut Cursor::new(bytes)).is_err());
    }
  }
}
