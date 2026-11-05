//! Tiny JSON reader (config in) and writer helpers (events out).
//! Avoids pulling serde into the wasm binary; configs are small and parsed rarely.

use std::fmt::Write;

#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
    Arr(Vec<Value>),
    Obj(Vec<(String, Value)>),
}

impl Value {
    pub fn get(&self, key: &str) -> Option<&Value> {
        match self {
            Value::Obj(items) => items.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }
    pub fn as_f64(&self) -> Option<f64> {
        match self {
            Value::Num(n) => Some(*n),
            _ => None,
        }
    }
    pub fn as_bool(&self) -> Option<bool> {
        match self {
            Value::Bool(b) => Some(*b),
            _ => None,
        }
    }
    pub fn as_str(&self) -> Option<&str> {
        match self {
            Value::Str(s) => Some(s),
            _ => None,
        }
    }
    pub fn as_arr(&self) -> Option<&[Value]> {
        match self {
            Value::Arr(a) => Some(a),
            _ => None,
        }
    }
    /// Number at `key`, or `default` when missing / not a number.
    pub fn num_or(&self, key: &str, default: f64) -> f64 {
        self.get(key).and_then(Value::as_f64).unwrap_or(default)
    }
}

/// Longest input `parse` accepts (bytes).
pub const MAX_INPUT: usize = 256 * 1024;
/// Deepest nesting of objects/arrays `parse` accepts.
pub const MAX_DEPTH: u32 = 32;

/// Parse JSON. Errors (never panics) on bad input, input longer than
/// `MAX_INPUT` or nesting deeper than `MAX_DEPTH`.
pub fn parse(src: &str) -> Result<Value, String> {
    if src.len() > MAX_INPUT {
        return Err(format!("JSON too long ({} bytes, max {MAX_INPUT})", src.len()));
    }
    let mut p = Parser { s: src.as_bytes(), i: 0, depth: 0 };
    p.ws();
    let v = p.value()?;
    p.ws();
    if p.i != p.s.len() {
        return Err(format!("trailing characters at {}", p.i));
    }
    Ok(v)
}

struct Parser<'a> {
    s: &'a [u8],
    i: usize,
    depth: u32,
}

