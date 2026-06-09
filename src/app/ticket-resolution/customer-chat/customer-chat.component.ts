import { Component, Input, OnChanges, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { Subscription } from 'rxjs';
import { SCENARIOS, SCENARIO_ORDER, TYPE_META, routeFor, Thresholds, ScenarioStep, Scenario, QueueTicket } from '../ticket-data';
import { TicketResolutionApiService } from '../ticket-resolution-api.service';
import { buildDynamicScenario, classifyIssue, isBugIntent, isVagueQuery, parseResolutionText, LocalClassifyResult } from '../local-classifier';
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

    if (this.agentJoined) {
      currentSteps.push(userStep);
      
      const typingStep: ScenarioStep = {
        from: 'ai',
        agent: true,
        kind: 'thinking',
        text: 'Maya is typing...'
      };
      currentSteps.push(typingStep);
      
      const customScenario: Scenario = {
        id: '__custom',
        label: 'Your issue',
        type: this.SCENARIOS['__custom'] ? this.SCENARIOS['__custom'].type : 3,
        confidence: this.SCENARIOS['__custom'] ? this.SCENARIOS['__custom'].confidence : 0,
        productArea: this.SCENARIOS['__custom'] ? this.SCENARIOS['__custom'].productArea : 'General',
        priority: this.SCENARIOS['__custom'] ? this.SCENARIOS['__custom'].priority : 'P3',
        summary: this.SCENARIOS['__custom'] ? this.SCENARIOS['__custom'].summary : msg,
        steps: currentSteps,
        ticketId: this.customTicketId || undefined
      };
      this.SCENARIOS = { ...this.SCENARIOS, __custom: customScenario };
      this.n = currentSteps.length;
      this.halted = true;
      setTimeout(() => this.scrollToBottom(), 50);

      setTimeout(() => {
        const stepsList = this.SCENARIOS['__custom'].steps;
        const thinkIdx = stepsList.findIndex(s => s.kind === 'thinking' && s.agent);
        
        const replyText = getSimulatedAgentReply(msg, this.SCENARIOS['__custom']?.steps.slice(0, this.n) || []);
        const agentStep: ScenarioStep = {
          from: 'ai',
          agent: true,
          text: replyText
        };
        
        if (thinkIdx !== -1) {
          stepsList[thinkIdx] = agentStep;
        } else {
          stepsList.push(agentStep);
        }
        
        this.n = stepsList.length;
        this.halted = false;
        this.demo.notify('Maya (Support)', replyText, 'blue');
        setTimeout(() => this.scrollToBottom(), 50);
      }, 1600);
      
      return;
    }

    // Check if the intent is a potential bug or just plain language
    const isBug = isBugIntent(msg, this.demo.kb);

    // Refresh rephrase count if user changed context or intent (but preserve conversation steps)
    const prevCustom = this.SCENARIOS['__custom'];
    if (prevCustom && this.sid === '__custom') {
      const prevIsBug = isBugIntent(prevCustom.summary, this.demo.kb);
      const localResult = classifyIssue(msg, this.demo.kb, this.thresholds);
      const newArea = localResult.productArea;
      const prevArea = prevCustom.productArea || 'General';

      const intentChanged = isBug !== prevIsBug || (isBug && newArea !== 'General' && newArea !== prevArea);

      if (intentChanged) {
        this.rephraseCount = 0;
      }
    }

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

      // ── Build cumulative context ONCE ──────────────────────────────────────
      // Joining the last 3 user turns + this message means short follow-ups
      // ("widget missing") are evaluated with the full conversation context.
      const priorUserTexts = currentSteps
        .filter(s => s.from === 'user' && s.text)
        .map(s => s.text || '')
        .slice(-3);
      const cumulativeMsg = [...priorUserTexts, msg].join(' ').trim();
      const isVague = isVagueQuery(cumulativeMsg);

      // ── Run classification ONCE ────────────────────────────────────────────
      let score: number;
      let route: string;
      let type: number;
      let area: string;
      let kbId: string | undefined;
      let evidence: { t: string; m: number }[];
      let localResult: LocalClassifyResult | null = null;

      if (isOffline) {
        localResult = classifyIssue(cumulativeMsg, this.demo.kb, this.thresholds);
        score = localResult.confidence;
        route = localResult.route;
        type = localResult.type;
        area = localResult.productArea;
        kbId = localResult.bestKb ? localResult.bestKb.id : undefined;
        evidence = localResult.evidence;
      } else {
        score = response.confidence ?? 0;
        route = response.route || 'fallback';
        type = 3;
        area = 'General';
        kbId = undefined;
        evidence = [];
        if (route.includes('escalate') || score < this.thresholds.rewrite) type = 1;
        else if (score < this.thresholds.auto) type = 2;
        if (response.context && response.context.length > 0) {
          const topHit = response.context[0];
          kbId = topHit.id;
          if (topHit.tags && topHit.tags.length > 0) area = topHit.tags[0];
          evidence = response.context.slice(0, 2).map((r: any) => ({
            t: `${r.id} · ${r.title}`,
            m: Math.round(r.score * 100),
          }));
        }
      }

      const priority = type === 1 ? 'P1' : (type === 2 ? 'P2' : 'P3');

      // ── Branch: non-bug chit-chat ──────────────────────────────────────────
      if (!isBug) {
        const greetings = [
          "Hello! Describe your product issue and I'll search the knowledge base for a fix — Booking Engine, Analytics, Email campaigns, Salesforce, or Account settings.",
          "Hi there! I can diagnose product bugs locally. Tell me what's happening and I'll match it against our knowledge base.",
          "Welcome! Describe the issue in plain language (what you see, when it started) and I'll find the right resolution.",
        ];
        const aiStepText = isOffline
          ? greetings[Math.floor(Math.random() * greetings.length)]
          : (response.answer || 'No reply returned.');
        const aiStep: ScenarioStep = { from: 'ai', text: aiStepText };
        if (thinkIdx !== -1) stepsList[thinkIdx] = aiStep;
        else stepsList.push(aiStep);
        this.n = stepsList.length;
        this.halted = false;

      // ── Branch: vague bug — ask for more detail (up to 2 rounds) ──────────
      } else if (isVague && this.rephraseCount < 2) {
        this.rephraseCount++;
        const clarifyText = this.rephraseCount === 1
          ? `I can see this is related to the **${area}** area, but I need a bit more detail to find the right fix. What exactly do you see — is something missing, showing an error, or not loading?`
          : `I want to make sure I give you the right answer. Could you describe the exact symptoms or steps to reproduce it?`;
        const aiStep: ScenarioStep = { from: 'ai', text: clarifyText };
        if (thinkIdx !== -1) stepsList[thinkIdx] = aiStep;
        else stepsList.push(aiStep);
        this.n = stepsList.length;
        this.halted = false;

      // ── Branch: detailed bug — classify and respond ────────────────────────
      } else {
        let finalType = type;
        let finalPriority = priority;
        let finalScore = score;
        let finalRoute = route;

        if (isVague && this.rephraseCount === 2) {
          // User couldn't clarify after 2 attempts — open a ticket
          this.rephraseCount = 3;
          finalType = 1;
          finalPriority = 'P3';
          finalScore = Math.min(score, this.thresholds.rewrite - 5);
          finalRoute = 'eng';
        } else {
          this.rephraseCount = 0;
        }

        const classifyStep: ScenarioStep = { from: 'ai', kind: 'classify' };
        let aiStep: ScenarioStep;

        if (finalType === 1) {
          const isVagueFallback = isVague && this.rephraseCount === 3;
          aiStep = {
            from: 'ai',
            kind: 'novel',
            headline: isVagueFallback
              ? 'We need a bit more context to route this'
              : 'This looks like a new issue — escalating it with full context',
            intro: isVagueFallback
              ? "I couldn't identify a matching resolution. I've prepared a support ticket — please add a screenshot or reproduction steps to help us diagnose it faster."
              : `I don't have a confident fix in the knowledge base, so I won't guess. I've packaged everything engineering needs and flagged it ${finalPriority}.`,
            captured: [
              { k: 'Reported issue', v: msg.length > 90 ? msg.slice(0, 90) + '…' : msg },
              { k: 'Product area', v: area },
              { k: 'Priority', v: finalPriority },
              { k: 'KB match', v: kbId ? `${kbId} (${finalScore}%)` : 'none above threshold' },
            ],
          };
        } else if (finalType === 2) {
          // Use KB entry data directly (offline) or parse the LLM response (online)
          const headline = localResult ? localResult.headline : parseResolutionText(response.answer || '', 'Known issue').headline;
          const intro    = localResult ? localResult.intro    : parseResolutionText(response.answer || '', 'Known issue').intro;
          const workaround = localResult ? localResult.steps  : parseResolutionText(response.answer || '', 'Known issue').steps;
          aiStep = { from: 'ai', kind: 'known', headline, intro, workaround };
          this.SCENARIOS['__custom'].jira = kbId ? 'CS-' + kbId.slice(-3) : 'CS-4821';
          this.SCENARIOS['__custom'].eta = 'Fix in progress — ~' + (3 + (kbId ? kbId.charCodeAt(kbId.length - 1) % 5 : 2)) + ' days';
        } else {
          const headline       = localResult ? localResult.headline : parseResolutionText(response.answer || '', "Here's how to resolve this").headline;
          const intro          = localResult ? localResult.intro    : parseResolutionText(response.answer || '', "Here's how to resolve this").intro;
          const resolutionSteps = localResult ? localResult.steps   : parseResolutionText(response.answer || '', "Here's how to resolve this").steps;
          aiStep = { from: 'ai', kind: 'resolution', headline, intro, resolutionSteps };
        }

        if (thinkIdx !== -1) {
          stepsList[thinkIdx] = classifyStep;
          stepsList.splice(thinkIdx + 1, 0, aiStep);
        } else {
          stepsList.push(classifyStep, aiStep);
        }

        this.SCENARIOS['__custom'].type = finalType;
        this.SCENARIOS['__custom'].confidence = finalScore;
        this.SCENARIOS['__custom'].productArea = area;
        this.SCENARIOS['__custom'].priority = finalPriority;
        this.SCENARIOS['__custom'].kbId = kbId;
        this.SCENARIOS['__custom'].evidence = evidence;
        this.n = stepsList.length;
        this.halted = false;

        if (finalType === 1) {
          this.formSubject = msg.length > 80 ? msg.slice(0, 77) + '…' : msg;
          this.formArea = area;
          this.formPriority = finalPriority;
          this.formDesc = msg;
          this.formAttachment = attachment || null;
          this.formSubmitted = false;
          stepsList.push({ from: 'ai', kind: 'ticket-form' });
          this.n = stepsList.length;
          this.halted = true;
        } else if (finalType === 2) {
          stepsList.push({
            from: 'ai', kind: 'confirm',
            text: 'That workaround should get you unblocked. Want me to notify you when the permanent fix ships?',
            positive: 'Yes, notify me',
            negative: "Workaround didn't help",
          });
          this.n = stepsList.length;
          this.halted = true;
        } else {
          stepsList.push({ from: 'ai', kind: 'confirm', text: 'Did this resolve your issue?' });
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

    // Package conversation transcript
    const customScenario = this.SCENARIOS['__custom'];
    let chatHistory = '';
    if (customScenario && customScenario.steps) {
      chatHistory = customScenario.steps
        .filter(s => s.kind !== 'thinking' && s.kind !== 'classify' && s.kind !== 'ticket-form')
        .map(s => {
          const sender = s.from === 'user' ? 'Customer' : 'AI';
          let content = s.text || '';
          if (s.kind === 'resolution' || s.kind === 'known') {
            content = `[Matched KB Article: ${s.headline || ''}]\nIntro: ${s.intro || ''}`;
            const steps = s.resolutionSteps || s.workaround || [];
            if (steps.length > 0) {
              content += '\nSteps:\n' + steps.map((step, idx) => `${idx + 1}. ${step}`).join('\n');
            }
          } else if (s.kind === 'novel') {
            content = `[Escalation Details: ${s.headline || ''}]\nIntro: ${s.intro || ''}`;
          }
          return `${sender}: ${content}`;
        })
        .join('\n\n');
    }

    const fullDescription = this.formDesc + (chatHistory ? `\n\n=== Chat Transcript ===\n${chatHistory}` : '');

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
      description: fullDescription,
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
    if (id === 'custom' && this.SCENARIOS['__custom']) {
      this.sid = '__custom';
      this.n = this.SCENARIOS['__custom'].steps.length;
      this.halted = false;
      const lastStep = this.SCENARIOS['__custom'].steps[this.n - 1];
      if (lastStep && (lastStep.kind === 'clarify' || lastStep.kind === 'confirm' || lastStep.kind === 'ticket-form')) {
        this.halted = true;
      }
      setTimeout(() => this.scrollToBottom(), 50);
      return;
    }

    if (id === '__custom') {
      // Clear/Reset custom chat back to default template
      const template = JSON.parse(JSON.stringify(SCENARIOS['custom']));
      this.SCENARIOS['__custom'] = template;
      this.sid = '__custom';
      this.n = template.steps.length;
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
      setTimeout(() => this.scrollToBottom(), 50);
      return;
    }

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

  goToReference(text: string) {
    const match = text.match(/KB-\d+/);
    if (match) {
      const kbId = match[0];
      this.demo.viewState$.next('console');
      this.demo.tabState$.next('kb');
      this.demo.kbQuery$.next(kbId);
      this.demo.notify('Navigated to KB', `Showing reference for ${kbId}`, 'blue');
    }
  }

  ngOnDestroy() {
    clearTimeout(this.timer);
    if (this.sub) {
      this.sub.unsubscribe();
    }
  }
}

/**
 * Simulate a human agent reply that is aware of the conversation history.
 * Previously this was pure keyword-matching on the latest message with no
 * context. Now it checks what the AI already tried so Maya's replies
 * don't repeat suggestions or act unaware of prior turns.
 */
function getSimulatedAgentReply(userMessage: string, history: ScenarioStep[]): string {
  const msg = userMessage.toLowerCase();

  // What has the AI already attempted in this conversation?
  const aiAlreadySentFix = history.some(s => s.kind === 'resolution' || s.kind === 'known');
  const aiEscalated      = history.some(s => s.kind === 'novel' || s.kind === 'status');
  const priorWorkaround  = history.find(s => s.kind === 'known');
  const workaroundTitle  = priorWorkaround?.headline || 'that workaround';

  // User confirms fix worked
  if (msg.includes('thank') || msg.includes('awesome') || msg.includes('great') || msg.includes('perfect')) {
    return "You're very welcome! Glad we got that sorted. I'll mark this ticket resolved — feel free to reach out any time.";
  }
  if (aiAlreadySentFix && (msg.includes('work') || msg.includes('fixed') || msg.includes('resolved') || msg.includes('working'))) {
    return `Great to hear! I'll mark the ticket resolved on our end. The resolution has been logged so we can automate this for future customers.`;
  }

  // User says the AI's fix didn't work
  if (aiAlreadySentFix && (msg.includes("didn't") || msg.includes("not work") || msg.includes("still") || msg.includes("same issue"))) {
    return `Sorry "${workaroundTitle}" didn't do it. I'm escalating this to our senior engineering team right now with the full conversation attached — they'll follow up within the hour and won't need you to repeat anything.`;
  }

  // User asks about timing
  if (msg.includes('how long') || msg.includes('eta') || msg.includes('when') || msg.includes('update')) {
    if (aiEscalated) {
      return "Our engineering team has been notified with P1 priority. You should hear back within the hour. I'll personally follow up if you don't.";
    }
    return "Our standard SLA for this type of issue is 4 hours, but I'm watching this one directly and will update you as soon as I have news.";
  }

  // User reports an error or ongoing issue
  if (msg.includes('error') || msg.includes('broken') || msg.includes('fail') || msg.includes('sync') || msg.includes('bug') || msg.includes('still broken')) {
    if (aiAlreadySentFix) {
      return "Understood — the automated fix didn't hold. Let me pull your account logs and check if there's a backend configuration issue specific to your environment.";
    }
    return "I see the issue. I'm looking into our backend logs right now. One moment — I'll have more information for you shortly.";
  }

  // Generic fallback pool — varied to avoid repetition
  const replies = [
    "I'm reviewing everything you've shared. Let me dig into this on my end and get back to you with a concrete next step.",
    "Got it. I'm pulling up your account settings to check for any backend misconfiguration that might explain this.",
    "On it. I'm cross-checking with our service status and your account history — give me just a moment.",
    "Let me check that for you. Can you confirm whether this happens on all browsers, or just one specific browser?",
    "I can see the full context of this conversation so no need to repeat anything. Let me investigate and follow up shortly.",
  ];
  return replies[Math.floor(Math.random() * replies.length)];
}
