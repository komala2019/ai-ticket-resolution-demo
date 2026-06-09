import { Component, Input, OnChanges, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { Subscription } from 'rxjs';
import { SCENARIOS, TYPE_META, routeFor, Thresholds, ScenarioStep, Scenario, QueueTicket } from '../ticket-data';
import { TicketResolutionApiService } from '../ticket-resolution-api.service';
import { classifyIssue, isBugIntent, isVagueQuery, isNegationQuery, parseResolutionText, LocalClassifyResult, BUG_SYMPTOM_KEYWORDS, NOVEL_SIGNALS, hydrateScenario } from '../local-classifier';
import { DemoStateService } from '../demo-state.service';

type OutcomeKind = 'fixed' | 'notify' | 'failed' | null;

const SLA_BY_PRIORITY: Record<string, string> = { P1: '1-hour', P2: '4-hour', P3: '24-hour' };
const AGENT_EXTRA_SIGNALS = ['sync', 'still broken'];

@Component({
  selector: 'app-tr-customer-chat',
  templateUrl: './customer-chat.component.html',
  styleUrls: ['./customer-chat.component.scss'],
})
export class CustomerChatComponent implements OnChanges, OnDestroy {
  @Input() thresholds!: Thresholds;
  @ViewChild('scrollEl') scrollEl!: ElementRef<HTMLElement>;

  SCENARIOS = SCENARIOS;
  TYPE_META = TYPE_META;
  routeFor = routeFor;

  constructor(private api: TicketResolutionApiService, public demo: DemoStateService) {}

  sid = 'custom';
  rephraseCount = 0;
  lastConfidence = 0;
  excludedKbIds = new Set<string>();
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

    // When an image is attached with no text, extract context from the filename
    // so the classifier has something to work with beyond the generic fallback.
    let msg = text;
    if (!msg && attachment?.kind === 'image') {
      const hint = this.imageContextFromName(attachment.name);
      msg = hint
        ? `Please take a look at the attached screenshot — it shows an issue with: ${hint}.`
        : 'Please take a look at the attached screenshot.';
    } else if (!msg) {
      msg = 'Please take a look at the attached file.';
    }

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
        const currentScenario = this.SCENARIOS['__custom'];
        if (!currentScenario) return;
        const oldSteps = currentScenario.steps;
        const thinkIdx = oldSteps.findIndex(s => s.kind === 'thinking' && s.agent);

        // Exclude the typing step itself so the reply function sees only real
        // conversation history, not "Maya is typing…".
        const contextSteps = thinkIdx !== -1
          ? oldSteps.slice(0, thinkIdx)
          : oldSteps.slice(0, this.n);
        const replyText = getSimulatedAgentReply(msg, contextSteps);
        const agentStep: ScenarioStep = { from: 'ai', agent: true, text: replyText };

        // Build a new steps array so Angular's ngFor detects the reference change.
        const newSteps = oldSteps.slice();
        if (thinkIdx !== -1) {
          newSteps[thinkIdx] = agentStep;
        } else {
          newSteps.push(agentStep);
        }

        this.SCENARIOS = {
          ...this.SCENARIOS,
          __custom: { ...currentScenario, steps: newSteps },
        };
        this.n = newSteps.length;
        this.halted = false;
        this.demo.notify('Maya (Support)', replyText, 'blue');
        setTimeout(() => this.scrollToBottom(), 50);

        // Auto follow-up: when Maya's reply is a placeholder ("give me a moment",
        // "checking now", etc.) she proactively comes back with findings so the
        // user doesn't have to prompt again.
        if (mayaWillFollowUp(replyText)) {
          this.scheduleMayaFollowUp(replyText, newSteps.length);
        }
      }, 1600);
      
      return;
    }

    // ── Negation detection ────────────────────────────────────────────────────
    // If the user explicitly rejects the previous answer ("issue is different",
    // "that's not it", etc.), exclude the last matched KB from the next round
    // and ask them to describe their actual issue instead of re-classifying.
    const isNegation = isNegationQuery(msg);
    if (isNegation) {
      const prevKbId = this.SCENARIOS['__custom']?.kbId;
      if (prevKbId) this.excludedKbIds.add(prevKbId);

      const clarifyStep: ScenarioStep = {
        from: 'ai',
        text: "Understood — that wasn't the right match. Could you describe what's actually happening? The more specific you are (what you see, when it started, which page), the better I can find the right fix.",
      };
      currentSteps.push(userStep, clarifyStep);
      this.SCENARIOS = {
        ...this.SCENARIOS,
        __custom: { ...this.SCENARIOS['__custom'], steps: currentSteps, summary: msg },
      };
      this.n = currentSteps.length;
      this.halted = false;
      this.rephraseCount = 0;
      this.lastConfidence = 0;
      setTimeout(() => this.scrollToBottom(), 50);
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
        this.lastConfidence = 0;
        this.excludedKbIds = new Set();
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
      confidence: 0,
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
    this.formSubmitted = false;
    clearTimeout(this.timer);
    setTimeout(() => this.scrollToBottom(), 50);

    this.api.chat(msg).subscribe(response => {
      const stepsList = this.SCENARIOS['__custom'].steps;
      const thinkIdx = stepsList.findIndex(s => s.kind === 'thinking');
      const isOffline = !response.ok || response.model === 'demo-fallback';

      // ── Build cumulative context ONCE ──────────────────────────────────────
      // Only use user messages from the current "session" — i.e. after the
      // last status step. This prevents the original bug description from
      // bleeding into follow-up classifications after a ticket was raised.
      const lastStatusIdx = currentSteps.reduce(
        (idx, s, i) => (s.kind === 'status' ? i : idx), -1
      );
      const priorUserTexts = currentSteps
        .slice(lastStatusIdx + 1)
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
        localResult = classifyIssue(cumulativeMsg, this.demo.kb, this.thresholds, this.excludedKbIds);
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
          const contextK = score >= this.thresholds.auto ? 1 : score >= this.thresholds.approve ? 2 : 3;
          evidence = response.context.slice(0, contextK).map((r: any) => ({
            t: `${r.id} · ${r.title}`,
            m: Math.round(r.score * 100),
          }));
        }
      }

      const priority = (isOffline && localResult) ? localResult.priority
        : (type === 1 ? 'P1' : (type === 2 ? 'P2' : 'P3'));

      // ── Branch: non-bug chit-chat ──────────────────────────────────────────
      if (!isBug) {
        // Use a context-aware nudge, not a first-time greeting, since the
        // conversation has already started when the user reaches this branch.
        const nudges = [
          "I want to make sure I find the right fix. Could you describe the specific issue — what you see on screen, which feature it affects, and when it started?",
          "Tell me a bit more so I can search the knowledge base accurately: what exactly is broken or unexpected, and on which page or feature?",
          "To find the best match, I need a little more detail: what behavior are you seeing, and what did you expect to happen instead?",
        ];
        const aiStepText = isOffline
          ? nudges[Math.floor(Math.random() * nudges.length)]
          : (response.answer || 'No reply returned.');
        const aiStep: ScenarioStep = { from: 'ai', text: aiStepText };
        if (thinkIdx !== -1) stepsList[thinkIdx] = aiStep;
        else stepsList.push(aiStep);
        this.n = stepsList.length;
        this.halted = false;

      // ── Branch: vague bug — ask for more detail ────────────────────────────
      // Allow a 3rd round only when confidence genuinely improved on the 2nd round.
      // Compare BEFORE updating lastConfidence so we don't always see improvement vs 0.
      } else if (isVague && this.rephraseCount < (this.rephraseCount === 2 && score > this.lastConfidence ? 3 : 2)) {
        this.rephraseCount++;
        this.lastConfidence = score;
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

        const maxRephrase = this.rephraseCount === 2 && score > this.lastConfidence ? 3 : 2;
        if (isVague && this.rephraseCount >= maxRephrase) {
          // User couldn't clarify after allowed attempts — open a ticket.
          // Use the count BEFORE sentinel increment so penalty reflects actual rounds wasted.
          const penaltyRounds = this.rephraseCount;
          this.rephraseCount = maxRephrase + 1;
          finalType = 1;
          finalScore = Math.max(0, score - (penaltyRounds * 8));
          finalRoute = 'eng';
        } else {
          this.rephraseCount = 0;
          this.lastConfidence = 0;
        }

        const classifyStep: ScenarioStep = { from: 'ai', kind: 'classify' };
        let aiStep: ScenarioStep;

        // ── Pre-escalation clarification ─────────────────────────────────────
        // When the classifier can't find a KB match (type 1) but there are no
        // explicit regression signals (not a genuine "broke after update" bug),
        // ask for more context before opening a ticket. This gives the user up
        // to 2 rounds to describe their actual issue more specifically.
        const isGenuinelyNovel = localResult?.looksNovel
          || NOVEL_SIGNALS.some(s => cumulativeMsg.includes(s.phrase));
        const preEscalateLimit = 2;

        if (finalType === 1 && !isGenuinelyNovel && this.rephraseCount < preEscalateLimit) {
          this.rephraseCount++;
          this.lastConfidence = finalScore;
          const deepenText = this.rephraseCount === 1
            ? `I couldn't find a confident match in our knowledge base yet. To route this correctly, could you describe:\n• What exactly do you see — error message, blank screen, wrong data?\n• Which feature or page is this on?\n• When did it start happening?`
            : `Still narrowing this down. A few more details would help:\n• Is there a specific error code or message?\n• Does it happen for all users or just you?\n• Did anything change recently — new setting, permission, or update?`;
          const deepenStep: ScenarioStep = { from: 'ai', text: deepenText };
          if (thinkIdx !== -1) stepsList[thinkIdx] = deepenStep;
          else stepsList.push(deepenStep);
          this.SCENARIOS['__custom'].type = finalType;
          this.SCENARIOS['__custom'].confidence = finalScore;
          this.SCENARIOS['__custom'].productArea = area;
          this.SCENARIOS['__custom'].kbId = kbId;
          this.SCENARIOS['__custom'].evidence = evidence;
          this.n = stepsList.length;
          this.halted = false;
          setTimeout(() => this.scrollToBottom(), 50);
          return;
        }

        if (finalType === 1) {
          const isVagueFallback = isVague && this.rephraseCount > maxRephrase;
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
          this.SCENARIOS['__custom'].jira = localResult?.bestKb?.jira ?? (kbId ? 'CS-' + kbId.slice(-3) : undefined);
          this.SCENARIOS['__custom'].eta = localResult?.bestKb?.etaDays
            ? `Fix in progress — ~${localResult.bestKb.etaDays} days`
            : 'Fix in progress';
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
        text: `I've opened ticket ${ticketId} and routed it to the ${this.formArea} team with a ${SLA_BY_PRIORITY[this.formPriority] ?? '24-hour'} SLA. A support specialist will follow up shortly.`
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
    this.stageFile(file);
    input.value = '';
  }
  clearAttachment() { this.pendingAttachment = null; }

  /** Drag-and-drop: prevent default so the browser doesn't navigate away. */
  onDragOver(ev: DragEvent) { ev.preventDefault(); ev.stopPropagation(); }

  onDrop(ev: DragEvent) {
    ev.preventDefault();
    ev.stopPropagation();
    const file = ev.dataTransfer?.files?.[0];
    if (file) this.stageFile(file);
  }

  /** Clipboard paste — captures images pasted with Ctrl+V / ⌘V. */
  onPaste(ev: ClipboardEvent) {
    const items = ev.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile();
        if (file) {
          ev.preventDefault();
          this.stageFile(file);
          return;
        }
      }
    }
  }

  /** Stage any File as a pending attachment (used by upload, drop, and paste). */
  stageFile(file: File) {
    const kind: 'image' | 'video' = file.type.startsWith('video') ? 'video' : 'image';
    const name = file.name || (kind === 'image' ? 'pasted-image.png' : 'pasted-video.mp4');
    this.pendingAttachment = { name, url: URL.createObjectURL(file), kind };
  }

  /**
   * Extract product-area context hints from an image filename.
   * Used to pre-populate the classifier when no text is provided alongside the image.
   * Returns a short hint string or empty string if no signals found.
   */
  imageContextFromName(name: string): string {
    const n = name.toLowerCase().replace(/[-_.]/g, ' ');
    const hints: string[] = [];
    if (/booking|widget|reservation|reserve|checkout/.test(n)) hints.push('booking engine widget');
    if (/analytic|chart|dashboard|graph|report/.test(n))       hints.push('analytics dashboard');
    if (/email|campaign|segment|newsletter/.test(n))           hints.push('email campaign');
    if (/salesforce|sync|integration|webhook|api|crm/.test(n)) hints.push('integration sync');
    if (/account|invite|login|seat|billing|permission/.test(n)) hints.push('account settings');
    if (/blank|missing|empty|broken|error|fail/.test(n))       hints.push('not loading');
    return hints.join(', ');
  }

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
  /** Contextual quick-reply chips — shown throughout the custom chat, not just at the start. */
  get dynamicChips(): string[] {
    // Before any user interaction: generic topic starters
    if (this.n <= 1) {
      return [
        'Booking engine issue',
        'Analytics not loading',
        'Login / account problem',
        'Email campaign error',
        'Integration not working',
      ];
    }
    // After escalation status message: follow-up options
    if (this.last?.kind === 'status') {
      return ['Add more context', 'Mark as urgent', 'Different issue', 'Contact support'];
    }
    // Area-specific follow-up chips so the user can narrow or pivot without retyping
    const area = this.scenario?.productArea || 'General';
    const byArea: Record<string, string[]> = {
      'Booking engine':   ['Widget still missing', 'Rate plan problem', 'Currency at checkout', 'Different page issue'],
      'Analytics':        ['Charts still blank',   'Wrong data shown',  'Export not working',   'Different dashboard'],
      'Account':          ["Can't invite teammate", 'Login problem',     'Billing question',     'Permission issue'],
      'Email campaigns':  ['Still sending twice',  'Campaign not sending', 'Segment issue',     'Unsubscribe problem'],
      'Integrations':     ['Sync still failing',   'API error',         'Webhook issue',        'Different integration'],
    };
    const areaChips = byArea[area] || ['Booking engine issue', 'Account problem', 'Analytics issue', 'Report a bug'];
    return [...areaChips, 'Different issue'];
  }

  /** Show quick-reply chips throughout the custom chat session (not just at the start). */
  get showStarterChips(): boolean {
    if (this.sid !== 'custom' && this.sid !== '__custom') return false;
    if (this.agentJoined) return false;
    if (this.outcome) return false;
    if (this.halted) return false;               // clarify / confirm / ticket-form — AI needs specific input
    if (this.last?.kind === 'thinking') return false;  // AI is mid-response
    return true;
  }

  sendStarter(prompt: string) {
    this.composerText = prompt;
    this.onSend();
  }

  get steps(): ScenarioStep[] { return this.scenario.steps; }
  get visible(): ScenarioStep[] { return this.steps.slice(0, this.n); }
  get classified(): boolean { return this.visible.some(s => s.kind === 'classify'); }
  get last(): ScenarioStep | null { return this.steps[this.n - 1] || null; }
  get pendingClarify(): boolean { return this.halted && !!this.last && this.last.kind === 'clarify'; }
  get pendingConfirm(): boolean { return this.halted && !this.outcome && !!this.last && this.last.kind === 'confirm'; }
  get pendingForm(): boolean { return this.halted && !this.formSubmitted && !!this.last && this.last.kind === 'ticket-form'; }
  get done(): boolean { return !this.steps[this.n] || !!this.outcome; }

  ngOnChanges() {
    // Re-derive static scenario metadata against the live KB whenever thresholds change.
    for (const id of ['type1', 'type2', 'type3']) {
      if (this.SCENARIOS[id]) {
        this.SCENARIOS = { ...this.SCENARIOS, [id]: hydrateScenario(this.SCENARIOS[id], this.demo.kb, this.thresholds) };
      }
    }
  }

  ngOnInit() {
    // Load scenarios from the backend; fall back to bundled data if offline.
    this.sub = this.api.getScenarios().subscribe(res => {
      if (res && res.map && Object.keys(res.map).length) {
        this.SCENARIOS = res.map;
        if (!this.SCENARIOS[this.sid]) this.sid = 'custom';
      }
      // Hydrate static scenario metadata after scenarios are loaded.
      for (const id of ['type1', 'type2', 'type3']) {
        if (this.SCENARIOS[id]) {
          this.SCENARIOS = { ...this.SCENARIOS, [id]: hydrateScenario(this.SCENARIOS[id], this.demo.kb, this.thresholds) };
        }
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
      this.agentJoined = false;
      this.customTicketId = null;
      this.rephraseCount = 0;
      this.lastConfidence = 0;
      this.excludedKbIds = new Set();
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
    this.lastConfidence = 0;
    this.excludedKbIds = new Set();
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

  /**
   * Schedules Maya's automatic follow-up after a placeholder reply.
   * Shows "Maya is typing…" after 4 s, then delivers the investigation
   * result 2 s later — no user input required.
   */
  scheduleMayaFollowUp(placeholderReply: string, stepsLenAfterReply: number) {
    setTimeout(() => {
      const scenario = this.SCENARIOS['__custom'];
      if (!scenario) return;

      // Insert "Maya is typing…" thinking bubble.
      const withThink = [...scenario.steps, { from: 'ai' as const, agent: true, kind: 'thinking' as const }];
      this.SCENARIOS = { ...this.SCENARIOS, __custom: { ...scenario, steps: withThink } };
      this.n = withThink.length;
      this.halted = false;
      setTimeout(() => this.scrollToBottom(), 50);

      // After 2 more seconds replace thinking bubble with the follow-up reply.
      setTimeout(() => {
        const cur = this.SCENARIOS['__custom'];
        if (!cur) return;
        const followUpText = getMayaFollowUpReply(placeholderReply, cur.steps.slice(0, stepsLenAfterReply));
        const thinkIdx = cur.steps.findIndex(s => s.kind === 'thinking' && s.agent);
        const resolved: ScenarioStep = { from: 'ai', agent: true, text: followUpText };
        const next = cur.steps.slice();
        if (thinkIdx !== -1) { next[thinkIdx] = resolved; } else { next.push(resolved); }
        this.SCENARIOS = { ...this.SCENARIOS, __custom: { ...cur, steps: next } };
        this.n = next.length;
        this.halted = false;
        this.demo.notify('Maya (Support)', followUpText, 'blue');
        setTimeout(() => this.scrollToBottom(), 50);
      }, 2000);
    }, 4000);
  }

  ngOnDestroy() {
    clearTimeout(this.timer);
    if (this.sub) {
      this.sub.unsubscribe();
    }
  }
}

/**
 * Simulate a human agent reply that is fully context-aware.
 *
 * Key improvements over the previous version:
 *  - Reads Maya's LAST message to understand what question was just asked,
 *    so "yes" / "no" replies are processed in context, not as generic input.
 *  - Tracks recently-sent replies and excludes them from the fallback pool,
 *    so the same line is never repeated in consecutive turns.
 *  - Progressive investigation flow: browser → all-users → logs → escalate,
 *    driven by the answers the user gives, not random selection.
 */
function getSimulatedAgentReply(userMessage: string, history: ScenarioStep[]): string {
  const msg = userMessage.toLowerCase().trim();

  // ── Conversational context ──────────────────────────────────────────────────
  const agentSteps = history.filter(s => s.agent && s.from === 'ai' && s.text && s.kind !== 'thinking');
  const lastMayaText = (agentSteps[agentSteps.length - 1]?.text || '').toLowerCase();
  const recentMayaTexts = new Set(agentSteps.slice(-3).map(s => s.text || ''));

  // ── What the AI system already tried ───────────────────────────────────────
  const aiAlreadySentFix = history.some(s => s.kind === 'resolution' || s.kind === 'known');
  const aiEscalated      = history.some(s => s.kind === 'novel' || s.kind === 'status');
  const priorWorkaround  = history.find(s => s.kind === 'known');
  const workaroundTitle  = priorWorkaround?.headline || 'that workaround';

  // ── Detect simple affirmative / negative replies ────────────────────────────
  const AFFIRMATIVES = new Set(['yes', 'yeah', 'yep', 'yup', 'correct', 'right', 'sure', 'ok', 'okay', 'true', 'confirmed']);
  const NEGATIVES    = new Set(['no', 'nope', 'nah', 'not really', 'no it does not', "doesn't", 'negative']);
  const isAffirmative = AFFIRMATIVES.has(msg) || msg.startsWith('yes,') || msg.startsWith('yes ');
  const isNegative    = NEGATIVES.has(msg) || msg.startsWith('no,') || msg.startsWith('no ');
  const isSimpleAnswer = isAffirmative || isNegative;

  // ── Context-driven response to Maya's last question ────────────────────────
  if (isSimpleAnswer && lastMayaText) {
    if (lastMayaText.includes('browser')) {
      return isAffirmative
        ? "Got it — same issue across all browsers means it's server-side, not a local cache problem. I'm pulling your account session logs now to look for errors."
        : "Helpful — which browser works correctly? That'll let me isolate whether it's a rendering issue or a session problem.";
    }
    if (lastMayaText.includes('all users') || lastMayaText.includes('everyone') || lastMayaText.includes('other users')) {
      return isAffirmative
        ? "Account-wide impact confirmed. I'm escalating to our backend team right now with full context — they should have an update within the hour."
        : "So it's isolated to your account — that points to a permission or configuration issue. Let me check your account settings and role assignments.";
    }
    if (lastMayaText.includes('error') && lastMayaText.includes('message')) {
      return isAffirmative
        ? "Can you share the exact wording of the error? Even a partial message helps us pinpoint which service is failing."
        : "No error message — just unexpected behavior. That narrows it to a data or rendering issue rather than an authentication failure.";
    }
    if (lastMayaText.includes('recently') || lastMayaText.includes('change') || lastMayaText.includes('update')) {
      return isAffirmative
        ? "That's very useful — a recent change is likely the trigger. Can you tell me what was changed and roughly when? I'll correlate it with our deployment log."
        : "No recent changes on your end. I'll check whether there was a platform-side deployment that could have caused this.";
    }
    if (lastMayaText.includes('reproduce') || lastMayaText.includes('steps')) {
      return isAffirmative
        ? "Great — walk me through the steps and I'll reproduce it on my side to confirm the root cause."
        : "No consistent repro steps — intermittent issues are trickier, but not impossible. Does it correlate with a particular time of day or a specific data set?";
    }
    // Generic yes/no that doesn't match a specific previous question
    return isAffirmative
      ? "Thanks for confirming. I've noted that — let me keep investigating and I'll come back to you with a concrete next step."
      : "Understood. Let me look at this from a different angle — I'll check if there's a known pattern matching what you're seeing.";
  }

  // ── Gratitude / resolution confirmation ────────────────────────────────────
  if (msg.includes('thank') || msg.includes('awesome') || msg.includes('great') || msg.includes('perfect') || msg.includes('resolved')) {
    return "You're very welcome! Glad we got that sorted. I'll close this ticket on our end — feel free to reach out any time.";
  }
  if (aiAlreadySentFix && (msg.includes('work') || msg.includes('fixed') || msg.includes('working'))) {
    return "Great to hear! I'll mark this resolved and log the fix so we can surface it faster for anyone who hits the same issue.";
  }

  // ── Fix didn't hold ────────────────────────────────────────────────────────
  if (aiAlreadySentFix && (msg.includes("didn't") || msg.includes("not work") || msg.includes("still") || msg.includes("same issue"))) {
    return `Sorry "${workaroundTitle}" didn't hold. I'm escalating to our senior engineering team with the full conversation attached — they'll follow up within the hour and won't need you to repeat anything.`;
  }

  // ── Timing / ETA questions ─────────────────────────────────────────────────
  if (msg.includes('how long') || msg.includes('how much time') || msg.includes('eta') || msg.includes('when will') || msg.includes('how soon')) {
    return aiEscalated
      ? "The engineering team has been flagged with P1 priority. You should hear back within the hour — I'll personally follow up if you don't."
      : "Our standard SLA for this type of issue is 4 hours, but I'm actively watching this one and will update you as soon as I have news.";
  }

  // ── Ongoing bug / error signal ─────────────────────────────────────────────
  if ([...BUG_SYMPTOM_KEYWORDS, ...AGENT_EXTRA_SIGNALS].some(k => msg.includes(k))) {
    if (aiAlreadySentFix) {
      return "Understood — the automated fix didn't hold. Let me pull your account logs and check if there's a backend configuration issue specific to your environment.";
    }
    return "I see the issue. I'm checking our backend logs now — give me just a moment.";
  }

  // ── Fallback pool — never repeat a recently-sent reply ────────────────────
  // Questions progress through a natural investigation arc so each turn moves
  // the conversation forward rather than looping on the same prompt.
  const fallbacks = [
    "I'm reviewing everything you've shared. Let me dig into this and get back to you with a concrete next step.",
    "Got it. I'm pulling up your account settings to check for any backend misconfiguration.",
    "On it. I'm cross-checking with our service status and your account history — give me just a moment.",
    "Can you confirm whether this affects all users on your account, or just you?",
    "Does this happen on all browsers, or is it specific to one?",
    "Have you noticed any error messages, even briefly? Any detail helps narrow it down.",
    "Did anything change recently — a new team member, a settings update, or a platform announcement you saw?",
    "I can see the full context of this conversation so no need to repeat anything. Let me investigate and follow up shortly.",
  ];
  const available = fallbacks.filter(r => !recentMayaTexts.has(r));
  const pool = available.length > 0 ? available : fallbacks;
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Phrases that signal Maya is doing async work and will follow up. */
const PLACEHOLDER_PHRASES = [
  'give me just a moment', 'give me a moment', 'just a moment',
  'checking our backend', 'checking backend', 'checking now',
  'pulling up your account', 'pulling up', 'reviewing everything',
  'let me dig', 'cross-checking', 'follow up shortly',
  "i'll follow up", "i'll be back", 'looking into this',
  'looking into it', 'on it.', 'investigating',
];

function mayaWillFollowUp(reply: string): boolean {
  const lower = reply.toLowerCase();
  return PLACEHOLDER_PHRASES.some(p => lower.includes(p));
}

/**
 * Generates a contextual investigation result that Maya delivers after
 * her async placeholder reply (e.g. "checking backend logs now…").
 * Reads conversation history to pick the most relevant finding.
 */
function getMayaFollowUpReply(placeholder: string, history: ScenarioStep[]): string {
  const ph = placeholder.toLowerCase();
  const userContext = history.filter(s => s.from === 'user' && s.text).map(s => s.text!.toLowerCase()).join(' ');

  // Pick a follow-up branch based on what Maya said she was checking.
  if (ph.includes('backend log') || ph.includes('backend')) {
    return "I've pulled your backend logs. I can see a series of 503 errors originating from the auth service around the time you reported the issue — looks like a token refresh failure. I'm looping in the backend team with the trace ID so they can patch it. You should hear back within the hour.";
  }
  if (ph.includes('account setting') || ph.includes('account')) {
    return "I've reviewed your account configuration. Your role assignments look correct, but I can see a permission cache that hasn't refreshed since yesterday's deploy. I've cleared it on our side — can you try again now and let me know if the issue persists?";
  }
  if (ph.includes('service status') || ph.includes('status')) {
    return "I've checked our service-status board. There's a partial degradation in the reporting module that started about 2 hours ago — our team is actively working on it. I've added your ticket to the incident so you'll get an automatic update when it's resolved.";
  }
  if (ph.includes('cross-check') || ph.includes('reviewing everything')) {
    return "I've finished my review. Based on your account history and our deployment log, this appears to be related to a config change that went out in yesterday's release. I'm filing an internal bug with your session details attached — someone from engineering will reach out within the hour.";
  }

  // Generic follow-up for unrecognized placeholders.
  // Use userContext to bias toward more relevant options.
  const genericOptions = [
    { text: "I've dug into this further. There's a known intermittent issue with that component affecting a small set of accounts — our team has a fix in staging that should ship tonight. I'll notify you the moment it's live.", bias: ['intermittent', 'sometimes', 'random', 'occasionally'] },
    { text: "I've reviewed the logs and found an anomaly in the request pipeline for your account. I've escalated this with full trace details to our backend team — they're looking at it now and you'll get an update within the hour.", bias: ['error', 'broken', 'fail', 'not working', 'crash'] },
    { text: "After checking everything, I believe this is linked to a configuration rollout from yesterday. I've flagged it to the relevant team with your details and they'll prioritize it. Is there anything else I can help you with in the meantime?", bias: ['update', 'change', 'deploy', 'yesterday', 'after'] },
  ];
  const biased = genericOptions.filter(o => o.bias.some(b => userContext.includes(b)));
  const pool = biased.length > 0 ? biased : genericOptions;
  return pool[Math.floor(Math.random() * pool.length)].text;
}
