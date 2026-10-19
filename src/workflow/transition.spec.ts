import { describe, it, expect } from 'vitest';
import { transition, TSheet, TStep, Actor } from './transition';
import { DomainError } from '@/common/errors/domain-error';

const NOW = new Date('2026-10-05T10:00:00Z');
const emp: Actor = { id: 'emp', role: 'employee' };
const tl: Actor = { id: 'tl', role: 'tech_lead' };
const dm: Actor = { id: 'dm', role: 'delivery_manager' };
const cto: Actor = { id: 'cto', role: 'cto' };
const admin: Actor = { id: 'admin', role: 'admin' };
const fin: Actor = { id: 'fin', role: 'finance' };
const chain = [
  { position: 1, label: 'TL', approverId: 'tl', backupApproverId: 'dm' },
  { position: 2, label: 'DM', approverId: 'dm', backupApproverId: null },
  { position: 3, label: 'CTO', approverId: 'cto', backupApproverId: null },
];
const sheet = (o: Partial<TSheet> = {}): TSheet => ({ id: 's1', employeeId: 'emp', status: 'draft', round: 1, currentStepPosition: null, submittedAt: null, entryCount: 2, ...o });
const steps = (statuses: Array<TStep['status']> = ['pending', 'pending', 'pending']): TStep[] => chain.map((c, i) => ({ ...c, status: statuses[i] }));
const code = (fn: () => unknown) => { try { fn(); return null; } catch (e) { return (e as DomainError).code; } };

describe('submit', () => {
  it('snapshots the chain, sets step 1 as current, emits submitted to step-1 approver and backup', () => {
    const r = transition(sheet(), [], emp, { type: 'submit', chain }, NOW);
    expect(r.patch).toMatchObject({ status: 'submitted', round: 1, currentStepPosition: 1, submittedAt: NOW });
    expect(r.insertSteps.map((s) => [s.position, s.status, s.round])).toEqual([[1, 'pending', 1], [2, 'pending', 1], [3, 'pending', 1]]);
    expect(r.events).toEqual([{ name: 'sheet.submitted', payload: { sheetId: 's1', employeeId: 'emp', approverIds: ['tl', 'dm'], actorId: 'emp' } }]);
    expect(r.auditAction).toBe('sheet.submitted');
  });
  it('requires owner, entries and a chain; allowed from draft or rejected', () => {
    expect(code(() => transition(sheet(), [], tl, { type: 'submit', chain }, NOW))).toBe('FORBIDDEN');
    expect(code(() => transition(sheet({ entryCount: 0 }), [], emp, { type: 'submit', chain }, NOW))).toBe('SHEET_EMPTY');
    expect(code(() => transition(sheet(), [], emp, { type: 'submit', chain: [] }, NOW))).toBe('CHAIN_EMPTY');
    expect(code(() => transition(sheet({ status: 'submitted' }), [], emp, { type: 'submit', chain }, NOW))).toBe('INVALID_TRANSITION');
    expect(code(() => transition(sheet({ status: 'rejected', submittedAt: NOW }), [], emp, { type: 'submit', chain }, NOW))).toBeNull();
  });
  it('increments the round when the sheet was submitted before', () => {
    const r = transition(sheet({ status: 'rejected', round: 1, submittedAt: NOW }), [], emp, { type: 'submit', chain }, NOW);
    expect(r.patch.round).toBe(2); expect(r.insertSteps[0].round).toBe(2);
  });
  it('skips steps whose primary approver is the owner; backup-self is ignored', () => {
    const r = transition(sheet({ employeeId: 'tl' }), [], tl, { type: 'submit', chain }, NOW);
    expect(r.insertSteps.map((s) => s.status)).toEqual(['skipped', 'pending', 'pending']);
    expect(r.insertSteps[0].comment).toBe('self');
    expect(r.patch.currentStepPosition).toBe(2);
    expect(r.events[0].payload.approverIds).toEqual(['dm']);
    const r2 = transition(sheet({ employeeId: 'dm' }), [], dm, { type: 'submit', chain }, NOW);
    expect(r2.insertSteps.map((s) => s.status)).toEqual(['pending', 'skipped', 'pending']);
    expect(r2.patch.currentStepPosition).toBe(1);
    expect(r2.events[0].payload.approverIds).toEqual(['tl']);
  });
  it('auto-approves when every step is skipped', () => {
    const r = transition(sheet({ employeeId: 'cto' }), [], cto, { type: 'submit', chain: [{ position: 1, label: 'CTO', approverId: 'cto', backupApproverId: null }] }, NOW);
    expect(r.patch).toMatchObject({ status: 'approved', approvedAt: NOW, currentStepPosition: null });
    expect(r.events.map((e) => e.name)).toEqual(['sheet.submitted', 'sheet.approved']);
  });
});

