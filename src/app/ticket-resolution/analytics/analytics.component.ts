import { Component, Input, OnInit, OnDestroy, ElementRef, ViewChild } from '@angular/core';
import { Subscription } from 'rxjs';
import { METRICS, TREND, ROUTE_META, Metric, Thresholds, routeFor } from '../ticket-data';
import { ActivityItem, DemoStateService } from '../demo-state.service';

@Component({
  selector: 'app-tr-analytics',
  templateUrl: './analytics.component.html',
  styleUrls: ['./analytics.component.scss'],
})
export class AnalyticsComponent implements OnInit, OnDestroy {
  @ViewChild('trendSvg', { static: false }) trendSvgRef!: ElementRef<SVGElement>;
  @Input() thresholds: Thresholds = { auto: 90, approve: 75, rewrite: 50 };

  metrics: Metric[] = [];
  trendValues: number[] = [];
  trendLabels: string[] = [];
  ROUTE_META = ROUTE_META;
  selectedDate = this.todayIso();
  private activitySub?: Subscription;

  constructor(private demo: DemoStateService) {}

  trendW = 680;
  trendH = 160;
  padL = 36; padR = 16; padT = 16; padB = 28;

  activeWheel: number | null = null;
  private raf = 0;
  animPct = 0;

  ngOnInit() {
    this.refreshAnalytics();
    this.activitySub = this.demo.activity$.subscribe(() => {
      if (this.isToday) this.refreshAnalytics();
    });
    this.animateTrend();
  }

  ngOnDestroy() {
    cancelAnimationFrame(this.raf);
    this.activitySub?.unsubscribe();
  }

  onDateChange(dateIso: string) {
    this.selectedDate = dateIso || this.todayIso();
    this.refreshAnalytics();
  }

  resetToToday() {
    this.selectedDate = this.todayIso();
    this.refreshAnalytics();
  }

  get isToday(): boolean {
    return this.selectedDate === this.todayIso();
  }

  get headerDateLabel(): string {
    return this.isToday ? 'Today' : this.formatDate(this.selectedDate);
  }

  get headerSubtext(): string {
    return this.isToday
      ? 'Live session analytics. Ticket actions update the cards and activity log immediately.'
      : 'Historical snapshot for the selected date.';
  }

  get routeCounts(): { route: keyof typeof ROUTE_META; count: number; label: string }[] {
    const counts: Record<keyof typeof ROUTE_META, number> = { auto: 0, approve: 0, rewrite: 0, eng: 0 };
    for (const t of this.demo.queue) {
      if (t.status) continue;
      const route = routeFor(t.confidence, this.thresholds);
      counts[route]++;
    }
    return (['auto', 'approve', 'rewrite', 'eng'] as const).map(route => ({
      route,
      count: counts[route],
      label: ROUTE_META[route].label,
    }));
  }

  get recentActivity(): ActivityItem[] {
    return this.demo.getActivityLog();
  }

  tooltipText(metric: Metric): string {
    const formulas: Record<string, string> = {
      'Deflection rate': 'Live formula: resolved ÷ (resolved + escalated) × 100. Current baseline uses 12 resolved and 1 escalated, so 12 ÷ 13 ≈ 92%.',
      'Avg. time to resolution': 'Live formula: 2.4 - 0.06 × resolved + 0.03 × reopened. This is the current estimate of hours to resolve from live session activity.',
      'AI resolution accuracy': 'Live formula: resolved ÷ (resolved + reopened) × 100. Higher reopen counts lower the score.',
      'Cost per ticket': 'Live formula: 11.6 - 0.12 × resolved + 0.05 × escalated + 0.08 × reopened. Lower is better.',
      'CS tickets / rep / week': 'Live formula: 36 - 0.45 × resolved + 0.15 × escalated + 0.10 × reopened. This estimates team load per rep.',
      'Auto-closed (no human)': 'Live formula: round(0.65 × resolved + 0.35 × escalated). This counts the tickets the AI can close without human touch.',
    };
    return 'Live KPI card for ' + metric.k + '. ' + metric.sub + '. ' + (formulas[metric.k] || 'This KPI is derived from the current session counters.');
  }

  get totalMix(): number {
    return this.demo.queue.filter(t => !t.status).length;
  }

  get trendMax(): number {
    return Math.max(1, ...this.trendValues);
  }

  xLabel(i: number): string {
    return this.trendLabels[i] ?? '';
  }

  xLabelX(i: number): number {
    const w = this.trendW - this.padL - this.padR;
    const last = Math.max(1, this.trendValues.length - 1);
    return this.padL + (i / last) * w;
  }

  xTicks(): number[] {
    return [0, 3, 6, 9, 13].filter(i => i < this.trendValues.length);
  }

  yTick(pct: number): number {
    const h = this.trendH - this.padT - this.padB;
    return this.padT + h * (1 - pct);
  }

  metricDeltaUp(metric: Metric): boolean {
    return metric.delta.trim().startsWith('+');
  }

  activityColor(kind: ActivityItem['kind']): string {
    switch (kind) {
      case 'resolved': return 'var(--success-600)';
      case 'escalated': return 'var(--purple-500)';
      case 'reopened': return 'var(--error-600)';
      case 'kb': return 'var(--primary-600)';
    }
  }

