import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { KB, KbEntry, METRICS, Metric, QUEUE, QueueTicket } from './ticket-data';

export interface AppNotification {
  id: number;
  title: string;
  body: string;
  tone: string;   // green | blue | purple | red | amber
  time: string;
  read: boolean;
}

export interface ActivityItem {
  kind: 'resolved' | 'escalated' | 'reopened' | 'kb';
  title: string;
  detail: string;
  time: string;
}

/**
 * Single source of truth for the standalone demo (no backend).
 *
 * Connects the previously-disconnected pieces:
 *  - the Knowledge Base is shared between the KB Manager and the chat
 *    classifier, so adding/editing an article changes how issues resolve;
 *  - feedback events (resolved / escalated / reopened) update session
 *    counters that drive the live Analytics dashboard;
 *  - notifications raised by any screen surface in the topbar bell.
 */
@Injectable({ providedIn: 'root' })
export class DemoStateService {
  // --- Queue (live, shared) --------------------------------------------
  queue: QueueTicket[] = QUEUE.map(t => ({ ...t }));

  // --- Queue helpers ------------------------------------------------------
  setTicketStatus(ticketId: string | undefined, status: 'approved' | 'escalated') {
    if (!ticketId) return;
    const t = this.queue.find(x => x.id === ticketId);
    if (t) t.status = status;
  }

  // --- Knowledge base (live, shared) ------------------------------------
  kb: KbEntry[] = KB.map(e => ({ ...e }));

  addKb(entry: KbEntry) { this.kb = [...this.kb, { ...entry }]; }
  updateKb(id: string, patch: Partial<KbEntry>) {
    const e = this.kb.find(x => x.id === id);
    if (e) Object.assign(e, patch);
  }
  deleteKb(id: string) { this.kb = this.kb.filter(x => x.id !== id); }
  flagKb(id: string) {
    if (!id) return;
    const e = this.kb.find(x => x.id === id);
    if (e) e.flagged = true;
  }
  incrementKbUses(id: string | undefined) {
    if (!id) return;
    const e = this.kb.find(x => x.id === id);
    if (e) e.uses++;
  }

  // --- Feedback counters (drive live analytics) -------------------------
  resolved = 0;
  escalated = 0;
  reopened = 0;
  private analyticsVersion = 0;
  activity$ = new BehaviorSubject<number>(0);
  private activityLog: ActivityItem[] = [];

  private bumpActivity() {
    this.activity$.next(++this.analyticsVersion);
  }

  private pushActivity(kind: ActivityItem['kind'], title: string, detail: string) {
    this.activityLog = [
      { kind, title, detail, time: 'just now' },
      ...this.activityLog,
    ].slice(0, 8);
  }

  recordResolved(ticketId?: string, kbId?: string) {
    this.resolved++;
    if (ticketId) this.setTicketStatus(ticketId, 'approved');
    if (kbId) this.incrementKbUses(kbId);
    this.pushActivity('resolved', 'Ticket resolved', ticketId ? `${ticketId} closed and routed back to the customer.` : 'Resolution recorded.');
    this.bumpActivity();
  }
  recordEscalated(ticketId?: string) {
    this.escalated++;
    if (ticketId) this.setTicketStatus(ticketId, 'escalated');
    this.pushActivity('escalated', 'Escalated to Eng', ticketId ? `${ticketId} moved to the engineering queue.` : 'Ticket moved to the engineering queue.');
    this.bumpActivity();
  }
  recordReopened(kbId?: string) {
    this.reopened++;
    if (kbId) this.flagKb(kbId);
    this.pushActivity('reopened', 'Marked still broken', kbId ? `${kbId} flagged for review.` : 'Customer reopened the issue.');
    this.bumpActivity();
  }

  // --- Notifications ----------------------------------------------------
  private _notifications: AppNotification[] = [];
  notifications$ = new BehaviorSubject<AppNotification[]>([]);
  private nid = 1;

  get notifications(): AppNotification[] { return this._notifications; }
  get unreadCount(): number { return this._notifications.filter(n => !n.read).length; }

