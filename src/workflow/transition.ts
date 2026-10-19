import { ApprovalStepStatus, SheetStatus, UserRole } from '@/database/schema';
import { DomainError, forbidden } from '@/common/errors/domain-error';
import type { ChainStepInput } from '@/approval-chains/approval-chains.service';

export type Actor = { id: string; role: UserRole };
export interface TSheet { id: string; employeeId: string; status: SheetStatus; round: number; currentStepPosition: number | null; submittedAt: Date | null; entryCount: number }
export interface TStep { position: number; label: string; approverId: string; backupApproverId: string | null; status: ApprovalStepStatus }
export type Action =
  | { type: 'submit'; chain: ChainStepInput[] } | { type: 'withdraw' }
  | { type: 'approve'; comment?: string; overrideReason?: string } | { type: 'reject'; reason: string; overrideReason?: string }
  | { type: 'reopen'; reason: string } | { type: 'markPaid'; paymentReference: string; paidAt?: Date } | { type: 'revertPaid'; reason: string };
export interface StepUpdate { position: number; status: ApprovalStepStatus; decidedById: string | null; decidedAt: Date | null; comment: string | null; overrideReason: string | null }
export type WorkflowEventName = 'sheet.submitted' | 'sheet.step_approved' | 'sheet.approved' | 'sheet.rejected' | 'sheet.withdrawn' | 'sheet.reopened' | 'sheet.paid' | 'sheet.payment_reverted';
export interface WorkflowEvent { name: WorkflowEventName; payload: { sheetId: string; employeeId: string; approverIds: string[]; actorId: string; reason?: string } }
export interface TransitionResult {
  patch: Partial<{ status: SheetStatus; round: number; currentStepPosition: number | null; submittedAt: Date | null; approvedAt: Date | null; rejectedAt: Date | null; rejectionReason: string | null; paidAt: Date | null; paidById: string | null; paymentReference: string | null }>;
  insertSteps: Array<TStep & { round: number; comment: string | null }>;
  updateSteps: StepUpdate[];
  deleteCurrentRoundSteps: boolean;
  auditAction: string;
  reason: string | null;
  events: WorkflowEvent[];
}

const invalid = (msg: string) => new DomainError('INVALID_TRANSITION', msg, 409);
const needReason = (what: string) => new DomainError('REASON_REQUIRED', `${what} requires a reason`, 400);
const base = (): TransitionResult => ({ patch: {}, insertSteps: [], updateSteps: [], deleteCurrentRoundSteps: false, auditAction: '', reason: null, events: [] });
const ev = (name: WorkflowEventName, sheet: TSheet, actor: Actor, approverIds: string[], reason?: string): WorkflowEvent => ({ name, payload: { sheetId: sheet.id, employeeId: sheet.employeeId, approverIds, actorId: actor.id, ...(reason ? { reason } : {}) } });
const approversOf = (s: TStep, employeeId: string) => [s.approverId, s.backupApproverId].filter((id): id is string => id !== null && id !== employeeId);
const isFinance = (a: Actor) => a.role === 'finance' || a.role === 'admin';

export function transition(sheet: TSheet, steps: TStep[], actor: Actor, action: Action, now: Date): TransitionResult {
  switch (action.type) {
    case 'submit': return submit(sheet, actor, action.chain, now);
    case 'withdraw': return withdraw(sheet, steps, actor);
    case 'approve': return decide(sheet, steps, actor, { kind: 'approve', comment: action.comment ?? null, overrideReason: action.overrideReason ?? null }, now);
    case 'reject': return decide(sheet, steps, actor, { kind: 'reject', comment: action.reason, overrideReason: action.overrideReason ?? null }, now);
    case 'reopen': return reopen(sheet, actor, action.reason);
    case 'markPaid': return markPaid(sheet, actor, action.paymentReference, action.paidAt ?? now);
    case 'revertPaid': return revertPaid(sheet, actor, action.reason);
  }
}

function submit(sheet: TSheet, actor: Actor, chain: ChainStepInput[], now: Date): TransitionResult {
  if (actor.id !== sheet.employeeId) throw forbidden('Only the sheet owner can submit');
  if (sheet.status !== 'draft' && sheet.status !== 'rejected') throw invalid(`Cannot submit a ${sheet.status} sheet`);
  if (sheet.entryCount === 0) throw new DomainError('SHEET_EMPTY', 'Add at least one entry before submitting', 409);
  if (chain.length === 0) throw new DomainError('CHAIN_EMPTY', 'This team has no approval chain configured', 409);
  const r = base();
  const round = sheet.submittedAt ? sheet.round + 1 : sheet.round;
  r.insertSteps = chain.map((c) => {
    const self = c.approverId === sheet.employeeId;
    return { position: c.position, label: c.label, approverId: c.approverId, backupApproverId: c.backupApproverId, status: self ? 'skipped' : 'pending', round, comment: self ? 'self' : null };
  });
  const first = r.insertSteps.find((s) => s.status === 'pending');
  r.patch = { status: 'submitted', round, currentStepPosition: first?.position ?? null, submittedAt: now, rejectedAt: null, rejectionReason: null };
  r.auditAction = 'sheet.submitted';
  r.events.push(ev('sheet.submitted', sheet, actor, first ? approversOf(first, sheet.employeeId) : []));
  if (!first) {
    r.patch = { ...r.patch, status: 'approved', approvedAt: now, currentStepPosition: null };
    r.auditAction = 'sheet.approved';
    r.events.push(ev('sheet.approved', sheet, actor, []));
  }
  return r;
}

