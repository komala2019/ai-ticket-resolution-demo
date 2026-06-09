import { Component, OnDestroy, OnInit } from '@angular/core';
import { ROUTE_META, QUEUE, Thresholds, routeFor } from './ticket-data';
import { DemoStateService } from './demo-state.service';
import { Subscription } from 'rxjs';

export interface ToastState { msg: string; tone: string; }

@Component({
  selector: 'app-ticket-resolution',
  templateUrl: './ticket-resolution.component.html',
  styleUrls: ['./ticket-resolution.component.scss'],
})
export class TicketResolutionComponent implements OnInit, OnDestroy {
  view: 'customer' | 'console' | 'readme' | 'architecture' = 'customer';
  tab: 'queue' | 'kb' | 'analytics' | 'golden' = 'queue';
  selectedTicket: any = null;
  escalatingTicket: any = null;
  toast: ToastState | null = null;
  private toastTimer: any;
  showNotificationsDropdown = false;

  thresholds: Thresholds = { auto: 90, approve: 70, rewrite: 40 };

  ROUTE_META = ROUTE_META;
  private subs: Subscription[] = [];

  constructor(public demo: DemoStateService) {}

  ngOnInit() {
    // Sync queue metadata with the component's starting thresholds (service inits with DEFAULT_THRESHOLDS).
    this.demo.rehydrateQueue(this.thresholds);
    this.subs.push(
      this.demo.viewState$.subscribe(v => {
        if (v) this.view = v;
      }),
      this.demo.tabState$.subscribe(t => {
        if (t) this.tab = t;
      })
    );
  }

  toggleNotifications() {
    this.showNotificationsDropdown = !this.showNotificationsDropdown;
  }

  handleNotificationClick(n: any) {
    n.read = true;
    this.showNotificationsDropdown = false;
    
    // Check if body or title mentions a ticket ID (TCK-XXXX or #XXXX)
    const match = n.body.match(/TCK-\d+/) || n.title.match(/TCK-\d+/) || n.body.match(/#\d+/) || n.title.match(/#\d+/);
    if (match) {
      const ticketId = match[0].replace('#', 'TCK-'); // normalize
      // Try to find the ticket. We can search in demo.queue.
      // E.g., if ticketId is TCK-2041
      const ticket = this.demo.queue.find(t => t.id === ticketId || t.id.replace('TCK-', '#') === match[0]);
      if (ticket) {
        this.view = 'console';
        this.tab = 'queue';
        this.selectedTicket = ticket;
        return;
      }
    }

    if (n.title.toLowerCase().includes('knowledge') || n.body.toLowerCase().includes('kb') || n.title.toLowerCase().includes('article')) {
      this.view = 'console';
      this.tab = 'kb';
      return;
    }
  }

  get queueCounts() {
    const counts: Record<string, number> = { auto: 0, approve: 0, rewrite: 0, eng: 0 };
    this.demo.queue.forEach(t => {
      if (!t.status) {
        counts[routeFor(t.confidence, this.thresholds)]++;
      }
    });
    return counts;
  }

  switchView(v: 'customer' | 'console' | 'readme' | 'architecture') {
    this.view = v;
    this.selectedTicket = null;
  }

  get isDocs(): boolean {
    return this.view === 'readme' || this.view === 'architecture';
  }

  switchTab(t: 'queue' | 'kb' | 'analytics' | 'golden') {
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
    this.demo.rehydrateQueue(this.thresholds);
  }

  resetThresholds() {
    this.thresholds = { auto: 90, approve: 70, rewrite: 40 };
    this.demo.rehydrateQueue(this.thresholds);
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
    this.subs.forEach(s => s.unsubscribe());
  }
}
