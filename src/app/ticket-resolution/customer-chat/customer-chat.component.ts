import { Component, Input, OnChanges, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { Subscription } from 'rxjs';
import { SCENARIOS, SCENARIO_ORDER, TYPE_META, routeFor, Thresholds, ScenarioStep, Scenario, QueueTicket } from '../ticket-data';
import { TicketResolutionApiService } from '../ticket-resolution-api.service';
import { buildDynamicScenario, classifyIssue, isBugIntent } from '../local-classifier';
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
  rephraseCount = 0;
  n = 0;
  halted = false;
  outcome: OutcomeKind = null;

  // Ticket Form State
  formSubject = '';
  formArea = '';
  formPriority = 'P3';
  formDesc = '';
  formAttachment: { name: string; url: string; kind: 'image' | 'video' } | null = null;
  formSubmitted = false;

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

  onSend() {
    const text = this.composerText.trim();
    if (!text && !this.pendingAttachment) return;
    const attachment = this.pendingAttachment || undefined;
    this.composerText = '';
    this.pendingAttachment = null;

    const msg = text || 'Please take a look at the attached file.';

    let currentSteps: ScenarioStep[] = [];
    if (this.sid === '__custom' && this.SCENARIOS['__custom']) {
      currentSteps = this.SCENARIOS['__custom'].steps.slice(0, this.n);
    } else {
      currentSteps = this.scenario.steps.slice(0, this.n);
    }

    // Filter out thinking, confirm, and ticket-form steps from history
    currentSteps = currentSteps.filter(s => s.kind !== 'thinking' && s.kind !== 'confirm' && s.kind !== 'ticket-form');

    const userStep: ScenarioStep = { from: 'user', text: msg };
    if (attachment) userStep.attachment = attachment;

    // Check if the intent is a potential bug or just plain language
    const isBug = isBugIntent(msg, this.demo.kb);

    const thinkingStep: ScenarioStep = {
      from: 'ai',
      kind: 'thinking',
      text: isBug ? 'Consulting Knowledge Base...' : 'Formulating response...'
    };
    currentSteps.push(userStep, thinkingStep);

    const customScenario: Scenario = {
      id: '__custom',
      label: 'Your issue',
      type: 3,
      confidence: isBug ? 90 : 0,
      productArea: 'General',
      priority: 'P3',
      summary: msg,
      steps: currentSteps
    };

    this.SCENARIOS = { ...this.SCENARIOS, __custom: customScenario };
    this.sid = '__custom';
    this.n = currentSteps.length;
    this.halted = true;
    this.outcome = null;
    this.agentJoined = false;
    this.liveAnswer = null;
    clearTimeout(this.timer);
    setTimeout(() => this.scrollToBottom(), 50);

    this.api.chat(msg).subscribe(response => {
      const stepsList = this.SCENARIOS['__custom'].steps;
      const thinkIdx = stepsList.findIndex(s => s.kind === 'thinking');

      const isOffline = !response.ok || response.model === 'demo-fallback';

      let aiStepText = response.answer || 'No reply returned.';

      if (isOffline) {
        if (!isBug) {
          // Select from a pool of friendly, guiding replies to avoid repeated static text
          const greetings = [
            "Hello! I am your support copilot. I am currently operating in local mode. If you are experiencing a product issue (e.g., Booking Engine widget missing, Analytics charts blank, or Salesforce Lead Sync issues), please describe it in detail so I can retrieve the solution for you.",
            "Hi there! As your support assistant, I am here to help you resolve technical bugs locally. If you have an issue related to Analytics, Email segments, Salesforce integration, or Account settings, please describe the problem here.",
            "Welcome! If you have any questions or product bugs to report (such as invite button issues or campaign duplicates), please describe your issue. I can query our knowledge base locally and guide you to a resolution!"
          ];
          const randIdx = Math.floor(Math.random() * greetings.length);
          aiStepText = greetings[randIdx];
        } else {
          // Use client-side classification to construct a real local answer
          const localResult = classifyIssue(msg, this.demo.kb, this.thresholds);
          if (localResult.type === 1) {
            aiStepText = "I couldn't find a confident match for this issue in our local knowledge base. I recommend opening a support ticket below so we can escalate this to the engineering team.";
          } else if (localResult.type === 2) {
            aiStepText = "This matches a known issue: \"" + localResult.headline + "\". Workaround:\n" + localResult.intro;
          } else {
            aiStepText = "Here is the recommended solution for \"" + localResult.headline + "\":\n" + localResult.intro;
          }
        }
      }

      const aiStep: ScenarioStep = {
        from: 'ai',
        text: aiStepText
      };

      if (!isBug) {
        // For general chit-chat: just display the AI's reply bubble without classification or thumbs
        if (thinkIdx !== -1) {
          stepsList[thinkIdx] = aiStep;
        } else {
          stepsList.push(aiStep);
        }
        this.n = stepsList.length;
        this.halted = false; // Allow user to reply immediately
      } else {
        // For bug reports: show classification card and direct thumbs/ticket actions
        const classifyStep: ScenarioStep = {
          from: 'ai',
          kind: 'classify'
        };

        if (thinkIdx !== -1) {
          stepsList[thinkIdx] = classifyStep;
          stepsList.splice(thinkIdx + 1, 0, aiStep);
        } else {
          stepsList.push(classifyStep, aiStep);
        }

        let score = response.confidence ?? 0;
        let route = response.route || 'fallback';
        let type = 3;
        let area = 'General';
        let kbId: string | undefined = undefined;

        if (isOffline) {
          const localResult = classifyIssue(msg, this.demo.kb, this.thresholds);
          score = localResult.confidence;
          route = localResult.route;
          type = localResult.type;
          area = localResult.productArea;
          kbId = localResult.bestKb ? localResult.bestKb.id : undefined;
        } else {
          if (route.includes('escalate') || score < this.thresholds.rewrite) {
            type = 1;
          } else if (score < this.thresholds.auto) {
            type = 2;
          }

          if (response.context && response.context.length > 0) {
            const topHit = response.context[0];
            kbId = topHit.id;
            if (topHit.tags && topHit.tags.length > 0) {
              area = topHit.tags[0];
            }
          }
        }

        const priority = type === 1 ? 'P1' : (type === 2 ? 'P2' : 'P3');

        this.SCENARIOS['__custom'].type = type;
        this.SCENARIOS['__custom'].confidence = score;
        this.SCENARIOS['__custom'].productArea = area;
        this.SCENARIOS['__custom'].priority = priority;
        this.SCENARIOS['__custom'].kbId = kbId;

        this.n = stepsList.length;
        this.halted = false;

        if (type === 1) {
          this.formSubject = msg.length > 80 ? msg.slice(0, 77) + '…' : msg;
          this.formArea = area;
          this.formPriority = priority;
          this.formDesc = msg;
          this.formAttachment = attachment || null;
          this.formSubmitted = false;

          stepsList.push({ from: 'ai', kind: 'ticket-form' });
          this.n = stepsList.length;
          this.halted = true;
        } else if (type === 2) {
          stepsList.push({
            from: 'ai',
            kind: 'confirm',
            text: 'That workaround should get you unblocked. Want me to notify you when the permanent fix ships?',
            positive: 'Yes, notify me',
            negative: "Workaround didn't help"
          });
          this.n = stepsList.length;
          this.halted = true;
        } else {
          stepsList.push({
            from: 'ai',
            kind: 'confirm',
            text: 'Did this resolve your issue?'
          });
          this.n = stepsList.length;
          this.halted = true;
        }
      }

      setTimeout(() => this.scrollToBottom(), 50);
    });
  }

  onSubmitForm() {
    this.formSubmitted = true;
    const result = classifyIssue(this.formDesc, this.demo.kb, this.thresholds);
    const maxId = Math.max(...this.demo.queue.map(t => parseInt(t.id.replace('TCK-', ''), 10) || 0), 2050);
    const ticketId = 'TCK-' + (maxId + 1);
    this.customTicketId = ticketId;

    const queueTicket: QueueTicket = {
      id: ticketId,
      confidence: result.confidence,
      type: result.type,
      priority: this.formPriority,
      area: this.formArea,
      customer: 'You (Demo User)',
      company: 'Demo Session',
      age: 'just now',
      subject: this.formSubject,
      description: this.formDesc,
      attachment: this.formAttachment || undefined,
      draft: result.intro + (result.steps.length ? '\n' + result.steps.join('\n') : ''),
      evidence: result.evidence,
      reopen: 0,
      novel: true,
    };
    this.demo.queue = [...this.demo.queue, queueTicket];
    this.demo.notify(
      'New ticket created',
      ticketId + ' · ' + this.formArea + ' · ' + this.formPriority,
      'purple'
    );

    const dyn = this.SCENARIOS[this.sid];
    if (dyn) {
      const currentVisible = dyn.steps.slice(0, this.n);
      const statusStep: ScenarioStep = {
        from: 'ai',
        kind: 'status',
        text: `I've opened ticket ${ticketId} and routed it to the ${this.formArea} team with a ${this.formPriority === 'P1' ? '1-hour' : this.formPriority === 'P2' ? '4-hour' : '24-hour'} SLA. A support specialist will follow up shortly.`
      };
      dyn.steps = [...currentVisible, statusStep];
      dyn.type = result.type;
      dyn.confidence = result.confidence;
      dyn.productArea = this.formArea;
      dyn.priority = this.formPriority;
      dyn.summary = this.formSubject;

      this.n = currentVisible.length;
      this.halted = false;
      this.outcome = null;
      this.agentJoined = false;
      this.liveAnswer = null;
      clearTimeout(this.timer);
      this.startPlayback();
    }
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

  /** Form file picker → stage an image/video preview for the ticket. */
  onFormAttach(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files && input.files[0];
    if (!file) return;
    const kind: 'image' | 'video' = file.type.startsWith('video') ? 'video' : 'image';
    this.formAttachment = { name: file.name, url: URL.createObjectURL(file), kind };
    input.value = '';
  }
  clearFormAttachment() { this.formAttachment = null; }

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
  get pendingForm(): boolean { return this.halted && !this.formSubmitted && !!this.last && this.last.kind === 'ticket-form'; }
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
    this.rephraseCount = 0;
    this.formSubject = '';
    this.formArea = '';
    this.formPriority = 'P3';
    this.formDesc = '';
    this.formAttachment = null;
    this.formSubmitted = false;
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
