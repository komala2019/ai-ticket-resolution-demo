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
  layers: Layer[] = [
    {
      name: 'Presentation layer',
      tone: 'blue',
      accent: 'var(--primary-600)',
      blurb: 'Angular components — the two perspectives and the shared visual primitives.',
      items: [
        { label: 'TicketResolutionComponent', sub: 'shell · view + tab state' },
        { label: 'CustomerChatComponent', sub: 'conversational flow' },
        { label: 'ApprovalQueue · TicketDetail · KbManager · Analytics', sub: 'CS console' },
        { label: 'Gauge · ThresholdBar · Chips', sub: 'shared widgets' },
      ],
    },
    {
      name: 'State & logic layer',
      tone: 'purple',
      accent: 'var(--purple-500)',
      blurb: 'Component-local state plus pure functions. No external store — inputs flow down, events bubble up.',
      items: [
        { label: 'thresholds: Thresholds', sub: 'auto / approve / rewrite' },
        { label: 'routeFor(score, thresholds)', sub: 'classification → route' },
        { label: 'queueCounts getter', sub: 'live re-bucketing' },
        { label: '@Input() / @Output()', sub: 'one-way data, event-up' },
      ],
    },
    {
      name: 'Data layer',
      tone: 'green',
      accent: 'var(--success-600)',
      blurb: 'Static, typed demo data in a single module. No HTTP, no backend dependency.',
      items: [
        { label: 'ticket-data.ts', sub: 'single source of truth' },
        { label: 'SCENARIOS · QUEUE · KB', sub: 'content' },
        { label: 'ROUTE_META · TYPE_META', sub: 'design tokens' },
        { label: 'METRICS · TREND · MIX · FLYWHEEL', sub: 'analytics' },
      ],
    },
  ];

  routeBands: RouteBand[] = [
    { label: 'Auto-resolve', range: '≥ 90', hex: 'var(--success-600)', human: 'No human touch' },
    { label: 'CS approval',  range: '75–89', hex: 'var(--primary-600)', human: 'CS approves or edits' },
    { label: 'CS rewrite',   range: '50–74', hex: 'var(--warning-600)', human: 'CS full review' },
    { label: 'Eng queue',    range: '< 50',  hex: 'var(--error-600)',   human: 'Eng manual resolution' },
  ];

  sequence: SeqStep[] = [
    { actor: 'customer', text: 'Describes the issue in plain language' },
    { actor: 'ai',       text: 'Asks targeted clarifying question(s)' },
    { actor: 'ai',       text: 'Matches against KB + 1,240 past tickets → confidence score' },
    { actor: 'ai',       text: 'routeFor() buckets the score into a route band' },
    { actor: 'cs',       text: 'If approval/rewrite: rep reviews the AI draft in the console' },
    { actor: 'eng',      text: 'If novel: escalation packaged with full context, routed P1' },
    { actor: 'customer', text: 'Confirms resolution — closure feeds the learning flywheel' },
  ];

  actorMeta: Record<string, { label: string; hex: string }> = {
    customer: { label: 'Customer', hex: 'var(--gray-600)' },
    ai:       { label: 'AI',       hex: 'var(--primary-600)' },
    cs:       { label: 'CS rep',   hex: 'var(--warning-600)' },
    eng:      { label: 'Eng',      hex: 'var(--purple-500)' },
  };

  decisions = [
    {
      title: 'Lazy-loaded, guard-free route',
      body: 'Registered before the guarded root route in app.routes.ts so /ticket-resolution resolves directly to TicketResolutionModule without triggering AuthGuard — the module is self-contained and needs no auth/backend.',
    },
    {
      title: 'Dark mode via token inheritance',
      body: 'The dark gray scale is redefined once on .tr-shell. Every child inherits the flipped --gray-* and --tr-surface custom properties through CSS cascade — no per-component media queries.',
    },
    {
      title: 'Pure routing function',
      body: 'routeFor(score, thresholds) is a pure function. Dragging the Tweaks sliders mutates thresholds; getters recompute the queue buckets reactively with zero side effects.',
    },
    {
      title: 'Unidirectional data flow',
      body: 'Shell owns thresholds and selection state; children receive @Input()s and emit @Output() events. Predictable, testable, no shared mutable store.',
    },
  ];
}
