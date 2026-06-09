import { Component } from '@angular/core';

interface Layer {
  name: string;
  tone: string;
  accent: string;
  blurb: string;
  items: { label: string; sub?: string }[];
}

interface RouteBand { label: string; range: string; hex: string; human: string; }
interface SeqStep { actor: 'customer' | 'ai' | 'cs' | 'eng'; text: string; }

@Component({
  selector: 'app-tr-architecture',
  templateUrl: './architecture.component.html',
  styleUrls: ['./architecture.component.scss'],
})
export class ArchitectureComponent {
  activeTab: 'layers' | 'sequence' | 'decisions' | 'roadmap' = 'layers';

  layers: Layer[] = [
    {
      name: 'Presentation Layer',
      tone: 'blue',
      accent: 'var(--primary-600)',
      blurb: 'The interactive screens that customers and support agents use.',
      items: [
        { label: 'Customer Chat', sub: 'Known-issues panel + sub-chip drill-down + MarkdownPipe rendering + Human/Maya handoff' },
        { label: 'CS Console', sub: 'Approval Queue, KB Manager, Analytics with hover tooltips, Golden Set regression suite' },
        { label: 'Architecture & README docs', sub: 'In-app reference covering system design decisions, flow, and how-to-test guidance' },
      ],
    },
    {
      name: 'Intelligence & Routing',
      tone: 'purple',
      accent: 'var(--purple-500)',
      blurb: 'The logic that classifies messages, routes tickets, and generates or falls back to offline responses.',
      items: [
        { label: 'local-classifier.ts', sub: 'TF-IDF keyword scoring, isBugIntent, isVagueQuery, isChitChat, AREA_SUBCHIPS + CHIP_FOLLOW_UPS drill-down, pre-escalation + pre-resolution clarification' },
        { label: 'Routing engine', sub: '4-band threshold triage: auto-resolve (≥90) / CS approve (75–89) / CS rewrite (50–74) / eng queue (<50)' },
        { label: 'TicketResolutionApiService', sub: 'Online Claude/OpenAI draft generation with transparent offline fallback to local classifier' },
        { label: 'MarkdownPipe', sub: 'DomSanitizer.bypassSecurityTrustHtml — renders **bold**, *italic*, • bullets safely in chat bubbles' },
      ],
    },
    {
      name: 'Shared State & Data',
      tone: 'green',
      accent: 'var(--success-600)',
      blurb: 'The singleton service and static data files that power the entire demo.',
      items: [
        { label: 'DemoStateService', sub: 'Live KB, queue, metrics, notifications with per-item dismissal, activity log — single source of truth' },
        { label: 'ticket-data.ts', sub: 'KB-001–004, SCENARIOS (type1/type2/type3), QUEUE, METRICS, TREND baseline data' },
        { label: 'golden-set.ts', sub: 'Regression cases run live against the classifier on every threshold change in the Golden Set tab' },
      ],
    },
  ];

  routeBands: RouteBand[] = [
    { label: 'Auto-resolve', range: '>= 90', hex: 'var(--success-600)', human: 'No human touch' },
    { label: 'CS approval', range: '75-89', hex: 'var(--primary-600)', human: 'CS approves or edits' },
    { label: 'CS rewrite', range: '50-74', hex: 'var(--warning-600)', human: 'CS full review' },
    { label: 'Eng queue', range: '< 50', hex: 'var(--error-600)', human: 'Eng manual resolution' },
  ];

  sequence: SeqStep[] = [
    { actor: 'customer', text: 'Describes the issue in plain language' },
    { actor: 'ai', text: 'Asks targeted clarifying questions if details are missing' },
    { actor: 'ai', text: 'Searches knowledge base and past cases to calculate a confidence score' },
    { actor: 'ai', text: 'Categorizes the score into a route band (Auto-resolve, Review, or Escalation)' },
    { actor: 'cs', text: 'If review is needed, a customer support agent reviews the draft response' },
    { actor: 'eng', text: 'If it is a new or unknown issue, the AI escalates it to engineering with all diagnostics' },
    { actor: 'customer', text: 'Confirms if the solution worked, which helps train the AI' },
  ];

  actorMeta: Record<string, { label: string; hex: string }> = {
    customer: { label: 'Customer', hex: 'var(--gray-600)' },
    ai: { label: 'AI', hex: 'var(--primary-600)' },
    cs: { label: 'CS rep', hex: 'var(--warning-600)' },
    eng: { label: 'Eng', hex: 'var(--purple-500)' },
  };

