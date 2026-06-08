import { Component, Input, Output, EventEmitter, OnChanges } from '@angular/core';
import { TYPE_META, ROUTE_META, routeFor, Thresholds } from '../../ticket-data';
import { DemoStateService } from '../../demo-state.service';

@Component({
  selector: 'app-tr-ticket-detail',
  templateUrl: './ticket-detail.component.html',
  styleUrls: ['./ticket-detail.component.scss'],
})
export class TicketDetailComponent implements OnChanges {
  @Input() ticket: any;
  @Input() thresholds!: Thresholds;
  @Output() back = new EventEmitter<void>();
  @Output() escalate = new EventEmitter<any>();
  @Output() toastEvent = new EventEmitter<{ msg: string; tone: string }>();

  TYPE_META = TYPE_META;
  ROUTE_META = ROUTE_META;
  routeFor = routeFor;

  constructor(private demo: DemoStateService) {}

  editing = false;
  draft = '';
  status: 'approved' | 'escalated' | null = null;
  learnFromResponse = false;

  ngOnChanges() {
    this.draft = this.ticket?.draft ?? '';
    this.editing = false;
    this.status = null;
    this.learnFromResponse = false;
  }

  get route() { return routeFor(this.ticket.confidence, this.thresholds); }
  get meta()  { return ROUTE_META[this.route]; }
  get typeMeta() { return TYPE_META[this.ticket.type]; }

  approve() {
    this.status = 'approved';
    if (this.ticket) this.ticket.status = 'approved';
    // Feedback loop → analytics: an approval counts as a resolution.
    this.demo.recordResolved(this.ticket?.id);

    if (this.learnFromResponse) {
      // Auto-train the AI by creating a KB article
      const entryId = 'KB-Cust-' + String(this.demo.kb.length + 1).padStart(3, '0');
      const entry = {
        id: entryId,
        title: this.ticket.subject,
        content: this.draft,
        tags: [this.ticket.area.toLowerCase()],
        uses: 1,
        updated: 'just now',
      };
      this.demo.addKb(entry);
      this.demo.notify(
        'AI auto-trained 🧠',
        `Created KB article "${this.ticket.subject}" from resolution edits to automate future tickets.`,
        'green'
      );
      this.toastEvent.emit({ msg: 'AI successfully trained on this resolution!', tone: 'green' });
    } else {
      this.demo.notify('Response approved', 'Sent to ' + this.ticket.customer.split(' ')[0] + ' · ' + this.ticket.id, 'green');
      this.toastEvent.emit({ msg: 'Response approved and sent to ' + this.ticket.customer.split(' ')[0], tone: 'green' });
    }
  }

  saveEdit() {
    this.editing = false;
    this.toastEvent.emit({ msg: 'Draft updated — captured as preference data', tone: 'blue' });
  }

  cancelEdit() {
    this.editing = false;
    this.draft = this.ticket.draft;
  }

  doEscalate() {
    if (this.ticket.novel) {
      // Novel tickets open the escalate modal (which persists on confirm).
      this.escalate.emit(this.ticket);
    } else {
      this.status = 'escalated';
      this.ticket.status = 'escalated';
      this.demo.recordEscalated(this.ticket.id);
      this.demo.notify('Escalated to Engineering', this.ticket.id + ' routed with full context · 4-hr SLA', 'purple');
      this.toastEvent.emit({ msg: 'Escalated to Eng with full context', tone: 'purple' });
    }
  }

  initials(name: string) {
    return name.split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase();
  }

  evidenceColor(m: number) {
    if (m >= 75) return 'var(--success-500)';
    if (m >= 50) return 'var(--warning-500)';
    return 'var(--gray-300)';
  }

  customerQuote(): string {
    const q: Record<string, string> = {
      'TCK-2041': 'My booking widget disappeared from my homepage after I published a new hero.',
      'TCK-2044': 'The analytics dashboard is completely blank — charts never load.',
      'TCK-2046': 'A scheduled campaign went out twice to the same segment.',
      'TCK-2047': 'Checkout is showing the wrong currency for one of my rate plans.',
      'TCK-2048': "Our Salesforce lead sync stopped right after your latest update — this is business-critical.",
      'TCK-2050': "I can't invite a teammate, the invite button is greyed out.",
    };
    return q[this.ticket.id] || this.ticket.description || this.ticket.subject;
  }
}
