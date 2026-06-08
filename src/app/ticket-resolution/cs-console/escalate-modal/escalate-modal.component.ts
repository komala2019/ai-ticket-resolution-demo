import { Component, Input, Output, EventEmitter } from '@angular/core';
import { DemoStateService } from '../../demo-state.service';

@Component({
  selector: 'app-tr-escalate-modal',
  templateUrl: './escalate-modal.component.html',
  styleUrls: ['./escalate-modal.component.scss'],
})
export class EscalateModalComponent {
  @Input() ticket: any;
  @Output() close = new EventEmitter<void>();
  @Output() toastEvent = new EventEmitter<{ msg: string; tone: string }>();

  constructor(private demo: DemoStateService) {}

  teams = [
    { id: 'eng',     label: 'Engineering',   icon: 'code',    desc: 'Bug or platform defect' },
    { id: 'product', label: 'Product',        icon: 'layers',  desc: 'Feature gap or roadmap' },
    { id: 'account', label: 'Account Mgmt',   icon: 'users',   desc: 'Relationship / commercial' },
    { id: 'security',label: 'Security',       icon: 'shield',  desc: 'Vulnerability or data concern' },
  ];

  selectedTeam = 'eng';
  priority = 'high';
  note = '';
  submitted = false;

  submit() {
    this.submitted = true;
    const team = this.teams.find(t => t.id === this.selectedTeam)!;
    if (this.ticket) {
      this.ticket.status = 'escalated';
      // Feedback loop → analytics.
      this.demo.recordEscalated(this.ticket.id);
      this.demo.notify('Escalated to ' + team.label, (this.ticket.id || '') + ' · 4-hr ack SLA', 'purple');
    }
    this.toastEvent.emit({ msg: `Escalated to ${team.label} · 4-hr ack SLA`, tone: 'purple' });
    setTimeout(() => this.close.emit(), 1400);
  }
}
