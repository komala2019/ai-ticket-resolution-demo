import { Component, Input } from '@angular/core';
import { Thresholds } from '../ticket-data';
import { GOLDEN_SET, GoldenCase } from '../golden-set';
import { classifyIssue } from '../local-classifier';
import { DemoStateService } from '../demo-state.service';

interface GoldenRow {
  c: GoldenCase;
  type: number;
  confidence: number;
  route: string;
  escalated: boolean;
  pass: boolean;
}

@Component({
  selector: 'app-tr-golden',
  templateUrl: './golden.component.html',
  styleUrls: ['./golden.component.scss'],
})
export class GoldenComponent {
  @Input() thresholds!: Thresholds;

  catLabel: Record<string, string> = {
    solvable: 'Type 3 · Solvable', known: 'Type 2 · Known', novel: 'Type 1 · Novel',
    edge: 'Edge case', adversarial: 'Adversarial',
  };

  customCases: GoldenCase[] = [];
  showAdd = false;

  // Form bindings
  newPrompt = '';
  newCategory: 'solvable' | 'known' | 'novel' | 'edge' | 'adversarial' = 'solvable';
  newExpectEscalate = false;
  newExpectType: number | null = 3;
  newNote = '';

  constructor(public demo: DemoStateService) {}

  addCase() {
    if (!this.newPrompt.trim()) return;
    const nextId = `G-Cust-${this.customCases.length + 1}`;
    const newCase: GoldenCase = {
      id: nextId,
      category: this.newCategory,
      prompt: this.newPrompt.trim(),
      expectEscalate: this.newExpectEscalate,
      expectType: this.newExpectType !== null ? this.newExpectType : undefined,
      note: this.newNote.trim() || 'Custom test case added during session.'
    };
    this.customCases = [...this.customCases, newCase];
    
    // Clear form
    this.newPrompt = '';
    this.newNote = '';
    this.showAdd = false;
    
    // Trigger notification
    this.demo.notify('Test case added', `Prompt "${newCase.prompt.substring(0, 20)}..." registered in Golden Set.`, 'purple');
  }

  deleteCustom(id: string) {
    this.customCases = this.customCases.filter(c => c.id !== id);
  }

  get rows(): GoldenRow[] {
    const t = this.thresholds || { auto: 90, approve: 75, rewrite: 50 };
    const all = [...GOLDEN_SET, ...this.customCases];
    return all.map(c => {
      const r = classifyIssue(c.prompt, this.demo.kb, t);
      const typeOk = c.expectType == null || r.type === c.expectType;
      const pass = r.escalated === c.expectEscalate && typeOk;
      return { c, type: r.type, confidence: r.confidence, route: r.route, escalated: r.escalated, pass };
    });
  }

  get passCount(): number { return this.rows.filter(r => r.pass).length; }
  get total(): number { return GOLDEN_SET.length + this.customCases.length; }
  get passRate(): number { return this.total > 0 ? Math.round((this.passCount / this.total) * 100) : 100; }
}
