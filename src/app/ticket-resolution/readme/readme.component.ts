import { Component } from '@angular/core';
import { TYPE_META, METRICS, Metric } from '../ticket-data';

interface Capability { type: number; route: string; routeHex: string; }
interface FlowStep { n: number; title: string; text: string; }
interface CompRow { name: string; selector: string; role: string; }

@Component({
  selector: 'app-tr-readme',
  templateUrl: './readme.component.html',
  styleUrls: ['./readme.component.scss'],
})
export class ReadmeComponent {
  TYPE_META = TYPE_META;
  metrics: Metric[] = METRICS;

  capabilities: Capability[] = [
    { type: 3, route: 'Auto-resolve in chat', routeHex: 'var(--success-600)' },
    { type: 2, route: 'Workaround + ETA',     routeHex: 'var(--warning-600)' },
    { type: 1, route: 'Escalate to Eng',      routeHex: 'var(--purple-500)' },
  ];

  flow: FlowStep[] = [
    { n: 1, title: 'Describe',  text: 'The customer states the problem in plain language — no forms, no ticket fields.' },
    { n: 2, title: 'Clarify',   text: 'The assistant asks one or two targeted questions to disambiguate the issue.' },
    { n: 3, title: 'Classify',  text: 'A confidence score is computed and the ticket is typed (1–3) against the KB and 1,240 past tickets.' },
    { n: 4, title: 'Route',     text: 'The score is bucketed by live thresholds into Auto-resolve, CS approval, CS rewrite, or Eng queue.' },
    { n: 5, title: 'Resolve',   text: 'AI self-serves, sends a workaround, or packages a full escalation — always with a status, never a black hole.' },
    { n: 6, title: 'Confirm',   text: 'The ticket stays open until the customer confirms the fix worked. Every closure feeds the learning flywheel.' },
  ];

  components: CompRow[] = [
    { name: 'TicketResolutionComponent', selector: 'app-ticket-resolution',   role: 'Shell — perspective switcher, sub-nav, threshold tweaks, toast host.' },
    { name: 'CustomerChatComponent',     selector: 'app-tr-customer-chat',     role: 'Customer-facing conversational resolution flow with scenarios.' },
    { name: 'ApprovalQueueComponent',    selector: 'app-tr-approval-queue',    role: 'CS console — live queue of drafted resolutions awaiting review.' },
    { name: 'TicketDetailComponent',     selector: 'app-tr-ticket-detail',     role: 'Single-ticket review with AI draft, evidence, and actions.' },
    { name: 'KbManagerComponent',        selector: 'app-tr-kb-manager',        role: 'Knowledge-base entries that power AI matching.' },
    { name: 'AnalyticsComponent',        selector: 'app-tr-analytics',         role: 'Impact metrics, deflection trend, ticket mix, learning flywheel.' },
    { name: 'EscalateModalComponent',    selector: 'app-tr-escalate-modal',    role: 'Packages full context and routes a ticket to engineering.' },
    { name: 'ConfidenceGaugeComponent',  selector: 'app-tr-confidence-gauge',  role: 'Shared — radial gauge of classification confidence.' },
    { name: 'ThresholdBarComponent',     selector: 'app-tr-threshold-bar',     role: 'Shared — banded bar visualising routing thresholds.' },
    { name: 'Chips (type/route/priority)', selector: 'app-tr-*-chip',          role: 'Shared — semantic labels for ticket type, route, and priority.' },
  ];

  routes = [
    { path: '/ticket-resolution',           desc: 'Customer chat (default view)' },
    { path: 'CS console → Approval queue',  desc: 'Reps review & approve AI drafts' },
    { path: 'CS console → Knowledge base',  desc: 'Curate the entries AI matches against' },
    { path: 'CS console → Analytics',       desc: 'Track deflection, accuracy & cost' },
  ];
}