function withdraw(sheet: TSheet, steps: TStep[], actor: Actor): TransitionResult {
  if (actor.id !== sheet.employeeId) throw forbidden('Only the sheet owner can withdraw');
  if (sheet.status !== 'submitted') throw invalid(`Cannot withdraw a ${sheet.status} sheet`);
  if (steps.some((s) => s.status === 'approved')) throw invalid('Cannot withdraw after a step has been approved');
  const r = base();
  r.patch = { status: 'draft', currentStepPosition: null };
  r.deleteCurrentRoundSteps = true;
  r.auditAction = 'sheet.withdrawn';
  r.events.push(ev('sheet.withdrawn', sheet, actor, [...new Set(steps.flatMap((s) => approversOf(s, sheet.employeeId)))]));
  return r;
}

function decide(sheet: TSheet, steps: TStep[], actor: Actor, d: { kind: 'approve' | 'reject'; comment: string | null; overrideReason: string | null }, now: Date): TransitionResult {
  if (sheet.status !== 'submitted') throw invalid(`Cannot ${d.kind} a ${sheet.status} sheet`);
  const current = steps.find((s) => s.position === sheet.currentStepPosition && s.status === 'pending');
  if (!current) throw invalid('Sheet has no pending step');
  if (actor.id === sheet.employeeId) throw new DomainError('NOT_CURRENT_APPROVER', 'You cannot decide on your own sheet', 403);
  const isAdmin = actor.role === 'admin';
  const named = approversOf(current, sheet.employeeId).includes(actor.id);
  if (!named && !isAdmin) throw new DomainError('NOT_CURRENT_APPROVER', 'You are not the approver for the current step', 403);
  if (!named && isAdmin && !d.overrideReason?.trim()) throw needReason('Admin override');
  if (d.kind === 'reject' && (d.comment ?? '').trim().length < 5) throw needReason('Rejection');
  const override = named ? null : d.overrideReason;
  const r = base();
  r.updateSteps.push({ position: current.position, status: d.kind === 'approve' ? 'approved' : 'rejected', decidedById: actor.id, decidedAt: now, comment: d.comment, overrideReason: override });
  if (d.kind === 'reject') {
    for (const s of steps) if (s.status === 'pending' && s.position > current.position) r.updateSteps.push({ position: s.position, status: 'skipped', decidedById: null, decidedAt: now, comment: 'round rejected', overrideReason: null });
    r.patch = { status: 'rejected', rejectedAt: now, rejectionReason: d.comment, currentStepPosition: null };
    r.auditAction = 'sheet.rejected'; r.reason = d.comment;
    r.events.push(ev('sheet.rejected', sheet, actor, [], d.comment!));
    return r;
  }
  const next = steps.filter((s) => s.status === 'pending' && s.position > current.position).sort((a, b) => a.position - b.position)[0];
  if (next) {
    r.patch = { currentStepPosition: next.position };
    r.auditAction = 'sheet.step_approved';
    r.events.push(ev('sheet.step_approved', sheet, actor, approversOf(next, sheet.employeeId)));
  } else {
    r.patch = { status: 'approved', approvedAt: now, currentStepPosition: null };
    r.auditAction = 'sheet.approved';
    r.events.push(ev('sheet.approved', sheet, actor, []));
  }
  r.reason = override;
  return r;
}

function reopen(sheet: TSheet, actor: Actor, reason: string): TransitionResult {
  if (actor.role !== 'admin') throw forbidden('Only admins can reopen sheets');
  if (sheet.status !== 'approved') throw invalid(`Cannot reopen a ${sheet.status} sheet`);
  if (!reason?.trim()) throw needReason('Reopen');
  const r = base();
  r.patch = { status: 'draft', approvedAt: null, currentStepPosition: null };
  r.auditAction = 'sheet.reopened'; r.reason = reason;
  r.events.push(ev('sheet.reopened', sheet, actor, [], reason));
  return r;
}

function markPaid(sheet: TSheet, actor: Actor, paymentReference: string, paidAt: Date): TransitionResult {
  if (!isFinance(actor)) throw forbidden('Only finance or admin can mark sheets paid');
  if (sheet.status !== 'approved') throw invalid(`Cannot mark a ${sheet.status} sheet as paid`);
  if (!paymentReference?.trim()) throw new DomainError('PAYMENT_REFERENCE_REQUIRED', 'Payment reference is required', 400);
  const r = base();
  r.patch = { status: 'paid', paidAt, paidById: actor.id, paymentReference: paymentReference.trim() };
  r.auditAction = 'sheet.paid';
  r.events.push(ev('sheet.paid', sheet, actor, []));
  return r;
}

function revertPaid(sheet: TSheet, actor: Actor, reason: string): TransitionResult {
  if (!isFinance(actor)) throw forbidden('Only finance or admin can revert payments');
  if (sheet.status !== 'paid') throw invalid(`Cannot revert payment on a ${sheet.status} sheet`);
  if (!reason?.trim()) throw needReason('Revert payment');
  const r = base();
  r.patch = { status: 'approved', paidAt: null, paidById: null, paymentReference: null };
  r.auditAction = 'sheet.payment_reverted'; r.reason = reason;
  r.events.push(ev('sheet.payment_reverted', sheet, actor, [], reason));
  return r;
}
