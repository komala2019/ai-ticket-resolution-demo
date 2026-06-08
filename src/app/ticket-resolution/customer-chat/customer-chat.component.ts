import { Component, Input, OnChanges, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { Subscription } from 'rxjs';
import { SCENARIOS, SCENARIO_ORDER, TYPE_META, routeFor, Thresholds, ScenarioStep, Scenario, QueueTicket } from '../ticket-data';
import { TicketResolutionApiService } from '../ticket-resolution-api.service';
import { buildDynamicScenario, classifyIssue } from '../local-classifier';
import { DemoStateService } from '../demo-state.service';

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

  constructor(private api: TicketResolutionApiService, public demo: DemoStateService) {}

  sid = 'custom';
  n = 0;
  halted = false;
  outcome: OutcomeKind = null;

  /** Free-text the user types in the composer. */
  composerText = '';
  /** Pending media attachment (image/video) staged in the composer. */
  pendingAttachment: { name: string; url: string; kind: 'image' | 'video' } | null = null;
  /** Set once the user asks for a human and an agent "joins". */
  agentJoined = false;
  /** Ticket ID generated for custom (free-text) issues. */
  customTicketId: string | null = null;
  /** Live backend answer from the assistant route when the user submits a custom issue. */
  liveAnswer: string | null = null;

  private timer: any;
  private sub?: Subscription;

  get scenario(): Scenario { return this.SCENARIOS[this.sid]; }

  /** User submitted their own issue → classify it client-side and play it. */
  onSend() {
    const text = this.composerText.trim();
    if (!text && !this.pendingAttachment) return;
    const attachment = this.pendingAttachment || undefined;
    this.composerText = '';
    this.pendingAttachment = null;

    const msg = text || 'Please take a look at the attached file.';
    const dynamic = buildDynamicScenario(msg, this.demo.kb, this.thresholds);
    if (attachment && dynamic.steps[0]) dynamic.steps[0].attachment = attachment;

    // Create a real queue ticket so the issue shows up in CS Console.
    const result = classifyIssue(msg, this.demo.kb, this.thresholds);
    const maxId = Math.max(...this.demo.queue.map(t => parseInt(t.id.replace('TCK-', ''), 10) || 0), 2050);
    const ticketId = 'TCK-' + (maxId + 1);
    this.customTicketId = ticketId;

    const queueTicket: QueueTicket = {
      id: ticketId,
      confidence: dynamic.confidence,
      type: dynamic.type,
      priority: dynamic.priority,
      area: dynamic.productArea,
      customer: 'You (Demo User)',
      company: 'Demo Session',
      age: 'just now',
      subject: msg.length > 80 ? msg.slice(0, 77) + '…' : msg,
      draft: result.intro + (result.steps.length ? '\n' + result.steps.join('\n') : ''),
      evidence: result.evidence,
      reopen: 0,
      novel: dynamic.type === 1,
    };
    this.demo.queue = [...this.demo.queue, queueTicket];
    this.demo.notify(
      'New ticket created',
      ticketId + ' · ' + dynamic.productArea + ' · ' + dynamic.confidence + '% confidence',
      dynamic.type === 1 ? 'purple' : 'blue',
    );

    this.SCENARIOS = { ...this.SCENARIOS, __custom: dynamic };
    this.sid = '__custom';
    this.n = 0;
    this.halted = false;
    this.outcome = null;
    this.agentJoined = false;
    this.liveAnswer = null;
    clearTimeout(this.timer);

    this.api.chat(msg).subscribe(response => {
      if (response?.answer) {
        this.liveAnswer = response.answer;
      }
    });

    this.startPlayback();
  }

  /** Composer file picker → stage an image/video preview. */
  onAttach(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files && input.files[0];
    if (!file) return;
    const kind: 'image' | 'video' = file.type.startsWith('video') ? 'video' : 'image';
    this.pendingAttachment = { name: file.name, url: URL.createObjectURL(file), kind };
    input.value = '';
  }
  clearAttachment() { this.pendingAttachment = null; }

  /** "Talk to a human" — simulate a live agent joining the conversation. */
  requestAgent() {
    if (this.agentJoined) return;
    this.agentJoined = true;
    const dyn: Scenario = this.SCENARIOS['__custom'] && this.sid === '__custom'
      ? this.SCENARIOS['__custom']
      : JSON.parse(JSON.stringify(this.scenario));
    dyn.id = '__custom';
    dyn.steps = [
      ...dyn.steps.slice(0, this.n),
      { from: 'ai', agent: true, text: "You're connected to Maya, a support specialist. She can see this whole conversation — no need to repeat anything." },
    ];
    this.SCENARIOS = { ...this.SCENARIOS, __custom: dyn };
    this.sid = '__custom';
    this.n = dyn.steps.length;
    this.halted = true;
    this.demo.notify('Agent joined', 'A support specialist took over the conversation.', 'blue');
    setTimeout(() => this.scrollToBottom(), 50);
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
    this.sub = this.api.getScenarios().subscribe(res => {
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
    this.customTicketId = null;
    clearTimeout(this.timer);

    const ticketId = this.scenario.ticketId;
    if (ticketId) {
      const t = this.demo.queue.find(x => x.id === ticketId);
      if (t) {
        t.status = undefined;
      }
    }

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

      const currentStep = this.steps[this.n - 1];
      if (currentStep && currentStep.kind === 'status') {
        const tid = this.customTicketId || this.scenario.ticketId;
        if (tid) {
          const t = this.demo.queue.find(x => x.id === tid);
          if (t && t.status !== 'escalated') {
            this.demo.recordEscalated(tid);
          }
        }
      }

      if (step.kind === 'clarify' || step.kind === 'confirm') { this.halted = true; }
      setTimeout(() => this.scrollToBottom(), 50);
      if (!this.halted) this.tick();
    }, delay);
  }

  onChip() {
    this.halted = false;
    this.tick();
  }

  onYes() {
    this.outcome = this.scenario.type === 2 ? 'notify' : 'fixed';
    // Feedback loop: a confirmed fix counts as a resolution in the dashboard,
    // marks the queue ticket as approved, and increments the KB article's uses.
    const tid = this.customTicketId || this.scenario.ticketId;
    this.demo.recordResolved(tid, this.scenario.kbId);
    if (this.outcome === 'notify') {
      this.demo.notify('Subscribed to updates', "We'll notify you when the permanent fix ships.", 'blue');
      // Simulate the fix shipping a moment later (the "notify me" payoff).
      setTimeout(() => this.demo.notify('Fix shipped 🎉', 'The permanent fix for your issue is now live.', 'green'), 6000);
    } else {
      this.demo.notify('Ticket resolved', 'Your issue was resolved and auto-closed.', 'green');
    }
    setTimeout(() => this.scrollToBottom(), 50);
  }
  onNo() {
    this.outcome = 'failed';
    // Feedback loop: "still broken" reopens, flags the matched KB entry, and
    // dents AI accuracy in the dashboard.
    this.demo.recordReopened(this.scenario.kbId);
    this.demo.notify('Ticket reopened', 'Marked as still broken — re-routed to a specialist; KB entry flagged.', 'red');
    setTimeout(() => this.scrollToBottom(), 50);
  }

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
    const tid = this.ticketId();
    const map: Record<string, any> = {
      fixed:  { icon: 'check', color: 'var(--success-600)', soft: 'var(--success-50)', title: 'Resolved — ticket auto-closed',    body: 'Glad that worked. This resolution and your confirmation were added to the knowledge base to make the next match faster.', stats: [['47 sec','Time to resolve'],['0','Human touches'],['Auto','Closure path']] },
      notify: { icon: 'mail',  color: 'var(--primary-600)', soft: 'var(--primary-50)', title: "You're subscribed to updates",      body: `We'll email you the moment the permanent fix ships. Your workaround keeps you unblocked until then.`, stats: [['1.6 min','Time to workaround'],[this.scenario.jira||'—','Linked fix'],['Live','Status tracking']] },
      failed: { icon: 'alert', color: 'var(--warning-600)', soft: 'var(--warning-50)', title: 'Reopened and escalated',           body: "Sorry that didn't do it. I've reopened the ticket and routed it to a specialist with the full conversation attached.", stats: [[tid,'Ticket'],['< 30 min','Review SLA'],['Specialist','Now owns it']] },
    };
    return map[kind] || map['fixed'];
  }

  ticketId(): string {
    if (!this.classified) return '—';
    if (this.customTicketId) return this.customTicketId;
    return this.scenario.ticketId || ('#' + (5400 + this.scenario.type));
  }

  ngOnDestroy() {
    clearTimeout(this.timer);
    if (this.sub) {
      this.sub.unsubscribe();
    }
  }
}
