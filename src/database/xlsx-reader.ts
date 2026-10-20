import { strFromU8, unzipSync } from 'fflate';

/**
 * Minimal .xlsx reader for header + string cells. Tolerates namespace-prefixed element names
 * (`<x:row>`, as written by .NET OpenXML libraries), which exceljs rejects. Numbers come back as
 * their raw text; dates are not converted (the importer ignores those columns).
 */
export function readFirstSheet(file: Uint8Array): Record<string, string>[] {
  const zip = unzipSync(file);
  const text = (path: string) => (zip[path] ? strFromU8(zip[path]) : undefined);
  const sheetXml = text(firstSheetPath(zip)) ?? '';
  const shared = sharedStrings(text('xl/sharedStrings.xml') ?? '');

  const rows: string[][] = [];
  for (const row of matchAll(sheetXml, /<(?:\w+:)?row\b[^>]*>([\s\S]*?)<\/(?:\w+:)?row>/g)) {
    const cells: string[] = [];
    for (const c of matchAll(row[1], /<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
      const attrs = c[1]; const inner = c[2] ?? '';
      const ref = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1];
      const col = ref ? columnIndex(ref) : cells.length;
      const type = /\bt="(\w+)"/.exec(attrs)?.[1];
      let value = '';
      if (type === 's') value = shared[Number(innerText(inner, 'v'))] ?? '';
      else if (type === 'inlineStr') value = joinRuns(inner);
      else value = decode(innerText(inner, 'v'));
      cells[col] = value;
    }
    rows.push(Array.from(cells, (v) => v ?? ''));
  }

  const header = rows.shift();
  if (!header || header.every((h) => h.trim() === '')) throw new Error('Workbook has no header row');
  const keys = header.map((h) => h.trim());
  return rows
    .filter((r) => r.some((v) => v !== ''))
    .map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? '']).filter(([k]) => k !== '')));
}

function firstSheetPath(zip: Record<string, Uint8Array>): string {
  const fallback = 'xl/worksheets/sheet1.xml';
  const workbook = zip['xl/workbook.xml'] ? strFromU8(zip['xl/workbook.xml']) : '';
  const rels = zip['xl/_rels/workbook.xml.rels'] ? strFromU8(zip['xl/_rels/workbook.xml.rels']) : '';
  const rid = /<(?:\w+:)?sheet\b[^>]*\br:id="([^"]+)"/.exec(workbook)?.[1];
  if (!rid) return fallback;
  const rel = new RegExp(`<Relationship\\b[^>]*\\bId="${rid}"[^>]*\\bTarget="([^"]+)"`).exec(rels) ?? new RegExp(`<Relationship\\b[^>]*\\bTarget="([^"]+)"[^>]*\\bId="${rid}"`).exec(rels);
  if (!rel) return fallback;
  const target = rel[1];
  const path = target.startsWith('/') ? target.slice(1) : target.startsWith('xl/') ? target : `xl/${target}`;
  return zip[path] ? path : fallback;
}

function sharedStrings(xml: string): string[] {
  return matchAll(xml, /<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g).map((m) => joinRuns(m[1]));
}

/** Concatenates every <t> run inside a shared string or inline string. */
function joinRuns(xml: string): string {
  return matchAll(xml, /<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g).map((m) => decode(m[1])).join('');
}

function innerText(xml: string, tag: string): string {
  return new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`).exec(xml)?.[1] ?? '';
}

function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function decode(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function matchAll(s: string, re: RegExp): RegExpExecArray[] {
  return [...s.matchAll(re)] as RegExpExecArray[];
}