  decisions = [
    {
      title: 'Known issues shown before first message',
      body: 'Before the customer types, active known-bug KB entries appear as an accordion. One click on "This is my issue" jumps straight to the workaround card using a synthetic __known scenario, cutting zero-value chat turns.',
    },
    {
      title: '[hidden] not *ngIf for chat state persistence',
      body: 'The customer chat component uses [hidden] instead of *ngIf so Angular never destroys it when the user switches to the CS console. All rephraseCount, chipLabel, and SCENARIOS state survives tab switches.',
    },
    {
      title: 'Multi-level chip drill-down prevents clarification loops',
      body: 'Area chips (AREA_SUBCHIPS) → sub-chips (CHIP_FOLLOW_UPS) form a two-level guided tree. Once the user picks a sub-chip, rephraseCount is set to a sentinel value (3) and the intentChanged reset is skipped, so the pre-escalation branch never re-fires mid drill-down.',
    },
    {
      title: 'All classification runs offline-first',
      body: 'The local classifier (TF-IDF keyword overlap + NOVEL_SIGNALS + isVagueQuery) runs on every message. The Claude/OpenAI backend is optional; if unreachable, the classifier\'s result is used directly, keeping the demo fully interactive offline.',
    },
    {
      title: 'DemoStateService as single source of truth',
      body: 'KB edits, queue updates, ticket resolutions, and notification dismissals all mutate the same singleton service. The analytics dashboard subscribes to activity$ and re-renders live KPI cards the moment an action fires.',
    },
    {
      title: 'MarkdownPipe for safe AI message rendering',
      body: 'AI message text containing **bold**, *italic*, and • bullet syntax is passed through MarkdownPipe, which escapes HTML first then converts markdown, then calls DomSanitizer.bypassSecurityTrustHtml — preventing XSS while enabling rich formatting.',
    },
    {
      title: 'Angular-driven tooltips replace CSS ::after',
      body: 'Analytics dashboard info icons use mouseenter/mouseleave + Angular *ngIf to render tooltip boxes below cards. This avoids the CSS ::after z-index/overflow problem where tooltips flew into the navigation bar.',
    },
  ];

  roadmap = [
    {
      title: 'Classification & Knowledge Retrieval',
      implemented: [
        { label: 'TF-IDF keyword scoring', desc: 'Weighted keyword overlap between the customer message and KB article content and tags.' },
        { label: 'AREA_SUBCHIPS + CHIP_FOLLOW_UPS drill-down', desc: 'Two-level guided clarification tree covering 5 product areas — no clarification loops.' },
        { label: 'Known-bug upfront panel', desc: 'Zero-click workaround for known KB entries displayed as an accordion before the conversation starts.' },
        { label: 'Exclusion list', desc: 'KB IDs excluded from future matches after "Still broken" fires in the same session.' },
      ],
      pending: [
        { label: 'Semantic vector embeddings', desc: 'Cosine similarity via OpenAI text-embedding-3-small — replaces keyword overlap for better multi-word matching.' },
        { label: 'Dedicated vector DB', desc: 'pgvector or Pinecone for sub-50ms KB retrieval at scale.' },
      ],
    },
    {
      title: 'AI Response Generation',
      implemented: [
        { label: 'Claude/OpenAI online draft generation', desc: 'TicketResolutionApiService sends message + KB context to /api/chat for a structured reply.' },
        { label: 'Offline fallback classifier', desc: 'local-classifier.ts produces headline, intro, and workaround steps without an LLM when the backend is unreachable.' },
        { label: 'MarkdownPipe', desc: 'Bold, italic, and bullet syntax rendered safely in chat bubbles via DomSanitizer.' },
        { label: 'Simulated agent replies', desc: 'getSimulatedAgentReply + getMayaFollowUpReply handle human-handoff turns contextually with auto follow-up.' },
      ],
      pending: [
        { label: 'Structured output via tool_use', desc: 'Force Claude to return JSON matching ScenarioStep schema — eliminates the parseResolutionText regex.' },
        { label: 'Feedback-loop fine-tuning', desc: 'Feed approved drafts and confirmed resolutions back as few-shot examples to improve future generation.' },
      ],
    },
    {
      title: 'State, Safety & Observability',
      implemented: [
        { label: 'DemoStateService singleton', desc: 'Live KB, queue, notifications with per-item dismiss, activity log, and analytics counters all in one place.' },
        { label: 'Golden Set regression suite', desc: '14 labeled cases run against the live classifier on every threshold change in the Golden Set tab.' },
        { label: '[hidden]-based chat persistence', desc: 'Conversation state survives view switches without component re-mount.' },
        { label: 'Chit-chat detection + adversarial guard', desc: 'isChitChat redirects to human; no KB match + injection prompt pattern routes to escalation.' },
      ],
      pending: [
        { label: 'Multi-turn conversation memory', desc: 'Store last N turns in a structured context window so follow-up messages have full conversation history.' },
        { label: 'Automated safety evaluation', desc: 'Nightly CI run of golden set against staging KB; fails build if pass rate drops below threshold.' },
      ],
    },
  ];
}