impl<'a> Parser<'a> {
    fn ws(&mut self) {
        while self.i < self.s.len() && matches!(self.s[self.i], b' ' | b'\n' | b'\r' | b'\t') {
            self.i += 1;
        }
    }
    fn peek(&self) -> Option<u8> {
        self.s.get(self.i).copied()
    }
    fn expect(&mut self, c: u8) -> Result<(), String> {
        if self.peek() == Some(c) {
            self.i += 1;
            Ok(())
        } else {
            Err(format!("expected '{}' at {}", c as char, self.i))
        }
    }
    fn lit(&mut self, word: &str, v: Value) -> Result<Value, String> {
        if self.s[self.i..].starts_with(word.as_bytes()) {
            self.i += word.len();
            Ok(v)
        } else {
            Err(format!("bad literal at {}", self.i))
        }
    }
    fn nested(&mut self, f: fn(&mut Self) -> Result<Value, String>) -> Result<Value, String> {
        if self.depth >= MAX_DEPTH {
            return Err(format!("JSON nested deeper than {MAX_DEPTH} at {}", self.i));
        }
        self.depth += 1;
        let r = f(self);
        self.depth -= 1;
        r
    }
    fn value(&mut self) -> Result<Value, String> {
        match self.peek() {
            Some(b'{') => self.nested(Self::object),
            Some(b'[') => self.nested(Self::array),
            Some(b'"') => Ok(Value::Str(self.string()?)),
            Some(b't') => self.lit("true", Value::Bool(true)),
            Some(b'f') => self.lit("false", Value::Bool(false)),
            Some(b'n') => self.lit("null", Value::Null),
            Some(c) if c == b'-' || c.is_ascii_digit() => self.number(),
            _ => Err(format!("unexpected input at {}", self.i)),
        }
    }
    fn object(&mut self) -> Result<Value, String> {
        self.expect(b'{')?;
        let mut items = Vec::new();
        self.ws();
        if self.peek() == Some(b'}') {
            self.i += 1;
            return Ok(Value::Obj(items));
        }
        loop {
            self.ws();
            let k = self.string()?;
            self.ws();
            self.expect(b':')?;
            self.ws();
            let v = self.value()?;
            items.push((k, v));
            self.ws();
            match self.peek() {
                Some(b',') => self.i += 1,
                Some(b'}') => {
                    self.i += 1;
                    return Ok(Value::Obj(items));
                }
                _ => return Err(format!("expected ',' or '}}' at {}", self.i)),
            }
        }
    }
    fn array(&mut self) -> Result<Value, String> {
        self.expect(b'[')?;
        let mut items = Vec::new();
        self.ws();
        if self.peek() == Some(b']') {
            self.i += 1;
            return Ok(Value::Arr(items));
        }
        loop {
            self.ws();
            items.push(self.value()?);
            self.ws();
            match self.peek() {
                Some(b',') => self.i += 1,
                Some(b']') => {
                    self.i += 1;
                    return Ok(Value::Arr(items));
                }
                _ => return Err(format!("expected ',' or ']' at {}", self.i)),
            }
        }
    }
    fn string(&mut self) -> Result<String, String> {
        self.expect(b'"')?;
        let mut out = String::new();
        loop {
            let c = self.peek().ok_or("unterminated string")?;
            self.i += 1;
            match c {
                b'"' => return Ok(out),
                b'\\' => {
                    let e = self.peek().ok_or("bad escape")?;
                    self.i += 1;
                    match e {
                        b'"' => out.push('"'),
                        b'\\' => out.push('\\'),
                        b'/' => out.push('/'),
                        b'n' => out.push('\n'),
                        b't' => out.push('\t'),
                        b'r' => out.push('\r'),
                        b'b' => out.push('\u{8}'),
                        b'f' => out.push('\u{c}'),
                        b'u' => {
                            let hex = self.s.get(self.i..self.i + 4).ok_or("bad \\u")?;
                            let hex = std::str::from_utf8(hex).map_err(|_| "bad \\u")?;
                            let code = u32::from_str_radix(hex, 16).map_err(|_| "bad \\u")?;
                            self.i += 4;
                            out.push(char::from_u32(code).unwrap_or('\u{fffd}'));
                        }
                        _ => return Err("bad escape".into()),
                    }
                }
                _ => {
                    // Copy a full UTF-8 sequence.
                    let start = self.i - 1;
                    let len = match c {
                        0x00..=0x7f => 1,
                        0xc0..=0xdf => 2,
                        0xe0..=0xef => 3,
                        _ => 4,
                    };
                    let end = (start + len).min(self.s.len());
                    out.push_str(std::str::from_utf8(&self.s[start..end]).map_err(|_| "bad utf8")?);
                    self.i = end;
                }
            }
        }
    }
    fn number(&mut self) -> Result<Value, String> {
        let start = self.i;
        while let Some(c) = self.peek() {
            if c.is_ascii_digit() || matches!(c, b'-' | b'+' | b'.' | b'e' | b'E') {
                self.i += 1;
            } else {
                break;
            }
        }
        let txt = std::str::from_utf8(&self.s[start..self.i]).unwrap();
        txt.parse::<f64>().map(Value::Num).map_err(|_| format!("bad number at {}", start))
    }
}

/// Append a JSON string literal.
pub fn write_str(out: &mut String, s: &str) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            c if (c as u32) < 0x20 => {
                let _ = write!(out, "\\u{:04x}", c as u32);
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_nested() {
        let v = parse(r#"{"a": [1, 2.5, -3e2], "b": {"c": true, "d": null}, "s": "x\"y×"}"#).unwrap();
        assert_eq!(v.get("a").unwrap().as_arr().unwrap().len(), 3);
        assert_eq!(v.get("a").unwrap().as_arr().unwrap()[2].as_f64(), Some(-300.0));
        assert_eq!(v.get("b").unwrap().get("c").unwrap().as_bool(), Some(true));
        assert_eq!(v.get("s").unwrap().as_str(), Some("x\"y×"));
        assert_eq!(v.num_or("missing", 7.0), 7.0);
    }

    #[test]
    fn caps_depth_and_length() {
        let ok = format!("{}{}", "[".repeat(32), "]".repeat(32));
        assert!(parse(&ok).is_ok());
        let deep = format!("{}{}", "[".repeat(33), "]".repeat(33));
        assert!(parse(&deep).unwrap_err().contains("deeper"));
        // Very deep input errors instead of overflowing the stack.
        let huge = "[{\"a\":".repeat(20_000);
        assert!(parse(&huge).unwrap_err().contains("deeper"));
        let long = format!("[{}0]", "0,".repeat(MAX_INPUT / 2));
        assert!(parse(&long).unwrap_err().contains("too long"));
        // Truncated escapes and odd bytes error too.
        for bad in ["\"\\u12", "\"\\", "tru", "-", "{\"a\"", "\"\u{e9}"] {
            assert!(parse(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn rejects_garbage() {
        assert!(parse("{\"a\":}").is_err());
        assert!(parse("[1,2").is_err());
        assert!(parse("{} x").is_err());
    }
}
