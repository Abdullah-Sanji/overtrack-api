import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { TeamMonthReport } from './team-month.service';

const DETAIL_HEADERS = ['Employee code', 'Employee', 'Team', 'Period', 'Date', 'Start', 'End', 'Hours', 'Type', 'Multiplier', 'Weighted hours', 'Work item', 'Work item URL', 'Description', 'Requested by', 'Sheet status'];
const fullName = (p: { firstName: string; lastName: string } | null) => (p ? `${p.firstName} ${p.lastName}` : '');
const iso = (d: Date | null) => (d ? d.toISOString() : '');

@Injectable()
export class ExportService {
  private detailRows(reports: TeamMonthReport[]): Array<Array<string | number>> {
    const out: Array<Array<string | number>> = [];
    for (const r of reports) for (const row of r.rows) for (const e of row.entries) {
      out.push([row.employee.employeeCode ?? '', fullName(row.employee), r.team.name, r.period, e.date, e.startTime, e.endTime, e.hours, e.overtimeType.name, e.multiplier, e.weightedHours, e.workItem, e.workItemUrl ?? '', e.description, fullName(e.requestedBy), row.sheet?.status ?? '']);
    }
    return out;
  }

  async toXlsx(reports: TeamMonthReport[]): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const typeIds = [...new Map(reports.flatMap((r) => r.types).map((t) => [t.id, t])).values()];
    const summary = wb.addWorksheet('Summary');
    summary.addRow(['Employee code', 'Employee', 'Team', 'Period', ...typeIds.map((t) => `${t.name} (h)`), 'Total hours', 'Weighted hours', 'Status', 'Submitted at', 'Approved at', 'Paid at', 'Payment reference']);
    for (const r of reports) for (const row of r.rows) {
      summary.addRow([row.employee.employeeCode ?? '', fullName(row.employee), r.team.name, r.period, ...typeIds.map((t) => row.hoursByType[t.id] ?? 0), row.totalHours, row.totalWeightedHours, row.sheet?.status ?? 'no sheet', iso(row.sheet?.submittedAt ?? null), iso(row.sheet?.approvedAt ?? null), iso(row.sheet?.paidAt ?? null), row.sheet?.paymentReference ?? '']);
    }
    const details = wb.addWorksheet('Details');
    details.addRow(DETAIL_HEADERS);
    for (const row of this.detailRows(reports)) details.addRow(row);
    for (const ws of [summary, details]) { ws.getRow(1).font = { bold: true }; ws.columns.forEach((c) => { c.width = 18; }); ws.views = [{ state: 'frozen', ySplit: 1 }]; }
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  toCsv(reports: TeamMonthReport[]): string {
    const esc = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [DETAIL_HEADERS.join(','), ...this.detailRows(reports).map((r) => r.map((c, i) => (i === 13 ? `"${String(c).replace(/"/g, '""')}"` : esc(c))).join(','))];
    return lines.join('\n') + '\n';
  }

  fileName(scope: 'team' | 'all', teamName: string | null, period: string, format: 'xlsx' | 'csv'): string {
    const slug = scope === 'all' ? 'all' : (teamName ?? 'team').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    return `overtrack-${slug}-${period}.${format}`;
  }
}
