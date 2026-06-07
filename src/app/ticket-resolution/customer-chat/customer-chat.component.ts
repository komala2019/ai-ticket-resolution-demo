import { Component, Input, OnChanges, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { SCENARIOS, SCENARIO_ORDER, TYPE_META, routeFor, Thresholds, ScenarioStep, Scenario } from '../ticket-data';
import { TicketResolutionApiService } from '../ticket-resolution-api.service';
import { buildDynamicScenario } from '../local-classifier';

type OutcomeKind = 'fixed' | 'notify' | 'failed' | null;

@Component({
  selector: 'app-tr-customer-chat',
  templateUrl: './customer-chat.component.html',
  styleUrls: ['./customer-chat.component.scss'],
})
export class CustomerChatComponent implements OnChanges, OnDestroy {
  @Input() thresholds!: Thresholds;
  @ViewChild('scrollEl') scrollEl!: ElementRef<HTMLElement>;

  SCENARIOS = SCENARIOS;
  SCENARIO_ORDER = SCENARIO_ORDER;
  TYPE_META = TYPE_META;
  routeFor = routeFor;

  constructor(private api: TicketResolutionApiService) {}

  sid = 'type3';
  n = 0;
  halted = false;
  outcome: OutcomeKind = null;

  /** Free-text the user types in the composer. */
  composerText = '';

  private timer: any;

  get scenario(): Scenario { return this.SCENARIOS[this.sid]; }

  /** User submitted their own issue → classify it client-side and play it. */
  onSend() {
    const text = this.composerText.trim();
    if (!text) return;
    this.composerText = '';
    const dynamic = buildDynamicScenario(text, this.thresholds);
    this.SCENARIOS = { ...this.SCENARIOS, __custom: dynamic };
    this.sid = '__custom';
    this.n = 0;
    this.halted = false;
    this.outcome = null;
    clearTimeout(this.timer);
    this.startPlayback();
  }
  get steps(): ScenarioStep[] { return this.scenario.steps; }
  get visible(): ScenarioStep[] { return this.steps.slice(0, this.n); }
  get classified(): boolean { return this.visible.some(s => s.kind === 'classify'); }
  get last(): ScenarioStep | null { return this.steps[this.n - 1] || null; }
  get pendingClarify(): boolean { return this.halted && !!this.last && this.last.kind === 'clarify'; }
  get pendingConfirm(): boolean { return this.halted && !this.outcome && !!this.last && this.last.kind === 'confirm'; }
  get done(): boolean { return !this.steps[this.n] || !!this.outcome; }

  ngOnChanges() { /* thresholds change — no reset needed */ }

  ngOnInit() {
    // Load scenarios from the backend; fall back to bundled data if offline.
    this.api.getScenarios().subscribe(res => {
      if (res && res.map && Object.keys(res.map).length) {
        this.SCENARIOS = res.map;
        this.SCENARIO_ORDER = res.order;
        if (!this.SCENARIOS[this.sid]) this.sid = this.SCENARIO_ORDER[0];
      }
      this.startPlayback();
    });
  }

  selectScenario(id: string) {
    this.sid = id;
    this.n = 0;
    this.halted = false;
    this.outcome = null;
    clearTimeout(this.timer);
    this.startPlayback();
  }

  replay() { this.selectScenario(this.sid); }

  private startPlayback() {
    clearTimeout(this.timer);
    this.tick();
  }

  private tick() {
    if (this.halted || this.outcome) return;
    const step = this.steps[this.n];
    if (!step) return;
    const delay = step.kind === 'thinking' ? 1500 : step.from === 'user' ? 600 : step.kind === 'classify' ? 550 : 850;
    this.timer = setTimeout(() => {
      this.n++;
      if (step.kind === 'clarify' || step.kind === 'confirm') { this.halted = true; }
      setTimeout(() => this.scrollToBottom(), 50);
      if (!this.halted) this.tick();
    }, delay);
  }

  onChip() {
    this.halted = false;
    this.tick();
  }

  onYes() { this.outcome = this.scenario.type === 2 ? 'notify' : 'fixed'; setTimeout(() => this.scrollToBottom(), 50); }
  onNo()  { this.outcome = 'failed'; setTimeout(() => this.scrollToBottom(), 50); }

  private scrollToBottom() {
    const el = this.scrollEl?.nativeElement;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }

  statusLabel(): string {
    if (!this.classified) return 'Awaiting details';
    if (this.outcome === 'fixed')  return 'Resolved';
    if (this.outcome === 'failed') return 'Escalated';
    if (this.outcome === 'notify') return 'Workaround sent';
    if (this.scenario.type === 1) return 'Escalated to Eng';
    return 'In progress';
  }

  statusColor(): string {
    if (this.outcome === 'fixed') return 'var(--success-600)';
    if (this.outcome === 'failed' || this.scenario.type === 1) return 'var(--purple-500, #7A5AF8)';
    return 'var(--primary-600)';
  }

  outcomeData(kind: string) {
    const map: Record<string, any> = {
      fixed:  { icon: 'check', color: 'var(--success-600)', soft: 'var(--success-50)', title: 'Resolved — ticket auto-closed',    body: 'Glad that worked. This resolution and your confirmation were added to the knowledge base to make the next match faster.', stats: [['47 sec','Time to resolve'],['0','Human touches'],['Auto','Closure path']] },
      notify: { icon: 'mail',  color: 'var(--primary-600)', soft: 'var(--primary-50)', title: "You're subscribed to updates",      body: `We'll email you the moment the permanent fix ships. Your workaround keeps you unblocked until then.`, stats: [['1.6 min','Time to workaround'],[this.scenario.jira||'—','Linked fix'],['Live','Status tracking']] },
      failed: { icon: 'alert', color: 'var(--warning-600)', soft: 'var(--warning-50)', title: 'Reopened and escalated',           body: "Sorry that didn't do it. I've reopened the ticket and routed it to a specialist with the full conversation attached.", stats: [['TCK-2099','Ticket'],['< 30 min','Review SLA'],['Specialist','Now owns it']] },
    };
    return map[kind] || map['fixed'];
  }

  ticketId(): string {
    if (!this.classified) return '—';
    return this.scenario.type === 1 ? 'TCK-2048' : '#' + (5400 + this.scenario.type);
  }

  ngOnDestroy() { clearTimeout(this.timer); }
}
