import { Component } from '@angular/core';
import { DemoStateService } from '../demo-state.service';

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
  constructor(private demo: DemoStateService) {}

  openInteractiveSlides() {
    this.demo.viewState$.next('presentation');
  }

  activeTab: 'layers' | 'sequence' | 'decisions' | 'roadmap' = 'layers';

  layers: Layer[] = [
    {
      name: 'Presentation Layer',
      tone: 'blue',
      accent: 'var(--primary-600)',
      blurb: 'The screens customers and support agents interact with.',
      items: [
        { label: 'Customer Chat', sub: 'Conversational support window — shows known issues upfront, guides users through topic chips, formats AI replies, and hands off to a live agent on request' },
        { label: 'CS Console', sub: 'Agent workspace — approval queue for AI drafts, knowledge base editor, live analytics with explanatory tooltips, and a regression test suite' },
        { label: 'Architecture & README', sub: 'In-app documentation covering system design decisions, resolution flow, and step-by-step test walkthroughs' },
      ],
    },
    {
      name: 'Intelligence & Routing',
      tone: 'purple',
      accent: 'var(--purple-500)',
      blurb: 'The classification and response layer that decides what every message means and where it should go.',
      items: [
        { label: 'Classifier — online (LLM)', sub: 'When the backend is reachable, every message is sent to a Claude or OpenAI model with the full knowledge base as context — the model returns a confidence score, matched article, and draft resolution' },
        { label: 'Classifier — offline (keyword)', sub: 'When the backend is unreachable, a local keyword scorer runs entirely in the browser — detects product area, vague queries, and chit-chat, then guides the conversation through topic chips before scoring against the KB' },
        { label: 'Routing engine', sub: 'Splits every classified ticket into one of four confidence bands: auto-resolve, CS approval, CS rewrite, or engineering escalation — works identically whether the LLM or offline classifier ran' },
        { label: 'Message formatter', sub: 'Converts AI reply text containing bold, italic, and bullet syntax into safe rendered HTML shown in chat bubbles — injected scripts cannot execute' },
      ],
    },
    {
      name: 'Shared State & Data',
      tone: 'green',
      accent: 'var(--success-600)',
      blurb: 'The single data layer that keeps every tab in sync.',
      items: [
        { label: 'Demo state service', sub: 'One shared store for the knowledge base, ticket queue, analytics counters, notifications, and activity log — changes in one tab reflect everywhere instantly' },
        { label: 'Knowledge base & scenarios', sub: 'Four KB articles (booking, analytics, email, account) and pre-built demo scenarios covering all three resolution types' },
        { label: 'Golden test set', sub: '14 labeled test cases run live against the classifier so you can see how threshold changes affect routing in real time' },
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
      title: 'Known issues appear before the customer types',
      body: 'Active known-bug entries from the knowledge base are shown as a collapsible panel above the chat before the conversation starts. The customer can tap straight to the workaround with zero typing — bypassing classification entirely for issues the team is already tracking.',
    },
    {
      title: 'Chat history survives tab switches',
      body: 'The customer chat view is hidden when the agent navigates to the CS console, not destroyed. Conversation history, classification state, and scroll position all survive the switch and come back exactly as they were.',
    },
    {
      title: 'Topic chips eliminate clarification loops',
      body: 'When the classifier is uncertain, it shows broad area chips (Booking engine, Analytics…) then narrower sub-topic chips for the chosen area. Once the user picks a sub-topic the system classifies immediately — there is no way to get stuck in a loop asking the same question twice.',
    },
    {
      title: 'The demo works without internet',
      body: 'A keyword-based classifier runs entirely in the browser. If the cloud AI backend is unreachable, the app generates answers from the local knowledge base with no visible error — useful for demos where network access is unreliable.',
    },
    {
      title: 'One service owns all shared state',
      body: 'Resolving a ticket, editing a KB article, dismissing a notification, or reopening a case all update the same shared store. The analytics dashboard and the CS console read from the same live source — no manual sync between tabs.',
    },
    {
      title: 'AI reply text is rendered safely',
      body: 'AI messages can include bold headings, italic text, and bulleted steps. A formatter converts this syntax to HTML before display, but strips any raw HTML first so injected scripts cannot execute in the customer\'s browser.',
    },
    {
      title: 'Dashboard tooltips appear below cards, not above',
      body: 'Info tooltips on analytics cards are positioned below each card by the framework rather than by CSS. This avoids a common layout pitfall where "above the card" means "overlapping the navigation bar" for cards in the top row.',
    },
  ];

  roadmap = [
    {
      title: 'Classification & Knowledge Retrieval',
      implemented: [
        { label: 'LLM classification (online)', desc: 'When connected, Claude or OpenAI scores the message against the knowledge base and returns a structured confidence score and matched article.' },
        { label: 'Keyword classification (offline)', desc: 'When the backend is unreachable, a browser-side scorer uses weighted keyword overlap to find the closest KB match — no network needed.' },
        { label: 'Two-level topic guidance', desc: 'Broad area chips expand into specific sub-topic chips across five product areas — eliminates clarification loops in both modes.' },
        { label: 'Known-issue panel', desc: 'Zero-typing path to workarounds: active known bugs appear as a collapsible panel before the conversation starts.' },
        { label: 'Exclusion list', desc: 'Articles matched in a previous attempt are skipped after the customer says "Still broken" — avoids serving the same answer twice.' },
      ],
      pending: [
        { label: 'Semantic search', desc: 'Similarity-based retrieval against article embeddings — better multi-word and paraphrase matching than keyword overlap alone.' },
        { label: 'Vector database', desc: 'Dedicated article index for sub-50 ms retrieval at production scale.' },
      ],
    },
    {
      title: 'AI Response Generation',
      implemented: [
        { label: 'Cloud AI backend', desc: 'Sends the message and matching KB context to a Claude or OpenAI endpoint and returns a structured draft reply.' },
        { label: 'Offline fallback', desc: 'Generates a complete headline, introduction, and step-by-step workaround locally when the backend is unreachable.' },
        { label: 'Rich text formatting', desc: 'Bold, italic, and bullet syntax in AI replies is rendered safely in chat bubbles.' },
        { label: 'Simulated agent replies', desc: 'Human-handoff turns are handled with contextual auto-responses and a follow-up when the first reply is a placeholder.' },
      ],
      pending: [
        { label: 'Structured AI output', desc: 'Force the AI to return typed JSON — removes the text-parsing step and makes response handling more reliable.' },
        { label: 'Feedback fine-tuning', desc: 'Feed approved drafts and confirmed resolutions back as few-shot examples to improve future AI responses.' },
      ],
    },
    {
      title: 'State, Safety & Observability',
      implemented: [
        { label: 'Shared state service', desc: 'Knowledge base, queue, notifications, and analytics counters in one place — every tab reads from the same live source.' },
        { label: 'Golden set regression suite', desc: '14 labeled test cases run against the live classifier so threshold changes are immediately reflected in results.' },
        { label: 'Chat state persistence', desc: 'Conversation state survives view switches — the chat is hidden while away, not re-mounted.' },
        { label: 'Chit-chat and injection guard', desc: 'Off-topic messages redirect to a human agent; prompt injection patterns are routed to escalation rather than the KB.' },
      ],
      pending: [
        { label: 'Multi-turn memory', desc: 'Store the last N turns in context so follow-up messages build naturally on what was already discussed.' },
        { label: 'Automated safety evaluation', desc: 'Nightly test run of the golden set against staging — fails the build if the pass rate drops below a set threshold.' },
      ],
    },
  ];
}