describe('approve', () => {
  const sub = sheet({ status: 'submitted', currentStepPosition: 1, submittedAt: NOW });
  it('advances to the next pending step and notifies its approver', () => {
    const r = transition(sub, steps(), tl, { type: 'approve', comment: 'ok' }, NOW);
    expect(r.patch).toEqual({ currentStepPosition: 2 });
    expect(r.updateSteps).toEqual([{ position: 1, status: 'approved', decidedById: 'tl', decidedAt: NOW, comment: 'ok', overrideReason: null }]);
    expect(r.events).toEqual([{ name: 'sheet.step_approved', payload: { sheetId: 's1', employeeId: 'emp', approverIds: ['dm'], actorId: 'tl' } }]);
  });
  it('backup approver may approve', () => { expect(code(() => transition(sub, steps(), dm, { type: 'approve' }, NOW))).toBeNull(); });
  it('owner who is backup on the current step cannot approve own sheet', () => {
    const own = sheet({ employeeId: 'dm', status: 'submitted', currentStepPosition: 1, submittedAt: NOW });
    expect(code(() => transition(own, steps(), dm, { type: 'approve' }, NOW))).toBe('NOT_CURRENT_APPROVER');
  });
  it('wrong approver is NOT_CURRENT_APPROVER; non-submitted is INVALID_TRANSITION', () => {
    expect(code(() => transition(sub, steps(), cto, { type: 'approve' }, NOW))).toBe('NOT_CURRENT_APPROVER');
    expect(code(() => transition(sub, steps(), emp, { type: 'approve' }, NOW))).toBe('NOT_CURRENT_APPROVER');
    expect(code(() => transition(sheet(), steps(), tl, { type: 'approve' }, NOW))).toBe('INVALID_TRANSITION');
  });
  it('admin may override only with a reason', () => {
    expect(code(() => transition(sub, steps(), admin, { type: 'approve' }, NOW))).toBe('REASON_REQUIRED');
    const r = transition(sub, steps(), admin, { type: 'approve', overrideReason: 'TL on leave' }, NOW);
    expect(r.updateSteps[0]).toMatchObject({ decidedById: 'admin', overrideReason: 'TL on leave' });
  });
  it('last step approval completes the sheet', () => {
    const last = sheet({ status: 'submitted', currentStepPosition: 3, submittedAt: NOW });
    const r = transition(last, steps(['approved', 'approved', 'pending']), cto, { type: 'approve' }, NOW);
    expect(r.patch).toMatchObject({ status: 'approved', approvedAt: NOW, currentStepPosition: null });
    expect(r.events).toEqual([{ name: 'sheet.approved', payload: { sheetId: 's1', employeeId: 'emp', approverIds: [], actorId: 'cto' } }]);
    expect(r.auditAction).toBe('sheet.approved');
  });
  it('skips over skipped steps when advancing', () => {
    const r = transition(sub, steps(['pending', 'skipped', 'pending']), tl, { type: 'approve' }, NOW);
    expect(r.patch.currentStepPosition).toBe(3);
  });
});

