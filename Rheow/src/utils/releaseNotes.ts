/**
 * Release notes arrive as the Markdown body of a GitHub release. Rheow renders
 * them as plain text, so strip the few markers that would otherwise show up
 * literally: heading hashes, bold/italic asterisks, inline code, and links.
 *
 * Older builds and hand-edited releases can also leave a `{"value" => "..."}`
 * wrapper, JSON escape sequences, or UTF-8 text decoded as Windows-1252 (for
 * example `â†’` instead of `→`). Normalize those first so cached notes and a
 * malformed feed both render cleanly.
 */

const CP1252_HIGH: Record<string, number> = {
  '€': 0x80,
  '‚': 0x82,
  'ƒ': 0x83,
  '„': 0x84,
  '…': 0x85,
  '†': 0x86,
  '‡': 0x87,
  'ˆ': 0x88,
  '‰': 0x89,
  'Š': 0x8a,
  '‹': 0x8b,
  'Œ': 0x8c,
  'Ž': 0x8e,
  '‘': 0x91,
  '’': 0x92,
  '“': 0x93,
  '”': 0x94,
  '•': 0x95,
  '–': 0x96,
  '—': 0x97,
  '˜': 0x98,
  '™': 0x99,
  'š': 0x9a,
  '›': 0x9b,
  'œ': 0x9c,
  'ž': 0x9e,
  'Ÿ': 0x9f,
};

const CP1252_BYTES = new Map<string, number>();
for (let code = 0x20; code <= 0x7e; code += 1) {
  CP1252_BYTES.set(String.fromCharCode(code), code);
}
for (let code = 0xa0; code <= 0xff; code += 1) {
  CP1252_BYTES.set(String.fromCharCode(code), code);
}
for (const [char, byte] of Object.entries(CP1252_HIGH)) {
  CP1252_BYTES.set(char, byte);
}
for (const code of [0x81, 0x8d, 0x8f, 0x90, 0x9d]) {
  CP1252_BYTES.set(String.fromCharCode(code), code);
}

/**
 * Repairs text whose UTF-8 bytes were decoded as Windows-1252. Only runs of
 * characters that map to Windows-1252 bytes are converted, so correct Unicode
 * elsewhere in the same string is left untouched.
 */
function fixMojibake(value: string): string {
  if (!/[^\x20-\x7e]/.test(value)) return value;

  let output = '';
  let run = '';

  const flush = () => {
    if (!run) return;
    const bytes = Uint8Array.from(Array.from(run, (char) => CP1252_BYTES.get(char) ?? 0));
    try {
      output += new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      output += run;
    }
    run = '';
  };

  for (const char of value) {
    if (CP1252_BYTES.has(char)) {
      run += char;
    } else {
      flush();
      output += char;
    }
  }
  flush();

  return output;
}

function decodeEscaped(value: string): string {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
}

/**
 * Unwraps the payloads produced by older releases: a JSON object with a
 * `value`/`notes` string, a Ruby/Rust debug map (`{"value" => "..."}`), or a
 * JSON-encoded string.
 */
function unwrapNotes(value: string): string {
  let text = value.trim();

  for (let depth = 0; depth < 3; depth += 1) {
    if (text.startsWith('"') && text.endsWith('"')) {
      try {
        const parsed = JSON.parse(text) as unknown;
        if (typeof parsed === 'string') {
          text = parsed.trim();
          continue;
        }
      } catch {
        // Not a JSON string; fall through to the object handling.
      }
    }

    if (text.startsWith('{')) {
      try {
        const parsed = JSON.parse(text) as unknown;
        if (parsed && typeof parsed === 'object') {
          const record = parsed as Record<string, unknown>;
          const candidate = record.value ?? record.notes;
          if (typeof candidate === 'string') {
            text = candidate.trim();
            continue;
          }
        }
      } catch {
        // Ruby-style maps are not valid JSON; the regex below handles them.
      }

      const match = text.match(/"value"\s*(?:=>|:)\s*"((?:[^"\\]|\\.)*)"/);
      if (match) {
        text = decodeEscaped(match[1]).trim();
        continue;
      }
    }

    break;
  }

  if (!text.includes('\n') && /\\[nrt]/.test(text)) {
    text = decodeEscaped(text);
  }

  return text;
}

function stripMarkdown(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => {
      if (/^\s*```/.test(line)) return '';
      if (/^\s*([-*_])\1{2,}\s*$/.test(line)) return '';

      return line
        .replace(/^#{1,6}\s*/, '')
        .replace(/^\s*[-*]\s+/, '• ')
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/__(.+?)__/g, '$1')
        .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2')
        .replace(/(^|[^_])_([^_\n]+)_/g, '$1$2')
        .replace(/<[^>]+>/g, '')
        .replace(/\\([\\`*_{}[\]()#+\-.!])/g, '$1');
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function plainReleaseNotes(raw: string): string {
  if (!raw || !raw.trim()) return '';
  return stripMarkdown(fixMojibake(unwrapNotes(raw)));
}
