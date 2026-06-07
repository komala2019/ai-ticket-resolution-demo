import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { QUEUE, ROUTE_META, routeFor, Thresholds, RouteKey } from '../../ticket-data';
import { TicketResolutionApiService } from '../../ticket-resolution-api.service';

@Component({
  selector: 'app-tr-approval-queue',
  templateUrl: './approval-queue.component.html',
  styleUrls: ['./approval-queue.component.scss'],
})
export class ApprovalQueueComponent implements OnInit {
  @Input() thresholds!: Thresholds;
  @Output() openTicket = new EventEmitter<any>();

  ROUTE_META = ROUTE_META;
  routeFor = routeFor;
  filter: RouteKey | null = null;

  /** Loaded from the backend (falls back to the static QUEUE if offline). */
  queue: any[] = QUEUE.map(t => ({ ...t }));

  constructor(private api: TicketResolutionApiService) {}

  ngOnInit() {
    this.api.getQueue().subscribe(q => { if (q && q.length) this.queue = q; });
  }

  get sortedQueue() {
    return [...this.queue]
      .sort((a, b) => b.confidence - a.confidence)
      .filter(t => !this.filter || routeFor(t.confidence, this.thresholds) === this.filter);
  }

  get routeOrder(): RouteKey[] { return ['auto', 'approve', 'rewrite', 'eng']; }

  countFor(r: RouteKey) {
    return this.queue.filter(t => routeFor(t.confidence, this.thresholds) === r).length;
  }

  toggleFilter(r: RouteKey) {
    this.filter = this.filter === r ? null : r;
  }

  initials(name: string) {
    return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  }

  routeOf(t: any): RouteKey { return routeFor(t.confidence, this.thresholds); }
}