  notify(title: string, body: string, tone = 'blue') {
    this._notifications = [
      { id: this.nid++, title, body, tone, time: 'just now', read: false },
      ...this._notifications,
    ];
    this.notifications$.next(this._notifications);
  }
  markAllRead() {
    this._notifications.forEach(n => n.read = true);
    this.notifications$.next(this._notifications);
  }
  clearNotifications() {
    this._notifications = [];
    this.notifications$.next(this._notifications);
  }

  // --- Live metrics -----------------------------------------------------
  // Start from a small historical base so the dashboard tells a coherent
  // story, then fold in this session's actions so resolving a ticket or
  // marking one "still broken" visibly moves the numbers.
  private readonly BASE_RESOLVED = 12;
  private readonly BASE_ESCALATED = 1;

  getMetrics(): Metric[] {
    const list = METRICS.map(m => ({ ...m }));

    const resolved = this.BASE_RESOLVED + this.resolved;
    const escalated = this.BASE_ESCALATED + this.escalated;
    const handled = resolved + escalated;
    const deflectionPct = handled > 0 ? Math.round((resolved / handled) * 100) : 0;
    const accuracyPct = (resolved + this.reopened) > 0
      ? Math.round((resolved / (resolved + this.reopened)) * 100) : 100;
    const avgHours = Math.max(0.8, 2.4 - resolved * 0.06 + this.reopened * 0.03).toFixed(1);
    const cost = Math.max(4.8, 11.6 - resolved * 0.12 + escalated * 0.05 + this.reopened * 0.08).toFixed(2);
    const ticketsPerRep = Math.max(14, Math.round(36 - resolved * 0.45 + escalated * 0.15 + this.reopened * 0.1));
    const autoClosed = Math.max(1, Math.round(resolved * 0.65 + escalated * 0.35));

    const deflection = list.find(m => m.k === 'Deflection rate');
    if (deflection) {
      deflection.now = deflectionPct + '%';
      deflection.pct = deflectionPct;
      deflection.sub = resolved + ' resolved · ' + escalated + ' escalated';
      deflection.delta = this.resolved || this.escalated ? 'live this session' : 'baseline';
    }

    const avgTime = list.find(m => m.k === 'Avg. time to resolution');
    if (avgTime) {
      avgTime.now = avgHours + ' hrs';
      avgTime.sub = 'derived from live resolution volume';
      avgTime.delta = this.resolved ? '−' + Math.max(1, Math.round(resolved * 0.08)) + ' min' : 'baseline';
    }

    const accuracy = list.find(m => m.k === 'AI resolution accuracy');
    if (accuracy) {
      accuracy.now = accuracyPct + '%';
      accuracy.pct = accuracyPct;
      accuracy.sub = this.reopened + ' reopened (still broken)';
      accuracy.good = this.reopened === 0;
      accuracy.delta = this.reopened ? '-' + this.reopened + ' reopen(s)' : '+4 pts';
    }

    const costPerTicket = list.find(m => m.k === 'Cost per ticket');
    if (costPerTicket) {
      costPerTicket.now = '$' + cost;
      costPerTicket.sub = 'calculated from live deflection and reopen rate';
      costPerTicket.delta = this.resolved ? '−$' + Math.max(2, Math.round(resolved * 0.35)) : 'baseline';
    }

    const ticketsRep = list.find(m => m.k === 'CS tickets / rep / week');
    if (ticketsRep) {
      ticketsRep.now = String(ticketsPerRep);
      ticketsRep.sub = 'derived from current workload and ticket mix';
      ticketsRep.delta = this.resolved ? '−' + Math.max(1, Math.round(resolved * 0.4)) : 'baseline';
    }

    const autoClosedMetric = list.find(m => m.k === 'Auto-closed (no human)');
    if (autoClosedMetric) {
      autoClosedMetric.now = String(autoClosed);
      autoClosedMetric.pct = undefined;
      autoClosedMetric.sub = 'auto-resolved this session';
      autoClosedMetric.delta = 'live';
    }

    return list;
  }

  get flaggedCount(): number { return this.kb.filter(k => k.flagged).length; }

  getActivityLog(): ActivityItem[] {
    return [...this.activityLog];
  }
}
