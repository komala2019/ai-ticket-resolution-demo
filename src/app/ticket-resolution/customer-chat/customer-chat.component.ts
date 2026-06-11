import { Component, Input, OnChanges, OnDestroy, OnInit, ViewChild, ElementRef } from '@angular/core';
import { Subscription } from 'rxjs';
import { SCENARIOS, TYPE_META, routeFor, Thresholds, ScenarioStep, Scenario, QueueTicket, KbEntry } from '../ticket-data';
import { TicketResolutionApiService } from '../ticket-resolution-api.service';
import { classifyIssue, isBugIntent, isVagueQuery, isNegationQuery, isChitChat, parseResolutionText, LocalClassifyResult, BUG_SYMPTOM_KEYWORDS, NOVEL_SIGNALS, hydrateScenario, scoreKb } from '../local-classifier';
import { DemoStateService } from '../demo-state.service';

type OutcomeKind = 'fixed' | 'notify' | 'failed' | null;

const SLA_BY_PRIORITY: Record<string, string> = { P1: '1-hour', P2: '4-hour', P3: '24-hour' };
const AGENT_EXTRA_SIGNALS = ['sync', 'still broken'];

/**
 * Generic starter chips shown before the first message.
 * Each phrase is designed to be:
 *  - Detected as a support query (area keyword triggers isBugIntent)
 *  - Vague enough (3-4 words, no BUG_SYMPTOM_KEYWORDS) to route through the
 *    AREA_SUBCHIPS drill-down rather than straight to classification
 */
const STARTER_CHIPS: string[] = [
  'Booking engine not loading',
  'Analytics data looks off',
  'Email campaigns acting up',
  'Account access not working',
  'Integration not syncing',
];

/** Area-level sub-chips shown when a generic area starter fires at low confidence (maps to CHIP_FOLLOW_UPS keys). */
const AREA_SUBCHIPS: Record<string, string[]> = {
  'Booking engine': ['Widget still missing',  'Rate plan problem',    'Currency at checkout', 'Different page issue'],
  'Analytics':      ['Charts still blank',    'Wrong data shown',     'Export not working',   'Different dashboard'],
  'Account':        ["Can't invite teammate", 'Login problem',        'Billing question',     'Permission issue'],
  'Email campaigns':['Still sending twice',   'Campaign not sending', 'Segment issue'],
  'Integrations':   ['Sync still failing',    'API error',            'Webhook issue'],
};