  get trendPoints(): string {
    const vals = this.trendValues;
    const max = this.trendMax;
    const w = this.trendW - this.padL - this.padR;
    const h = this.trendH - this.padT - this.padB;
    return vals.map((v, i) => {
      const x = this.padL + (i / Math.max(1, vals.length - 1)) * w;
      const y = this.padT + h - (v / max) * h * this.animPct;
      return `${x},${y}`;
    }).join(' ');
  }

  get trendFillPoints(): string {
    const vals = this.trendValues;
    const max = this.trendMax;
    const w = this.trendW - this.padL - this.padR;
    const h = this.trendH - this.padT - this.padB;
    const pts = vals.map((v, i) => {
      const x = this.padL + (i / Math.max(1, vals.length - 1)) * w;
      const y = this.padT + h - (v / max) * h * this.animPct;
      return `${x},${y}`;
    });
    const baseline = this.padT + h;
    return `${this.padL},${baseline} ${pts.join(' ')} ${this.padL + w},${baseline}`;
  }

  private refreshAnalytics() {
    this.metrics = this.isToday ? this.demo.getMetrics() : this.buildHistoricalMetrics(this.selectedDate);

    const deflection = this.metricNumber('Deflection rate');
    this.trendValues = this.buildTrendSeries(deflection);
    this.trendLabels = this.buildTrendLabels(this.selectedDate, this.trendValues.length);
  }

  private metricNumber(label: string): number {
    const metric = this.metrics.find(m => m.k === label);
    if (!metric) return 0;
    const parsed = Number(metric.now.replace(/[^0-9.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private buildHistoricalMetrics(dateIso: string): Metric[] {
    const seed = this.seedFromDate(dateIso);
    const resolved = 9 + (seed % 5);
    const escalated = 1 + (seed % 3);
    const reopened = seed % 4;
    const deflection = Math.round((resolved / (resolved + escalated)) * 100);
    const accuracy = Math.max(72, 94 - reopened * 4 - (seed % 3));
    const avgHours = Math.max(0.8, 2.4 - resolved * 0.06 + reopened * 0.03).toFixed(1);
    const cost = Math.max(4.8, 11.6 - resolved * 0.12 + escalated * 0.05 + reopened * 0.08).toFixed(2);
    const ticketsPerRep = Math.max(14, Math.round(36 - resolved * 0.45 + escalated * 0.15 + reopened * 0.1));
    const autoClosed = Math.max(1, Math.round(resolved * 0.65 + escalated * 0.35));

    return METRICS.map(metric => {
      switch (metric.k) {
        case 'Deflection rate':
          return { ...metric, now: deflection + '%', delta: '+' + (1 + (seed % 3)) + ' pts', sub: resolved + ' resolved · ' + escalated + ' escalated', good: true, pct: deflection };
        case 'Avg. time to resolution':
          return { ...metric, now: avgHours + ' hrs', delta: '−' + (10 + (seed % 5)) + ' days', sub: 'Type 2 / 3 issues', good: true };
        case 'AI resolution accuracy':
          return { ...metric, now: accuracy + '%', delta: '+' + (2 + (seed % 4)) + ' pts', sub: reopened + ' reopened (still broken)', good: reopened === 0, pct: accuracy };
        case 'Cost per ticket':
          return { ...metric, now: '$' + cost, delta: '−$' + (15 + (seed % 6)), sub: 'blended', good: true };
        case 'CS tickets / rep / week':
          return { ...metric, now: String(ticketsPerRep), delta: '−' + (30 + (seed % 12)), sub: 'down from 60–80', good: true };
        case 'Auto-closed (no human)':
          return { ...metric, now: String(autoClosed), delta: '+' + (20 + (seed % 10)) + ' pts', sub: 'auto-resolved on selected date', good: true, pct: autoClosed };
        default:
          return { ...metric };
      }
    });
  }

  private buildTrendSeries(endValue: number): number[] {
    const shape = TREND;
    const min = shape[0];
    const max = shape[shape.length - 1];
    const span = Math.max(1, max - min);
    const targetEnd = Math.max(0, Math.min(100, Math.round(endValue || max)));
    const targetStart = Math.max(0, Math.min(targetEnd, targetEnd - span));
    return shape.map(v => targetStart + ((v - min) / span) * (targetEnd - targetStart));
  }

  private buildTrendLabels(dateIso: string, len: number): string[] {
    const d = new Date(dateIso + 'T12:00:00');
    const labels: string[] = [];
    for (let i = len - 1; i >= 0; i--) {
      const day = new Date(d);
      day.setDate(d.getDate() - i);
      labels.push(new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(day));
    }
    return labels;
  }

  private seedFromDate(dateIso: string): number {
    return dateIso.split('-').reduce((sum, part) => sum + Number(part), 0);
  }

  private todayIso(): string {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
  }

  private formatDate(dateIso: string): string {
    const d = new Date(dateIso + 'T12:00:00');
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(d);
  }

  private animateTrend() {
    let start = 0;
    const dur = 900;
    const step = (ts: number) => {
      if (!start) start = ts;
      const t = Math.min((ts - start) / dur, 1);
      this.animPct = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      if (t < 1) this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }
}