describe('reject', () => {
  const sub = sheet({ status: 'submitted', currentStepPosition: 2, submittedAt: NOW });
  it('marks current rejected, remaining skipped, sheet rejected with reason', () => {
    const r = transition(sub, steps(['approved', 'pending', 'pending']), dm, { type: 'reject', reason: 'Missing ticket refs' }, NOW);
    expect(r.patch).toMatchObject({ status: 'rejected', rejectedAt: NOW, rejectionReason: 'Missing ticket refs', currentStepPosition: null });
    expect(r.updateSteps).toEqual([
      { position: 2, status: 'rejected', decidedById: 'dm', decidedAt: NOW, comment: 'Missing ticket refs', overrideReason: null },
      { position: 3, status: 'skipped', decidedById: null, decidedAt: NOW, comment: 'round rejected', overrideReason: null },
    ]);
    expect(r.events[0]).toEqual({ name: 'sheet.rejected', payload: { sheetId: 's1', employeeId: 'emp', approverIds: [], actorId: 'dm', reason: 'Missing ticket refs' } });
  });
  it('owner who is backup on the current step cannot reject own sheet', () => {
    const own = sheet({ employeeId: 'dm', status: 'submitted', currentStepPosition: 1, submittedAt: NOW });
    expect(code(() => transition(own, steps(), dm, { type: 'reject', reason: 'Self reject attempt' }, NOW))).toBe('NOT_CURRENT_APPROVER');
  });
  it('requires a reason of 5+ chars', () => { expect(code(() => transition(sub, steps(['approved', 'pending', 'pending']), dm, { type: 'reject', reason: 'no' }, NOW))).toBe('REASON_REQUIRED'); });
});

describe('withdraw', () => {
  it('owner withdraws before any approval; steps of the round are deleted', () => {
    const r = transition(sheet({ status: 'submitted', currentStepPosition: 1, submittedAt: NOW }), steps(), emp, { type: 'withdraw' }, NOW);
    expect(r.patch).toEqual({ status: 'draft', currentStepPosition: null });
    expect(r.deleteCurrentRoundSteps).toBe(true);
    expect(r.events[0]).toMatchObject({ name: 'sheet.withdrawn', payload: { approverIds: ['tl', 'dm', 'cto'] } });
  });
  it('fails after a step was approved, or for non-owner', () => {
    const s = sheet({ status: 'submitted', currentStepPosition: 2, submittedAt: NOW });
    expect(code(() => transition(s, steps(['approved', 'pending', 'pending']), emp, { type: 'withdraw' }, NOW))).toBe('INVALID_TRANSITION');
    expect(code(() => transition(sheet({ status: 'submitted', currentStepPosition: 1, submittedAt: NOW }), steps(), tl, { type: 'withdraw' }, NOW))).toBe('FORBIDDEN');
  });
});

describe('reopen / markPaid / revertPaid', () => {
  const approved = sheet({ status: 'approved', submittedAt: NOW });
  it('admin reopens approved → draft with reason', () => {
    expect(code(() => transition(approved, [], fin, { type: 'reopen', reason: 'Wrong month' }, NOW))).toBe('FORBIDDEN');
    expect(code(() => transition(approved, [], admin, { type: 'reopen', reason: '' }, NOW))).toBe('REASON_REQUIRED');
    const r = transition(approved, [], admin, { type: 'reopen', reason: 'Wrong month' }, NOW);
    expect(r.patch).toEqual({ status: 'draft', approvedAt: null, currentStepPosition: null });
    expect(r.reason).toBe('Wrong month');
  });
  it('finance marks paid with a reference; employee cannot; needs approved', () => {
    expect(code(() => transition(approved, [], emp, { type: 'markPaid', paymentReference: 'PAY-1' }, NOW))).toBe('FORBIDDEN');
    expect(code(() => transition(approved, [], fin, { type: 'markPaid', paymentReference: ' ' }, NOW))).toBe('PAYMENT_REFERENCE_REQUIRED');
    expect(code(() => transition(sheet({ status: 'submitted' }), [], fin, { type: 'markPaid', paymentReference: 'PAY-1' }, NOW))).toBe('INVALID_TRANSITION');
    const r = transition(approved, [], fin, { type: 'markPaid', paymentReference: 'PAY-1' }, NOW);
    expect(r.patch).toEqual({ status: 'paid', paidAt: NOW, paidById: 'fin', paymentReference: 'PAY-1' });
    expect(r.events[0].name).toBe('sheet.paid');
  });
  it('revertPaid returns to approved and clears payment fields', () => {
    const r = transition(sheet({ status: 'paid' }), [], admin, { type: 'revertPaid', reason: 'Duplicate batch' }, NOW);
    expect(r.patch).toEqual({ status: 'approved', paidAt: null, paidById: null, paymentReference: null });
    expect(r.events[0].name).toBe('sheet.payment_reverted');
  });
});