/** Targeted follow-up for each area-specific chip so repeated clicks don't loop on the same generic message. */
const CHIP_FOLLOW_UPS: Record<string, { question: string; subChips: string[] }> = {
  // Booking engine
  'Rate plan problem':       { question: 'Which aspect of rate plans is the issue?',                     subChips: ['Rates not displaying', 'Wrong price shown', 'Currency/conversion issue', 'Availability problem'] },
  'Currency at checkout':    { question: 'What exactly is wrong with the currency at checkout?',          subChips: ['Wrong currency symbol', 'Incorrect amount', 'Conversion not working', 'Multiple currencies shown'] },
  'Widget still missing':    { question: 'Where is the widget missing — all pages or a specific one?',   subChips: ['Missing from all pages', 'Missing after publish', 'Shows desktop, not mobile', 'Never worked'] },
  'Different page issue':    { question: 'Which page is the issue on, and what do you see?',             subChips: ['Booking confirmation page', 'Room / property page', 'Homepage', 'Search results'] },
  // Analytics
  'Charts still blank':      { question: 'Are all charts blank or just some? Which browser are you using?', subChips: ['All charts blank', 'Only specific charts', 'Chrome only', 'After changing date range'] },
  'Wrong data shown':        { question: 'What data looks incorrect — totals, dates, or filters?',       subChips: ['Wrong totals', 'Missing recent data', 'Date range issue', 'Wrong property'] },
  'Export not working':      { question: 'What happens when you try to export?',                         subChips: ['Download never starts', 'File is empty', 'Wrong format', 'Error message shown'] },
  'Different dashboard':     { question: 'Which dashboard has the issue?',                               subChips: ['Overview dashboard', 'Revenue report', 'Occupancy report', 'Custom report'] },
  // Account
  "Can't invite teammate":   { question: 'What happens when you try to invite? Button grayed out or an error?', subChips: ['Button grayed out', 'Error after clicking', 'Invite email not received', 'Seat limit reached'] },
  'Login problem':           { question: 'What happens when you try to log in?',                         subChips: ['Page shows error', 'Redirected away', 'Password not accepted', '2FA issue'] },
  'Billing question':        { question: 'What is the billing issue?',                                   subChips: ['Wrong charge', 'Invoice missing', 'Plan upgrade/downgrade', 'Payment method'] },
  'Permission issue':        { question: 'Which permission is wrong?',                                   subChips: ['Read-only when should edit', 'Missing section', 'Admin rights not applied', 'Team member access'] },
  // Email campaigns
  'Still sending twice':     { question: 'Is it still duplicating, or was it a one-time occurrence?',    subChips: ['Happening on new campaigns', 'Was a one-time event', 'Specific segment only', 'Need to check send log'] },
  'Campaign not sending':    { question: 'Is the campaign stuck in a specific state?',                   subChips: ['Stuck in draft', 'Scheduled but not sent', 'Processing forever', 'Error message shown'] },
  'Segment issue':           { question: 'What is wrong with the segment?',                              subChips: ['Wrong contacts included', 'Count seems off', "Segment won't save", 'Filter not working'] },
  // Integrations
  'Sync still failing':      { question: 'What does the sync error say, and which records are affected?', subChips: ['All records failing', 'Specific field error', 'Auth/credential issue', 'Partial sync only'] },
  'API error':               { question: 'Which API endpoint is erroring and what HTTP status do you see?', subChips: ['401 Unauthorized', '500 Server error', 'Timeout / no response', 'Wrong data returned'] },
  'Webhook issue':           { question: 'What is the webhook problem?',                                 subChips: ['Events not received', 'Payload wrong format', 'Duplicate events', 'Signature validation failing'] },
};

@Component({
  selector: 'app-tr-customer-chat',
  templateUrl: './customer-chat.component.html',
  styleUrls: ['./customer-chat.component.scss'],
})
export class CustomerChatComponent implements OnChanges, OnInit, OnDestroy {
  @Input() thresholds!: Thresholds;
  @ViewChild('scrollEl') scrollEl!: ElementRef<HTMLElement>;

  SCENARIOS = SCENARIOS;
  TYPE_META = TYPE_META;
  routeFor = routeFor;

  /** Whether the live LLM backend is reachable. */
  backendMode: 'online' | 'offline' | 'checking' = 'checking';

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
  /** The chip label that triggered the current send — used to pick a chip-specific clarification. */
  lastChipLabel: string | null = null;
  /** Sub-chips to display after a chip-specific clarification question. */
  activeSubChips: string[] | null = null;

  private timer: any;
  private sub?: Subscription;

  get scenario(): Scenario { return this.SCENARIOS[this.sid]; }

