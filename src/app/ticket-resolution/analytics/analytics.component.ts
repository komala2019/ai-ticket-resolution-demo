import { Component, OnInit, OnDestroy, ElementRef, ViewChild } from '@angular/core';
import { METRICS, TREND, MIX, FLYWHEEL, ROUTE_META } from '../ticket-data';
import { TicketResolutionApiService } from '../ticket-resolution-api.service';

@Component({
  selector: 'app-tr-analytics',
  templateUrl: './analytics.component.html',
  styleUrls: ['./analytics.component.scss'],
})
export class AnalyticsComponent implements OnInit, OnDestroy {
  @ViewChild('trendSvg', { static: false }) trendSvgRef!: ElementRef<SVGElement>;

  METRICS = METRICS;
  TREND = TREND;
  MIX = MIX;
  FLYWHEEL = FLYWHEEL;
  ROUTE_META = ROUTE_META;

  constructor(private api: TicketResolutionApiService) {}

  trendW = 680;
  trendH = 160;
  padL = 36; padR = 16; padT = 16; padB = 28;

  activeWheel: number | null = null;
  private raf = 0;
  animPct = 0;

  ngOnInit() {
    // Pull live metrics/trend; fall back to bundled data if backend is offline.
    this.api.getMetrics().subscribe(m => { if (m && m.length) this.METRICS = m; });
    this.api.getTrend().subscribe(t => { if (t && t.length) this.TREND = t; });
    this.animateTrend();
  }
  ngOnDestroy() { cancelAnimationFrame(this.raf); }

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

  get trendPoints(): string {
    const vals = this.TREND;
    const max = Math.max(...vals);
    const w = this.trendW - this.padL - this.padR;
    const h = this.trendH - this.padT - this.padB;
    return vals.map((v, i) => {
      const x = this.padL + (i / (vals.length - 1)) * w;
      const y = this.padT + h - (v / max) * h * this.animPct;
      return `${x},${y}`;
    }).join(' ');
  }

  get trendFillPoints(): string {
    const vals = this.TREND;
    const max = Math.max(...vals);
    const w = this.trendW - this.padL - this.padR;
    const h = this.trendH - this.padT - this.padB;
    const pts = vals.map((v, i) => {
      const x = this.padL + (i / (vals.length - 1)) * w;
      const y = this.padT + h - (v / max) * h * this.animPct;
      return `${x},${y}`;
    });
    const baseline = this.padT + h;
    return `${this.padL},${baseline} ` + pts.join(' ') + ` ${this.padL + w},${baseline}`;
  }

  xLabel(i: number): string {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return months[i % 12];
  }

  xLabelX(i: number): number {
    const w = this.trendW - this.padL - this.padR;
    return this.padL + (i / (this.TREND.length - 1)) * w;
  }

  xTicks(): number[] { return [0, 3, 6, 9, 13]; }

  yTick(pct: number): number {
    const h = this.trendH - this.padT - this.padB;
    return this.padT + h * (1 - pct);
  }

  get totalMix(): number { return MIX.reduce((s, m) => s + m.count, 0); }

  mixPct(m: { count: number }): number {
    return Math.round(m.count / this.totalMix * 100);
  }

  mixBarLeft(idx: number): string {
    let sum = 0;
    for (let i = 0; i < idx; i++) sum += MIX[i].count;
    return (sum / this.totalMix * 100) + '%';
  }

  wheelPath(i: number, total: number): string {
    const cx = 120, cy = 120, r = 80, sw = 26;
    const sliceAngle = (2 * Math.PI) / total;
    const gap = 0.08;
    const startAngle = i * sliceAngle - Math.PI / 2 + gap / 2;
    const endAngle = startAngle + sliceAngle - gap;
    const ri = r - sw / 2;
    const x1 = cx + ri * Math.cos(startAngle);
    const y1 = cy + ri * Math.sin(startAngle);
    const x2 = cx + ri * Math.cos(endAngle);
    const y2 = cy + ri * Math.sin(endAngle);
    const large = sliceAngle - gap > Math.PI ? 1 : 0;
    return `M ${x1} ${y1} A ${ri} ${ri} 0 ${large} 1 ${x2} ${y2}`;
  }

  wheelLabelPos(i: number, total: number): { x: number; y: number } {
    const cx = 120, cy = 120, r = 110;
    const sliceAngle = (2 * Math.PI) / total;
    const angle = i * sliceAngle - Math.PI / 2 + sliceAngle / 2;
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  }

  wheelColors = ['#2970FF','#0BA5EC','#16B364','#F79009','#F04438','#7A5AF8'];
}
