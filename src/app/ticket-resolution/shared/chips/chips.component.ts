import { Component, Input } from '@angular/core';
import { TYPE_META, ROUTE_META, RouteKey } from '../../ticket-data';

@Component({
  selector: 'app-tr-type-chip',
  template: `
    <span [style.display]="'inline-flex'" [style.alignItems]="'center'" [style.gap]="'6px'"
      [style.padding]="size === 'sm' ? '2px 8px' : '3px 10px'"
      style="border-radius:9999px;font-weight:600;white-space:nowrap;"
      [style.background]="m.soft" [style.color]="m.hex" [style.border]="'1px solid ' + m.border"
      [style.fontSize]="size === 'sm' ? '11px' : '12px'">
      <span [style.width]="'6px'" [style.height]="'6px'" style="border-radius:50%;flex-shrink:0;" [style.background]="m.hex"></span>
      {{ m.label }}<span *ngIf="withName" style="font-weight:500;opacity:.8;">&nbsp;· {{ m.name }}</span>
    </span>
  `,
})
export class TypeChipComponent {
  @Input() type!: number;
  @Input() withName = false;
  @Input() size: 'sm' | 'md' = 'md';
  get m() { return TYPE_META[this.type] || TYPE_META[3]; }
}

@Component({
  selector: 'app-tr-route-chip',
  template: `
    <span [style.display]="'inline-flex'" [style.alignItems]="'center'"
      [style.padding]="size === 'sm' ? '2px 8px' : '3px 10px'"
      style="border-radius:9999px;font-weight:600;white-space:nowrap;"
      [style.background]="m.soft" [style.color]="m.hex" [style.border]="'1px solid ' + m.hex + '33'"
      [style.fontSize]="size === 'sm' ? '11px' : '12px'">
      {{ m.label }}
    </span>
  `,
})
export class RouteChipComponent {
  @Input() route!: RouteKey;
  @Input() size: 'sm' | 'md' = 'md';
  get m() { return ROUTE_META[this.route] || ROUTE_META['approve']; }
}

@Component({
  selector: 'app-tr-priority-chip',
  template: `
    <span style="display:inline-flex;align-items:center;border-radius:6px;font-size:11px;font-weight:600;font-family:'Roboto Mono',monospace;"
      [style.padding]="'2px 8px'" [style.background]="t.bg" [style.color]="t.fg" [style.border]="'1px solid ' + t.br">
      {{ priority }}
    </span>
  `,
})
export class PriorityChipComponent {
  @Input() priority!: string;
  get t() {
    const m: Record<string, any> = {
      P1: { bg: 'var(--error-50)',   fg: 'var(--error-700)',   br: '#FECDCA' },
      P2: { bg: 'var(--warning-50)', fg: 'var(--warning-700)', br: '#FEDF89' },
      P3: { bg: 'var(--gray-100)',   fg: 'var(--gray-600)',    br: 'var(--gray-200)' },
    };
    return m[this.priority] || m['P3'];
  }
}
