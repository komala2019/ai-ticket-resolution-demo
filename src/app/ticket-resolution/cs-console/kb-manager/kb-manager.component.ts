import { Component, OnInit, OnDestroy } from '@angular/core';
import { KbEntry } from '../../ticket-data';
import { DemoStateService } from '../../demo-state.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-tr-kb-manager',
  templateUrl: './kb-manager.component.html',
  styleUrls: ['./kb-manager.component.scss'],
})
export class KbManagerComponent implements OnInit, OnDestroy {
  query = '';
  editId: string | null = null;
  editTitle = '';
  editContent = '';
  editTags: string[] = [];
  showAdd = false;

  newTitle = '';
  newContent = '';
  newTags = '';
  private sub?: Subscription;

  // The shared, live knowledge base — the SAME list the chat classifier reads,
  // so anything added/edited here immediately changes how issues resolve.
  constructor(public demo: DemoStateService) {}

  ngOnInit() {
    this.sub = this.demo.kbQuery$.subscribe(q => {
      this.query = q || '';
    });
  }

  ngOnDestroy() {
    if (this.sub) this.sub.unsubscribe();
  }

  get entries(): KbEntry[] { return this.demo.kb; }

  get totalUses(): number { return this.entries.reduce((s, e) => s + (e.uses || 0), 0); }

  get filtered() {
    const q = this.query.toLowerCase();
    if (!q) return this.entries;
    return this.entries.filter(e =>
      e.title.toLowerCase().includes(q) ||
      e.content.toLowerCase().includes(q) ||
      e.tags.some((t: string) => t.toLowerCase().includes(q)),
    );
  }

  startEdit(e: KbEntry) {
    this.editId = e.id;
    this.editTitle = e.title;
    this.editContent = e.content;
    this.editTags = [...e.tags];
  }

  saveEdit() {
    if (this.editId) {
      this.demo.updateKb(this.editId, {
        title: this.editTitle,
        content: this.editContent,
        tags: [...this.editTags],
        updated: 'just now',
        flagged: false,
      });
    }
    this.editId = null;
  }

  cancelEdit() { this.editId = null; }

  addEntry() {
    if (!this.newTitle.trim()) { this.showAdd = false; return; }
    const maxId = Math.max(...this.entries.map(e => parseInt(e.id.replace('KB-', ''), 10) || 0), 4);
    const id = 'KB-' + String(maxId + 1).padStart(3, '0');
    const entry: KbEntry = {
      id,
      title: this.newTitle,
      content: this.newContent,
      tags: this.newTags.split(',').map(s => s.trim()).filter(Boolean),
      uses: 0,
      updated: 'just now',
    };
    this.demo.addKb(entry);
    this.demo.notify('Knowledge article added', entry.title + ' is now live — the assistant can match against it.', 'green');
    this.newTitle = ''; this.newContent = ''; this.newTags = '';
    this.showAdd = false;
  }

  removeEntry(e: KbEntry) { this.demo.deleteKb(e.id); }

  removeTag(i: number) { this.editTags.splice(i, 1); }

  addTag(ev: KeyboardEvent) {
    const inp = ev.target as HTMLInputElement;
    if (ev.key === 'Enter' && inp.value.trim()) {
      this.editTags.push(inp.value.trim());
      inp.value = '';
      ev.preventDefault();
    }
  }
}
