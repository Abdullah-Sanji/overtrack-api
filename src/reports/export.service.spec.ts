import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { ExportService } from './export.service';
import { TeamMonthReport } from './team-month.service';

const report: TeamMonthReport = {
  team: { id: 't1', name: 'Platform' }, period: '2026-09',
  types: [{ id: 'wd', name: 'Weekday', multiplier: 1.5, color: '#000' }, { id: 'we', name: 'Weekend', multiplier: 2, color: '#000' }],
  rows: [{
    employee: { id: 'e1', firstName: 'Ann', lastName: 'Lee', employeeCode: 'E1' },
    sheet: { id: 's1', period: '2026-09', status: 'approved', round: 1, currentStepPosition: null, totalHours: 6, totalWeightedHours: 11, submittedAt: new Date('2026-10-01T00:00:00Z'), approvedAt: new Date('2026-10-02T00:00:00Z'), rejectedAt: null, rejectionReason: null, paidAt: null, paymentReference: null, version: 4, employee: { id: 'e1', firstName: 'Ann', lastName: 'Lee', employeeCode: 'E1', teamId: 't1', teamName: 'Platform' } },
    hoursByType: { wd: 2, we: 4 }, totalHours: 6, totalWeightedHours: 11,
    entries: [
      { id: 'x1', date: '2026-09-01', startTime: '18:00', endTime: '20:00', hours: 2, multiplier: 1.5, weightedHours: 3, overtimeType: { id: 'wd', name: 'Weekday', color: '#000' }, workItem: 'PROJ-1', workItemUrl: null, description: 'Hotfix', requestedBy: null, attachment: null },
      { id: 'x2', date: '2026-09-05', startTime: '10:00', endTime: '14:00', hours: 4, multiplier: 2, weightedHours: 8, overtimeType: { id: 'we', name: 'Weekend', color: '#000' }, workItem: 'PROJ-2', workItemUrl: 'https://j/PROJ-2', description: 'Release', requestedBy: { id: 'm', firstName: 'Max', lastName: 'Po' }, attachment: null },
    ],
  }, { employee: { id: 'e2', firstName: 'Bob', lastName: 'Ray', employeeCode: null }, sheet: null, hoursByType: {}, totalHours: 0, totalWeightedHours: 0, entries: [] }],
  totals: { totalHours: 6, totalWeightedHours: 11, hoursByType: { wd: 2, we: 4 } },
};

describe('ExportService', () => {
  const svc = new ExportService();
  it('builds an xlsx with Summary and Details sheets', async () => {
    const buf = await svc.toXlsx([report]);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const summary = wb.getWorksheet('Summary')!; const details = wb.getWorksheet('Details')!;
    expect(summary.getRow(1).values).toEqual([undefined, 'Employee code', 'Employee', 'Team', 'Period', 'Weekday (h)', 'Weekend (h)', 'Total hours', 'Weighted hours', 'Status', 'Submitted at', 'Approved at', 'Paid at', 'Payment reference']);
    expect(summary.getRow(2).getCell(2).value).toBe('Ann Lee'); expect(summary.getRow(2).getCell(8).value).toBe(11);
    expect(summary.getRow(3).getCell(9).value).toBe('no sheet');
    expect(details.rowCount).toBe(3);
    expect(details.getRow(3).getCell(12).value).toBe('PROJ-2'); expect(details.getRow(3).getCell(15).value).toBe('Max Po');
  });
  it('builds csv with the Details layout', () => {
    const csv = svc.toCsv([report]);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('Employee code,Employee,Team,Period,Date,Start,End,Hours,Type,Multiplier,Weighted hours,Work item,Work item URL,Description,Requested by,Sheet status');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('"Hotfix"');
  });
  it('neutralises formula injection in csv string cells', () => {
    const r = structuredClone(report);
    r.rows[0].entries[0].description = '=HYPERLINK("x")'; r.rows[0].entries[0].workItem = '-1';
    const lines = svc.toCsv([r]).trim().split('\n');
    expect(lines[1]).toContain('"\'=HYPERLINK(""x"")"'); expect(lines[1]).toContain(`,'-1,`); expect(lines[2]).toContain(',PROJ-2,');
    expect(svc.toCsv([report])).toContain('"Release"');
    const plain = structuredClone(report); plain.rows[0].entries[0].description = 'Hotfix'; plain.rows[0].entries[0].workItem = 'Hotfix';
    expect(svc.toCsv([plain]).split('\n')[1]).toContain(',Hotfix,');
  });
  it('names files', () => {
    expect(svc.fileName('team', 'Platform Team', '2026-09', 'xlsx')).toBe('overtrack-platform-team-2026-09.xlsx');
    expect(svc.fileName('all', null, '2026-09', 'csv')).toBe('overtrack-all-2026-09.csv');
  });
});
