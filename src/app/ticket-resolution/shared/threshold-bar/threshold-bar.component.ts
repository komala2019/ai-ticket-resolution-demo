import { Component, Input } from '@angular/core';
import { ROUTE_META, routeFor, Thresholds, RouteKey } from '../../ticket-data';

interface Band { from: number; to: number; route: RouteKey; }

@Component({
  selector: 'app-tr-threshold-bar',
  template: `
    <div style="width:100%;">
      <div [style.position]="'relative'" [style.height.px]="height" style="border-radius:8px;overflow:hidden;display:flex;" [style.box-shadow]="'inset 0 0 0 1px var(--gray-200)'">
        <div *ngFor="let b of bands; let i=index"
          [style.width]="b.w + '%'"
          [style.background]="b.route === route ? ROUTE_META[b.route].hex : ROUTE_META[b.route].soft"
          [style.border-right]="i < 3 ? '1px solid #fff' : 'none'"
          style="display:flex;align-items:center;justify-content:center;transition:width .25s,background .25s;">
          <span *ngIf="b.w > 9" [style.font-size.px]="10.5" style="font-weight:600;letter-spacing:0.04em;text-transform:uppercase;white-space:nowrap;padding:0 4px;"
            [style.color]="b.route === route ? '#fff' : ROUTE_META[b.route].hex">{{ ROUTE_META[b.route].short }}</span>
        </div>
        <!-- pointer -->
        <div *ngIf="showPointer" [style.left]="value + '%'" style="position:absolute;top:-4px;bottom:-4px;width:0;transition:left .4s cubic-bezier(.4,0,.2,1);">
          <div [style.border-color]="ROUTE_META[route].hex" style="position:absolute;top:0;left:-7px;width:14px;height:14px;background:#fff;border-radius:50%;box-shadow:0 4px 8px -2px rgba(16,24,40,.1);border-width:3px;border-style:solid;"></div>
          <div [style.background]="ROUTE_META[route].hex" style="position:absolute;top:13px;bottom:0;left:-1px;width:2px;"></div>
        </div>
      </div>
      <div *ngIf="showLabels" style="position:relative;height:16px;margin-top:4px;font-size:10.5px;color:var(--gray-400);font-family:'Roboto Mono',monospace;">
        <span *ngFor="let v of labelValues" [style.left]="v+'%'" style="position:absolute;transform:translateX(-50%);">{{ v }}</span>
      </div>
    </div>
  `,
})
export class ThresholdBarComponent {
  @Input() value = 0;
  @Input() thresholds!: Thresholds;
  @Input() height = 44;
  @Input() showPointer = true;
  @Input() showLabels = true;

  ROUTE_META = ROUTE_META;

  get t() { return this.thresholds || { auto: 90, approve: 75, rewrite: 50 }; }
  get route(): RouteKey { return routeFor(this.value, this.t); }

  get bands(): (Band & { w: number })[] {
    const t = this.t;
    return [
      { from: 0,         to: t.rewrite,  route: 'eng'     as RouteKey, w: t.rewrite },
      { from: t.rewrite, to: t.approve,  route: 'rewrite' as RouteKey, w: t.approve - t.rewrite },
      { from: t.approve, to: t.auto,     route: 'approve' as RouteKey, w: t.auto - t.approve },
      { from: t.auto,    to: 100,        route: 'auto'    as RouteKey, w: 100 - t.auto },
    ].filter(b => b.w > 0);
  }

  get labelValues() { const t = this.t; return [t.rewrite, t.approve, t.auto]; }
}
