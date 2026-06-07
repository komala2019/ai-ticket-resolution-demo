import { Component, Input, OnChanges, OnInit, OnDestroy } from '@angular/core';
import { ROUTE_META, routeFor, Thresholds, RouteKey } from '../../ticket-data';

@Component({
  selector: 'app-tr-confidence-gauge',
  template: `
    <div [style.position]="'relative'" [style.width.px]="size" [style.height.px]="size">
      <svg [attr.width]="size" [attr.height]="size" style="display:block;">
        <!-- track -->
        <path [attr.d]="arcPath(cx, cy, r, A0, A0+SWEEP)" fill="none" stroke="var(--gray-100)" [attr.stroke-width]="stroke" stroke-linecap="round"/>
        <!-- value -->
        <path [attr.d]="arcPath(cx, cy, r, A0, valAngle)" fill="none" [attr.stroke]="meta.hex" [attr.stroke-width]="stroke" stroke-linecap="round" style="transition:stroke .3s;"/>
        <!-- threshold ticks -->
        <ng-container *ngFor="let t of ticks">
          <line [attr.x1]="tickP1(t).x" [attr.y1]="tickP1(t).y" [attr.x2]="tickP2(t).x" [attr.y2]="tickP2(t).y" stroke="white" stroke-width="2.5"/>
        </ng-container>
      </svg>
      <div class="gauge-center">
        <span class="gauge-value">{{ displayed | number:'1.0-0' }}<span class="gauge-pct">%</span></span>
        <span class="gauge-route" [style.color]="meta.hex">{{ meta.short }}</span>
      </div>
    </div>
  `,
  styles: [`
    :host { display: inline-block; }
    .gauge-center { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px; }
    .gauge-value  { font-weight:700; line-height:1; color:var(--gray-900); letter-spacing:-0.03em; }
    .gauge-pct    { font-weight:400; color:var(--gray-400); }
    .gauge-route  { font-weight:600; text-transform:uppercase; letter-spacing:0.06em; }
  `],
})
export class ConfidenceGaugeComponent implements OnChanges, OnInit, OnDestroy {
  @Input() value = 0;
  @Input() thresholds!: Thresholds;
  @Input() size = 168;
  @Input() stroke = 14;

  A0 = 135; SWEEP = 270;
  displayed = 0;
  private raf: any; private backstop: any;

  get cx() { return this.size / 2; }
  get cy() { return this.size / 2; }
  get r()  { return (this.size - this.stroke) / 2; }

  get route(): RouteKey { return routeFor(this.value, this.thresholds || { auto: 90, approve: 75, rewrite: 50 }); }
  get meta()  { return ROUTE_META[this.route]; }
  get valAngle() { return this.A0 + (this.displayed / 100) * this.SWEEP; }
  get ticks() { const t = this.thresholds || { auto: 90, approve: 75, rewrite: 50 }; return [t.rewrite, t.approve, t.auto]; }

  get fontSize() { return this.size * 0.27; }
  get routeSize() { return this.size * 0.075; }
  get pctSize()   { return this.size * 0.12; }

  ngOnInit()    { this.animateTo(this.value); }
  ngOnChanges() { this.animateTo(this.value); }

  private animateTo(target: number) {
    cancelAnimationFrame(this.raf);
    clearTimeout(this.backstop);
    const from = this.displayed; const dur = 900; let start: number | null = null;
    const step = (t: number) => {
      if (!start) start = t;
      const p = Math.min(1, (t - start) / dur);
      const ease = 1 - Math.pow(1 - p, 3);
      this.displayed = from + (target - from) * ease;
      if (p < 1) this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
    this.backstop = setTimeout(() => { this.displayed = target; }, dur + 80);
  }

  polar(cx: number, cy: number, r: number, deg: number) {
    const a = (deg * Math.PI) / 180;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  }

  arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
    const s = this.polar(cx, cy, r, a0), e = this.polar(cx, cy, r, a1);
    const large = a1 - a0 <= 180 ? 0 : 1;
    return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`;
  }

  tickAngle(t: number) { return this.A0 + (t / 100) * this.SWEEP; }
  tickP1(t: number) { return this.polar(this.cx, this.cy, this.r - this.stroke / 2 - 2, this.tickAngle(t)); }
  tickP2(t: number) { return this.polar(this.cx, this.cy, this.r + this.stroke / 2 + 2, this.tickAngle(t)); }

  ngOnDestroy() { cancelAnimationFrame(this.raf); clearTimeout(this.backstop); }
}
