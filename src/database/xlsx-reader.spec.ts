import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { strToU8, zipSync } from 'fflate';
import { readFirstSheet } from './xlsx-reader';

async function standardXlsx(rows: string[][]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  for (const r of rows) ws.addRow(r);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

/** Mimics the .NET OpenXML output: every element carries the `x:` prefix. */
function prefixedXlsx(): Uint8Array {
  const X = 'xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const si = (...runs: string[]) => `<x:si>${runs.map((t) => `<x:t>${t}</x:t>`).join('')}</x:si>`;
  const s = (ref: string, idx: number) => `<x:c r="${ref}" t="s"><x:v>${idx}</x:v></x:c>`;
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="/xl/workbook.xml"/></Relationships>'),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="utf-8"?><x:workbook ${X} ${R}><x:sheets><x:sheet name="Data" sheetId="1" r:id="rId1"/></x:sheets></x:workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8('<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet1.xml"/></Relationships>'),
    'xl/sharedStrings.xml': strToU8(`<?xml version="1.0" encoding="utf-8"?><x:sst ${X}>${si('Name')}${si('Email')}${si('Dept')}${si('Ann Lee')}${si('ann@x.test')}${si('Ops')}${si('Bo', 'b')}${si('bob@x.test')}</x:sst>`),
    'xl/worksheets/sheet1.xml': strToU8(`<?xml version="1.0" encoding="utf-8"?><x:worksheet ${X}><x:sheetData>
      <x:row r="1">${s('A1', 0)}${s('B1', 1)}${s('C1', 2)}</x:row>
      <x:row r="2">${s('A2', 3)}${s('B2', 4)}${s('C2', 5)}</x:row>
      <x:row r="3">${s('A3', 6)}${s('B3', 7)}<x:c r="C3" t="inlineStr"><x:is><x:t>Design</x:t></x:is></x:c></x:row>
      <x:row r="4"><x:c r="A4"><x:v>42</x:v></x:c></x:row>
      <x:row r="5"></x:row>
    </x:sheetData></x:worksheet>`),
  };
  return zipSync(files);
}

describe('readFirstSheet', () => {
  it('reads a standard workbook by header name and skips fully empty rows', async () => {
    const file = await standardXlsx([['Name', 'Email', 'Dept'], ['Ann Lee', 'ann@x.test', 'Ops'], ['Bob', 'bob@x.test', ''], ['', '', ''], ['', '', '']]);
    expect(readFirstSheet(file)).toEqual([{ Name: 'Ann Lee', Email: 'ann@x.test', Dept: 'Ops' }, { Name: 'Bob', Email: 'bob@x.test', Dept: '' }]);
  });

  it('reads an x:-prefixed workbook, joining split shared-string runs and inline strings', () => {
    expect(readFirstSheet(prefixedXlsx())).toEqual([
      { Name: 'Ann Lee', Email: 'ann@x.test', Dept: 'Ops' },
      { Name: 'Bob', Email: 'bob@x.test', Dept: 'Design' },
      { Name: '42', Email: '', Dept: '' },
    ]);
  });

  it('throws on an empty sheet', async () => {
    const file = await standardXlsx([]);
    expect(() => readFirstSheet(file)).toThrow('Workbook has no header row');
  });
});