  onSend() {
    const text = this.composerText.trim();
    if (!text && !this.pendingAttachment) return;
    const attachment = this.pendingAttachment || undefined;
    this.composerText = '';
    this.pendingAttachment = null;
    const chipLabel = this.lastChipLabel;
    this.lastChipLabel = null;
    this.activeSubChips = null;

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

    // ── Post-outcome reset ────────────────────────────────────────────────────
    // When the user sends a new message after an outcome (resolved / failed /
    // notified), clear the outcome and start a fresh classification cycle so
    // the new issue is not tangled with the previous one.
    if (this.outcome) {
      this.outcome = null;
      this.rephraseCount = 0;
      this.lastConfidence = 0;
      this.excludedKbIds = new Set();
      this.activeSubChips = null;
    }

    // ── Negation detection ────────────────────────────────────────────────────
    // If the user explicitly rejects the previous answer ("issue is different",
    // "that's not it", etc.), exclude the last matched KB from the next round
    // and ask them to describe their actual issue instead of re-classifying.
    // Skip entirely when the message came from a chip click — chips are guided
    // selections, not rejections, and phrases like "Export not working" would
    // incorrectly match the 'not working' negation signal otherwise.
    const isNegation = !chipLabel && isNegationQuery(msg);
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
    const isBug = isBugIntent(msg, this.demo.kb) || (this.rephraseCount > 0 && this.sid === '__custom');

    // Refresh rephrase/clarification state if the user changed topic or intent.
    const prevCustom = this.SCENARIOS['__custom'];
    if (prevCustom && this.sid === '__custom') {
      const prevIsBug = isBugIntent(prevCustom.summary, this.demo.kb);
      const localResult = classifyIssue(msg, this.demo.kb, this.thresholds);
      const newArea = localResult.productArea;
      const prevArea = prevCustom.productArea || 'General';

      const intentChanged = isBug !== prevIsBug || (isBug && newArea !== 'General' && newArea !== prevArea);

      // Never reset rephraseCount when the user clicked a sub-chip — they are
      // already in a guided drill-down flow; resetting sends them back into the
      // pre-escalation branch and causes an infinite clarification loop.
      if (intentChanged && !chipLabel) {
        this.rephraseCount = Math.min(1, this.rephraseCount);
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

    // Build conversation history before the API call so Gemini has full context.
    const lastStatusIdx = currentSteps.reduce(
      (idx, s, i) => (s.kind === 'status' ? i : idx), -1
    );
    const conversationHistory = currentSteps
      .slice(lastStatusIdx + 1)
      .filter(s => (s.from === 'user' || s.from === 'ai') && s.text && s.kind !== 'thinking')
      .slice(-8, -1)  // up to 4 prior turns (user+ai pairs), exclude current user msg
      .map(s => ({ role: s.from as 'user' | 'ai', text: s.text || '' }));

    this.api.chat(msg, conversationHistory).subscribe(response => {
      const stepsList = this.SCENARIOS['__custom'].steps;
      const thinkIdx = stepsList.findIndex(s => s.kind === 'thinking');
      const isOffline = !response.ok || response.model === 'demo-fallback';
      this.backendMode = isOffline ? 'offline' : 'online';

      // ── Build cumulative context from the history we already captured ─────
      const priorUserTexts = conversationHistory
        .filter(s => s.role === 'user')
        .map(s => s.text);
      const cumulativeMsg = [...priorUserTexts, msg].join(' ').trim();
      // When the user is answering a chip drill-down (rephraseCount >= 2),
      // classify on just the current message so the original generic starter
      // chip ("Booking engine issue") doesn't dilute the specific sub-chip signal.
      const classifyMsg = (this.rephraseCount >= 2 && chipLabel) ? msg : cumulativeMsg;
      const isVague = isVagueQuery(classifyMsg);

      // ── Run classification ONCE ────────────────────────────────────────────
      let score: number;
      let route: string;
      let type: number;
      let area: string;
      let kbId: string | undefined;
      let evidence: { t: string; m: number }[];
      let localResult: LocalClassifyResult | null = null;

      // Always run the local classifier — it's instant/local and fills gaps that
      // the LLM response leaves open: looksNovel, priority, fallback headline/steps.
      localResult = classifyIssue(classifyMsg, this.demo.kb, this.thresholds, this.excludedKbIds);

      if (isOffline) {
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
        // Seed area/kbId from local classifier, then override with LLM context if available.
        area = localResult.productArea;
        kbId = localResult.bestKb?.id;
        evidence = localResult.evidence;
        if (route.includes('escalate') || score < this.thresholds.rewrite) type = 1;
        else if (score < this.thresholds.auto) type = 2;
        if (response.context && response.context.length > 0) {
          const topHit = response.context[0];
          kbId = topHit.id;
          if (topHit.tags && topHit.tags.length > 0) {
            const rawTag = topHit.tags[0] as string;
            // KB tags are lowercase; AREA_SUBCHIPS keys are title-case — normalize.
            area = AREA_SUBCHIPS[rawTag]
              ? rawTag
              : (Object.keys(AREA_SUBCHIPS).find(k => k.toLowerCase() === rawTag.toLowerCase()) ?? rawTag);
          }
          const contextK = score >= this.thresholds.auto ? 1 : score >= this.thresholds.approve ? 2 : 3;
          evidence = response.context.slice(0, contextK).map((r: any) => ({
            t: `${r.id} · ${r.title}`,
            m: Math.round(r.score * 100),
          }));
        }
      }

      const priority = localResult.priority;

      // ── Chip drill-down gate ──────────────────────────────────────────────
      // rephraseCount=1 means the user just picked a level-1 area sub-chip.
      // If that chip has a deeper CHIP_FOLLOW_UPS entry, ask it now instead
      // of classifying — this is the context-redirect step, not accumulation.
      if (chipLabel && CHIP_FOLLOW_UPS[chipLabel] && this.rephraseCount === 1) {
        const chipFollow = CHIP_FOLLOW_UPS[chipLabel];
        this.activeSubChips = chipFollow.subChips;
        this.rephraseCount = 2;
        this.lastConfidence = score;
        const deepenStep: ScenarioStep = { from: 'ai', text: chipFollow.question };
        if (thinkIdx !== -1) stepsList[thinkIdx] = deepenStep;
        else stepsList.push(deepenStep);
        this.SCENARIOS['__custom'].type = type;
        this.SCENARIOS['__custom'].confidence = score;
        this.SCENARIOS['__custom'].productArea = area;
        this.SCENARIOS['__custom'].kbId = kbId;
        this.SCENARIOS['__custom'].evidence = evidence;
        this.n = stepsList.length;
        this.halted = false;
        setTimeout(() => this.scrollToBottom(), 50);
        return;
      }

      // ── Branch: non-bug chit-chat ──────────────────────────────────────────
      if (!isBug) {
        let aiStepText: string;
        if (isOffline && isChitChat(msg)) {
          aiStepText = "I'm a support assistant, so I'm best at diagnosing technical issues with the platform. For anything outside that — or if you'd just prefer to speak with a person — hit the **Human** button and I'll connect you with the team right away.";
        } else {
          this.rephraseCount++;
          // Vague but could be support-related — ask for issue details.
          const nudges = [
            "I want to make sure I find the right fix. Could you describe the specific issue — what you see on screen, which feature it affects, and when it started?",
            "Tell me a bit more so I can search the knowledge base accurately: what exactly is broken or unexpected, and on which page or feature?",
            "To find the best match, I need a little more detail: what behavior are you seeing, and what did you expect to happen instead?",
          ];
          aiStepText = isOffline
            ? nudges[Math.floor(Math.random() * nudges.length)]
            : (response.answer || 'No reply returned.');
        }
        const aiStep: ScenarioStep = { from: 'ai', text: aiStepText };
        if (thinkIdx !== -1) stepsList[thinkIdx] = aiStep;
        else stepsList.push(aiStep);
        this.n = stepsList.length;
        this.halted = false;

      // ── Branch: vague bug — ask for more detail ────────────────────────────
      // Hard-cap at 2 rounds; never loop when the user is answering a sub-chip.
      } else if (isVague && this.rephraseCount < 2 && !(chipLabel && this.rephraseCount >= 1)) {
        const chipFollow = chipLabel ? CHIP_FOLLOW_UPS[chipLabel] : null;
        if (chipFollow) {
          // Chip-specific question — show targeted sub-chips and advance past the loop limit.
          this.activeSubChips = chipFollow.subChips;
          this.rephraseCount = 3;  // sentinel: next message goes straight to classification
          this.lastConfidence = score;
          const aiStep: ScenarioStep = { from: 'ai', text: chipFollow.question };
          if (thinkIdx !== -1) stepsList[thinkIdx] = aiStep;
          else stepsList.push(aiStep);
        } else {
          const areaChips = area !== 'General' ? AREA_SUBCHIPS[area] : null;
          if (areaChips && this.rephraseCount === 0) {
            // Known area but no specific issue described — show area-level sub-chips.
            this.activeSubChips = [...areaChips];
            this.rephraseCount = 1;
            this.lastConfidence = score;
            const clarifyText = `What's the specific issue with **${area}**? Pick the closest match below, or describe it in the chat.`;
            const aiStep: ScenarioStep = { from: 'ai', text: clarifyText };
            if (thinkIdx !== -1) stepsList[thinkIdx] = aiStep;
            else stepsList.push(aiStep);
          } else {
            this.rephraseCount++;
            this.lastConfidence = score;
            const clarifyText = this.rephraseCount === 1
              ? `I can see this is related to the **${area}** area, but I need a bit more detail. What exactly do you see — is something missing, showing an error, or not loading?`
              : `I want to make sure I give you the right answer. Could you describe the exact symptoms or steps to reproduce it?`;
            const aiStep: ScenarioStep = { from: 'ai', text: clarifyText };
            if (thinkIdx !== -1) stepsList[thinkIdx] = aiStep;
            else stepsList.push(aiStep);
          }
        }
        this.SCENARIOS['__custom'].productArea = area;
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

        // When confidence is below the rewrite threshold the classifier isn't
        // confident enough to serve a KB resolution — escalate cleanly instead
        // of showing a "Solvable now" card that may be wrong.
        if (finalRoute === 'eng' && finalType !== 1) {
          finalType = 1;
        }

        let aiStep: ScenarioStep;

        // ── Pre-escalation clarification ─────────────────────────────────────
        // When the classifier can't find a KB match (type 1) but there are no
        // explicit regression signals (not a genuine "broke after update" bug),
        // ask for more context before opening a ticket. This gives the user up
        // to 2 rounds to describe their actual issue more specifically.
        const isGenuinelyNovel = localResult?.looksNovel
          || NOVEL_SIGNALS.some(s => cumulativeMsg.includes(s.phrase));
        // One round of "tell me more" is enough when the area is already detected — the
        // user has given us an area signal (chip or keyword) so a second generic question
        // adds nothing. Two rounds only when the area is still completely unknown.
        const preEscalateLimit = area !== 'General' ? 1 : 2;

        if (finalType === 1 && !isGenuinelyNovel && this.rephraseCount < preEscalateLimit && !(chipLabel && this.rephraseCount >= 1)) {
          const chipFollow = chipLabel ? CHIP_FOLLOW_UPS[chipLabel] : null;
          let deepenText: string;
          if (chipFollow) {
            // Chip-specific follow-up: expose sub-chips and skip to the limit so no further loops.
            this.activeSubChips = chipFollow.subChips;
            this.rephraseCount = preEscalateLimit;  // next message bypasses this branch
            deepenText = chipFollow.question;
          } else {
            this.rephraseCount++;
            deepenText = this.rephraseCount === 1
              ? `I can see this is in the **${area}** area, but I need a bit more detail. Could you describe:\n• What exactly do you see — error message, blank screen, wrong value?\n• When did it start, and did anything change recently?`
              : `Still narrowing this down. A few more details would help:\n• Is there a specific error code or message?\n• Does it happen for all users or just you?\n• Did anything change recently — new setting, permission, or update?`;
          }
          this.lastConfidence = finalScore;
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

        // ── Pre-resolution clarification ─────────────────────────────────────
        // When the classifier found a KB match (type 2 or 3) but confidence is
        // below the approve threshold, ask a targeted question before showing
        // the KB article or workaround steps. Only fires on the first interaction
        // (rephraseCount === 0), for short messages (< 6 words — typical chip
        // labels), and never for P1 — urgent issues must not be delayed.
        const cumulativeWordCount = cumulativeMsg.split(/\s+/).filter(Boolean).length;
        if (finalType !== 1
            && finalScore < this.thresholds.approve
            && this.rephraseCount === 0
            && finalPriority !== 'P1'
            && cumulativeWordCount < 6
            && !chipLabel) {
          const chipFollow = chipLabel ? CHIP_FOLLOW_UPS[chipLabel] : null;
          let clarifyText: string;
          if (chipFollow) {
            this.activeSubChips = chipFollow.subChips;
            clarifyText = chipFollow.question;
          } else {
            const areaChips = area !== 'General' ? AREA_SUBCHIPS[area] : null;
            const bestKb = localResult ? localResult.bestKb : (kbId ? this.demo.kb.find(k => k.id === kbId) : null);
            const kbTitle = bestKb?.title;
            const kbContent = bestKb?.content;
            const kbFirstStep = bestKb?.steps?.[0] || 'Check the settings or steps for this feature.';

            const otherTitles = isOffline
              ? scoreKb(classifyMsg, this.demo.kb, this.excludedKbIds)
                  .slice(1, 4)
                  .map(s => s.entry.title)
              : (response.context?.slice(1, 4).map((r: any) => r.title) ?? []);

            let otherMatchesText = '';
            if (otherTitles.length > 0) {
              otherMatchesText = `\n\n**Other potential matches:**\n` +
                otherTitles.map(t => `• **${t}**`).join('\n');
            }

            if (areaChips && areaChips.length > 0) {
              this.activeSubChips = [...otherTitles, ...areaChips];
              clarifyText = kbTitle
                ? `I found a potential match — **${kbTitle}**.\n\nThis usually happens because: *${kbContent}*\n\nTry this next: **${kbFirstStep}**.${otherMatchesText}\n\nDoes that help, or does one of these best describe your issue?`
                : `I can see this is in the **${area}** area. Which of these best describes your issue?`;
            } else {
              this.activeSubChips = otherTitles.length > 0 ? [...otherTitles] : null;
              clarifyText = kbTitle
                ? `I found a potential match — **${kbTitle}**.\n\nThis usually happens because: *${kbContent}*\n\nTry this next: **${kbFirstStep}**.${otherMatchesText}\n\nDoes that help, or could you describe what's happening in more detail?`
                : `I can see this is in the **${area}** area, but I need a bit more detail to find the right fix.`;
            }
          }
          this.rephraseCount = 1;
          this.lastConfidence = finalScore;
          const deepenStep: ScenarioStep = { from: 'ai', text: clarifyText };
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
          // Resolve the matched KB entry: LLM's top hit takes precedence over local classifier.
          const matchedKb = (kbId ? this.demo.kb.find(k => k.id === kbId) : null) ?? localResult.bestKb ?? null;
          const headline = matchedKb ? `${matchedKb.id}: ${matchedKb.title}` : localResult.headline;
          const intro    = matchedKb?.content ?? localResult.intro;
          const workaround = matchedKb?.steps ?? localResult.steps;
          aiStep = { from: 'ai', kind: 'known', headline, intro, workaround };
          this.SCENARIOS['__custom'].jira = matchedKb?.jira ?? (kbId ? 'CS-' + kbId.slice(-3) : undefined);
          this.SCENARIOS['__custom'].eta = matchedKb?.etaDays
            ? `Fix in progress — ~${matchedKb.etaDays} days`
            : 'Fix in progress';
        } else {
          const matchedKb = (kbId ? this.demo.kb.find(k => k.id === kbId) : null) ?? localResult.bestKb ?? null;
          const headline       = matchedKb ? `${matchedKb.id}: ${matchedKb.title}` : localResult.headline;
          const intro          = matchedKb?.content ?? localResult.intro;
          const resolutionSteps = matchedKb?.steps ?? localResult.steps;
          aiStep = { from: 'ai', kind: 'resolution', headline, intro, resolutionSteps };
        }

        if (thinkIdx !== -1) {
          stepsList[thinkIdx] = aiStep;
        } else {
          stepsList.push(aiStep);
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
          
          let chatHistory = '';
          const stepsSoFar = stepsList.filter(s => s && s.kind !== 'thinking' && s.kind !== 'classify' && s.kind !== 'ticket-form');
          if (stepsSoFar.length > 0) {
            chatHistory = stepsSoFar.map(s => {
              const sender = s.from === 'user' ? 'Customer' : 'AI';
              let content = s.text || '';
              if (s.kind === 'resolution' || s.kind === 'known') {
                content = `[Matched KB Article: ${s.headline || ''}] ${s.intro || ''}`;
                const steps = s.resolutionSteps || s.workaround || [];
                if (steps.length > 0) {
                  content += ' Steps: ' + steps.map((step, idx) => `${idx + 1}. ${step}`).join(' ');
                }
              } else if (s.kind === 'novel') {
                content = `[Escalation Details: ${s.headline || ''}] ${s.intro || ''}`;
              }
              return `${sender}: ${content}`;
            }).join('\n');
          }
          this.formDesc = msg + (chatHistory ? `\n\n=== Chat Transcript ===\n${chatHistory}` : '');
          
          this.formAttachment = attachment || null;
          this.formSubmitted = false;
          stepsList.push({ from: 'ai', kind: 'ticket-form' });
          this.n = stepsList.length;
          this.halted = true;
        } else {
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

    const fullDescription = this.formDesc.includes('=== Chat Transcript ===')
      ? this.formDesc
      : this.formDesc + (chatHistory ? `\n\n=== Chat Transcript ===\n${chatHistory}` : '');

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
    this.halted = false;
    this.demo.notify('Agent joined', 'A support specialist took over the conversation.', 'blue');
    setTimeout(() => this.scrollToBottom(), 50);
  }
  /** Contextual quick-reply chips — shown throughout the custom chat, not just at the start. */
  get dynamicChips(): string[] {
    // After an outcome (resolved / failed / notified) — show generic starters so the
    // user can easily report a new issue without retyping a full description.
    if (this.outcome) {
      return [...STARTER_CHIPS];
    }
    // After a chip-specific clarification: show the targeted sub-chips the bot asked about.
    if (this.activeSubChips) return [...this.activeSubChips, 'Different issue'];
    // Before any user interaction: show generic area-level starters.
    // These are intentionally brief and vague so the classifier routes through
    // the AREA_SUBCHIPS drill-down rather than jumping straight to a KB match.
    if (this.n <= 1) {
      return [...STARTER_CHIPS];
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
    if (this.formSubmitted) return false;
    // After an outcome the confirm buttons are gone — show fresh-start chips
    // so the user has a clear path to report a new issue.
    if (this.outcome) return true;
    if (this.halted) return false;               // clarify / confirm / ticket-form — AI needs specific input
    if (this.last?.kind === 'thinking') return false;  // AI is mid-response
    return true;
  }

  sendStarter(prompt: string) {
    this.composerText = prompt;
    this.lastChipLabel = prompt;
    this.onSend();
  }

  // ── Known Issues upfront panel ──────────────────────────────────────────────
  knownPanelOpen = false;
  expandedKnownIssueId: string | null = null;

  get knownBugs(): KbEntry[] {
    return this.demo.kb.filter(k => k.kind === 'known-bug');
  }

  toggleKnownIssue(id: string) {
    this.expandedKnownIssueId = this.expandedKnownIssueId === id ? null : id;
  }

  selectKnownIssue(kb: KbEntry) {
    const ticketId = `TCK-${2060 + this.demo.kb.indexOf(kb)}`;
    const knownScenario: Scenario = {
      id: '__known',
      label: kb.title,
      type: 2,
      confidence: 85,
      productArea: kb.tags[0] || 'General',
      priority: 'P2',
      summary: kb.title,
      jira: kb.jira,
      eta: kb.etaDays ? `Fix expected in ~${kb.etaDays} days` : undefined,
      kbId: kb.id,
      ticketId,
      steps: [
        {
          from: 'ai',
          kind: 'known',
          headline: "This is a known issue we're already fixing",
          intro: kb.content,
          workaround: kb.steps,
        },
      ],
    };
    this.SCENARIOS = { ...this.SCENARIOS, __known: knownScenario };
    this.sid = '__known';
    this.n = 1;
    this.halted = true;
    this.customTicketId = ticketId;
    this.expandedKnownIssueId = null;
    setTimeout(() => this.scrollToBottom(), 50);
  }

  get steps(): ScenarioStep[] { return this.scenario.steps; }
  get visible(): ScenarioStep[] { return this.steps.slice(0, this.n); }
  get classified(): boolean {
    return this.visible.some(s => s.kind === 'classify' || s.kind === 'resolution' || s.kind === 'known' || s.kind === 'novel' || s.kind === 'ticket-form');
  }
  get last(): ScenarioStep | null { return this.steps[this.n - 1] || null; }
  get pendingClarify(): boolean { return this.halted && !!this.last && this.last.kind === 'clarify'; }
  get pendingConfirm(): boolean {
    return this.halted && !this.outcome && !!this.last && (this.last.kind === 'resolution' || this.last.kind === 'known');
  }
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
    this.api.healthCheck().subscribe(ok => {
      this.backendMode = ok ? 'online' : 'offline';
    });
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

  refresh() {
    // Always reset to a clean custom session — never replay __known or __custom with stale state
    this.sid = 'custom';
    this.n = 0;
    this.halted = false;
    this.outcome = null;
    this.agentJoined = false;
    this.customTicketId = null;
    this.rephraseCount = 0;
    this.lastConfidence = 0;
    this.excludedKbIds = new Set();
    this.activeSubChips = null;
    this.knownPanelOpen = false;
    this.expandedKnownIssueId = null;
    this.formSubject = '';
    this.formArea = '';
    this.formPriority = 'P3';
    this.formDesc = '';
    this.formAttachment = null;
    this.formSubmitted = false;
    // Drop any custom/known scenarios so stale jira/eta can't bleed into the next session
    const { __custom, __known, ...rest } = this.SCENARIOS as any;
    this.SCENARIOS = rest;
    clearTimeout(this.timer);
    this.startPlayback();
    setTimeout(() => this.scrollToBottom(), 50);
  }
  replay() { this.refresh(); }

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

      if (step.kind === 'clarify' || step.kind === 'confirm' || step.kind === 'resolution' || step.kind === 'known') { this.halted = true; }
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
    this.halted = false;
    this.rephraseCount = 0;
    this.lastConfidence = 0;
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
    // Feedback loop: "still broken" reopens, flags the matched KB entry, and
    // dents AI accuracy in the dashboard.
    this.demo.recordReopened(this.scenario.kbId);
    this.demo.notify('Ticket reopened', 'Marked as still broken — re-routed to a specialist; KB entry flagged.', 'red');

    // Exclude the KB ID from future RAG matching in this session
    if (this.scenario.kbId) {
      this.excludedKbIds.add(this.scenario.kbId);
    }

    // Assemble clean visible steps history, filtering out confirm/classify steps
    const currentSteps = this.steps.slice(0, this.n);
    const cleanSteps = currentSteps.filter(s => s && s.kind !== 'confirm' && s.kind !== 'classify');

    // Add user message "Still broken"
    const userStep: ScenarioStep = { from: 'user', text: 'Still broken' };

    // Add continuation AI message
    const isKnown = this.scenario.type === 2 || (this.last && this.last.kind === 'known');
    const aiText = isKnown
      ? "I'm sorry that workaround didn't help. Let's find another solution. What else is happening, or is it one of these?"
      : "I'm sorry that didn't resolve the issue. Let's keep troubleshooting. What's still broken, or is it one of these?";
    const aiStep: ScenarioStep = { from: 'ai', text: aiText };

    const newSteps = [...cleanSteps, userStep, aiStep];

    // Convert scenario to custom
    const customScenario: Scenario = {
      id: '__custom',
      label: 'Your issue',
      type: this.scenario.type,
      confidence: this.scenario.confidence,
      productArea: this.scenario.productArea,
      priority: this.scenario.priority,
      summary: this.scenario.summary,
      steps: newSteps,
      kbId: this.scenario.kbId,
      ticketId: this.scenario.ticketId
    };

    this.SCENARIOS = { ...this.SCENARIOS, __custom: customScenario };
    this.sid = '__custom';
    this.n = newSteps.length;
    this.halted = false;
    this.outcome = null;
    this.rephraseCount = 0;
    this.lastConfidence = 0;

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
    if (!this.classified) return 'Pending';
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
