import type { ISODate } from "./types";

/**
 * A single transaction as it appeared in an OFX Statement, before it becomes a
 * Transaction in a Vault. Amounts stay signed here (negative = money out);
 * the sign is what decides Income vs Expense at import time.
 */
export interface OfxEntry {
  /** The bank's unique id for this entry (FITID). Dedup keys on this (ADR-0004 / M2). */
  fitid: string;
  date: ISODate;
  /** Signed centavos exactly as the statement stated it. */
  amount: number;
  description: string;
  trntype: string;
}

export interface ParsedStatement {
  entries: OfxEntry[];
  /** The account the statement belongs to, when the file names one. */
  acctId: string | null;
  /** Currency declared by the file (CURDEF), e.g. "BRL". */
  currency: string | null;
  periodStart: ISODate | null;
  periodEnd: ISODate | null;
  /** Entries we could not read (missing FITID/date/amount). Surfaced, never silently dropped. */
  malformed: number;
}

/**
 * Decode raw OFX bytes using the charset the file declares. Brazilian banks
 * commonly emit OFX 1.x as windows-1252, so decoding as UTF-8 would mangle
 * accented memos ("ALIMENTAÇÃO"). OFX 2.x is XML and declares its own encoding.
 */
export function decodeOfxBytes(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  // The header is ASCII either way, so it is safe to peek at it as latin1.
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 2048));

  let label = "utf-8";
  const charset = /CHARSET:\s*(\S+)/i.exec(head)?.[1]?.toUpperCase();
  const encoding = /ENCODING:\s*(\S+)/i.exec(head)?.[1]?.toUpperCase();
  if (encoding === "UTF-8" || charset === "UTF-8") {
    label = "utf-8";
  } else if (
    encoding === "USASCII" ||
    charset === "1252" ||
    charset === "ISO-8859-1" ||
    charset === "8859-1"
  ) {
    label = "windows-1252";
  }
  const xmlEncoding = /<\?xml[^>]*encoding=["']([^"']+)["']/i.exec(head)?.[1];
  if (xmlEncoding) label = xmlEncoding.toLowerCase();

  // Some banks declare CHARSET:1252 but actually write UTF-8, which would turn
  // "SÃO" into "SÃ£O". The header can't be trusted, the bytes can: real
  // windows-1252 accents are single bytes followed by ASCII, which is never
  // valid UTF-8, so bytes that do decode strictly as UTF-8 almost certainly are.
  if (label === "windows-1252" && bytes.some((b) => b >= 0x80)) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      // Not UTF-8: it really is windows-1252, as declared.
    }
  }

  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    // &amp; must be decoded last so "&amp;lt;" does not become "<".
    .replace(/&amp;/gi, "&");
}

/**
 * Read one data element. OFX 1.x is SGML and omits closing tags on leaf
 * elements, so a value runs until the next "<"; that also works for OFX 2.x XML.
 */
function field(block: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([^<]*)`, "i").exec(block);
  if (!match) return null;
  const value = decodeEntities(match[1]).trim();
  return value === "" ? null : value;
}

/**
 * Parse an OFX monetary amount into signed centavos, exactly (ADR-0003: never
 * via floats). Handles "-49.90", "1.234,56" and "1,234.56": the last separator
 * is the decimal one, anything before it is a thousands separator.
 */
export function parseOfxAmount(raw: string): number {
  const cleaned = raw.trim().replace(/\s/g, "");
  if (cleaned === "") throw new Error("Valor vazio no OFX");

  let sign = 1;
  let body = cleaned;
  if (body.startsWith("-")) {
    sign = -1;
    body = body.slice(1);
  } else if (body.startsWith("+")) {
    body = body.slice(1);
  }

  const lastSeparator = Math.max(body.lastIndexOf("."), body.lastIndexOf(","));
  let integerPart = lastSeparator === -1 ? body : body.slice(0, lastSeparator);
  const fractionPart = lastSeparator === -1 ? "" : body.slice(lastSeparator + 1);
  integerPart = integerPart.replace(/[.,]/g, "");

  if (!/^\d*$/.test(integerPart) || !/^\d*$/.test(fractionPart)) {
    throw new Error(`Valor OFX inválido: "${raw}"`);
  }
  if (integerPart === "" && fractionPart === "") {
    throw new Error(`Valor OFX inválido: "${raw}"`);
  }

  const units = Number(integerPart || "0");
  let cents: number;
  if (fractionPart.length <= 2) {
    cents = units * 100 + Number(fractionPart.padEnd(2, "0"));
  } else {
    // More precision than centavos: round half-up on the third decimal.
    const roundUp = Number(fractionPart[2]) >= 5;
    cents = units * 100 + Number(fractionPart.slice(0, 2)) + (roundUp ? 1 : 0);
  }
  return sign * cents;
}

/**
 * Parse an OFX timestamp ("20260105", "20260105120000[-3:BRT]") into "YYYY-MM-DD".
 * The date is taken as the bank stated it; no timezone conversion, because a
 * statement date is already the bank's local posting date.
 */
export function parseOfxDate(raw: string): ISODate {
  const match = /(\d{4})(\d{2})(\d{2})/.exec(raw.trim());
  if (!match) throw new Error(`Data OFX inválida: "${raw}"`);
  const [, year, month, day] = match;
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31) {
    throw new Error(`Data OFX inválida: "${raw}"`);
  }
  return `${year}-${month}-${day}`;
}

function describe(block: string): string {
  const name = field(block, "NAME");
  const memo = field(block, "MEMO");
  const parts = [name, memo].filter((p): p is string => p !== null);
  const unique = parts.filter((p, i) => parts.indexOf(p) === i);
  return unique.join(" · ");
}

/** Pull the <STMTTRN> blocks out of an OFX document, SGML or XML. */
function transactionBlocks(text: string): string[] {
  const closed = text.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi);
  if (closed && closed.length > 0) return closed;
  // Tolerate non-conformant files that omit the closing aggregate tag.
  return text
    .split(/<STMTTRN>/i)
    .slice(1)
    .map((part) => part.split(/<\/BANKTRANLIST>|<\/STMTRS>|<\/CCSTMTRS>/i)[0]);
}

/** Parse an OFX statement. Throws only when the text isn't an OFX file at all. */
export function parseOfx(text: string): ParsedStatement {
  const blocks = transactionBlocks(text);
  if (blocks.length === 0 && !/<OFX>/i.test(text)) {
    throw new Error("Este arquivo não parece ser um OFX.");
  }

  const entries: OfxEntry[] = [];
  let malformed = 0;

  for (const block of blocks) {
    const fitid = field(block, "FITID");
    const posted = field(block, "DTPOSTED");
    const amount = field(block, "TRNAMT");
    if (fitid === null || posted === null || amount === null) {
      malformed += 1;
      continue;
    }
    try {
      entries.push({
        fitid,
        date: parseOfxDate(posted),
        amount: parseOfxAmount(amount),
        description: describe(block),
        trntype: field(block, "TRNTYPE") ?? "",
      });
    } catch {
      malformed += 1;
    }
  }

  const header = text.split(/<BANKTRANLIST>/i)[0];
  return {
    entries,
    acctId: field(header, "ACCTID"),
    currency: field(header, "CURDEF"),
    periodStart: safeDate(field(text, "DTSTART")),
    periodEnd: safeDate(field(text, "DTEND")),
    malformed,
  };
}

function safeDate(raw: string | null): ISODate | null {
  if (raw === null) return null;
  try {
    return parseOfxDate(raw);
  } catch {
    return null;
  }
}
