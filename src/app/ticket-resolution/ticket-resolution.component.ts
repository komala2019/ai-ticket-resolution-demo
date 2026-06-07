import { Component, OnDestroy } from '@angular/core';
import { ROUTE_META, QUEUE, Thresholds, routeFor } from './ticket-data';

export interface ToastState { msg: string; tone: string; }

@Component({
  selector: 'app-ticket-resolution',
  templateUrl: './ticket-resolution.component.html',
  styleUrls: ['./ticket-resolution.component.scss'],
})
export class TicketResolutionComponent implements OnDestroy {
  view: 'customer' | 'console' | 'readme' | 'architecture' = 'customer';
  tab: 'queue' | 'kb' | 'analytics' = 'queue';
  selectedTicket: any = null;
  escalatingTicket: any = null;
  toast: ToastState | null = null;
  private toastTimer: any;

  thresholds: Thresholds = { auto: 90, approve: 75, rewrite: 50 };

  ROUTE_META = ROUTE_META;

  get queueCounts() {
    const counts: Record<string, number> = { auto: 0, approve: 0, rewrite: 0, eng: 0 };
    QUEUE.forEach(t => counts[routeFor(t.confidence, this.thresholds)]++);
    return counts;
  }

  switchView(v: 'customer' | 'console' | 'readme' | 'architecture') {
    this.view = v;
    this.selectedTicket = null;
  }

  get isDocs(): boolean {
    return this.view === 'readme' || this.view === 'architecture';
  }

  switchTab(t: 'queue' | 'kb' | 'analytics') {
    this.tab = t;
  }

  openTicket(ticket: any) {
    this.selectedTicket = ticket;
    window.scrollTo({ top: 0 });
  }

  closeTicket() {
    this.selectedTicket = null;
  }

  setEscalating(ticket: any) {
    this.escalatingTicket = ticket;
  }

  closeEscalating() {
    this.escalatingTicket = null;
  }

  showToast(msg: string, tone: string) {
    this.toast = { msg, tone };
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { this.toast = null; }, 2600);
  }

  onThresholdChange(key: keyof Thresholds, val: number) {
    const t = { ...this.thresholds, [key]: val };
    if (key === 'auto')    t.auto    = Math.max(val, t.approve + 5);
    if (key === 'approve') { t.approve = Math.max(t.rewrite + 5, Math.min(val, t.auto - 5)); }
    if (key === 'rewrite') t.rewrite = Math.min(val, t.approve - 5);
    t.approve = Math.min(t.approve, t.auto - 5);
    t.rewrite = Math.min(t.rewrite, t.approve - 5);
    this.thresholds = t;
  }

  resetThresholds() {
    this.thresholds = { auto: 90, approve: 75, rewrite: 50 };
  }

  get toastIcon() {
    const m: Record<string, string> = { green: 'check-circle', blue: 'sparkle', purple: 'share-07' };
    return m[this.toast?.tone ?? ''] ?? 'check';
  }

  get toastColor() {
    const m: Record<string, string> = { green: 'var(--success-600)', blue: 'var(--primary-600)', purple: '#7A5AF8' };
    return m[this.toast?.tone ?? ''] ?? 'var(--gray-300)';
  }

  ngOnDestroy() {
    clearTimeout(this.toastTimer);
  }
}
