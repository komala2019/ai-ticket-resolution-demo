import { Component, Input, Output, EventEmitter } from '@angular/core';
import { ROUTE_META, routeFor, Thresholds, RouteKey } from '../../ticket-data';
import { DemoStateService } from '../../demo-state.service';

@Component({
  selector: 'app-tr-approval-queue',
  templateUrl: './approval-queue.component.html',
  styleUrls: ['./approval-queue.component.scss'],
})
export class ApprovalQueueComponent {
  @Input() thresholds!: Thresholds;
  @Output() openTicket = new EventEmitter<any>();

  ROUTE_META = ROUTE_META;
  routeFor = routeFor;
  filter: RouteKey | null = null;

  constructor(public demo: DemoStateService) {}

  /** Live getter — always reads the current shared queue from DemoStateService. */
  get queue() { return this.demo.queue; }

  get sortedQueue() {
    return [...this.queue]
      .filter(t => !t.status)
      .sort((a, b) => b.confidence - a.confidence)
      .filter(t => !this.filter || routeFor(t.confidence, this.thresholds) === this.filter);
  }

  get routeOrder(): RouteKey[] { return ['auto', 'approve', 'rewrite', 'eng']; }

  countFor(r: RouteKey) {
    return this.queue.filter(t => !t.status && routeFor(t.confidence, this.thresholds) === r).length;
  }

  toggleFilter(r: RouteKey) {
    this.filter = this.filter === r ? null : r;
  }

  initials(name: string) {
    return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  }

  routeOf(t: any): RouteKey { return routeFor(t.confidence, this.thresholds); }
}
