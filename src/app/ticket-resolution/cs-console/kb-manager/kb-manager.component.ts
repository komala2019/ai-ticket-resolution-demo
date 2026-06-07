import { Component, OnInit } from '@angular/core';
import { KB, KbEntry } from '../../ticket-data';
import { TicketResolutionApiService } from '../../ticket-resolution-api.service';

@Component({
  selector: 'app-tr-kb-manager',
  templateUrl: './kb-manager.component.html',
  styleUrls: ['./kb-manager.component.scss'],
})
export class KbManagerComponent implements OnInit {
  entries: KbEntry[] = KB.map(e => ({ ...e }));

  constructor(private api: TicketResolutionApiService) {}

  ngOnInit() {
    this.api.getKnowledgeBase().subscribe(list => { if (list && list.length) this.entries = list; });
  }
  query = '';
  editId: string | null = null;
  editTitle = '';
  editContent = '';
  editTags: string[] = [];
  showAdd = false;

  newTitle = '';
  newContent = '';
  newTags = '';

  get totalUses(): number { return this.entries.reduce((s, e) => s + (e.uses || 0), 0); }

  get filtered() {
    const q = this.query.toLowerCase();
    if (!q) return this.entries;
    return this.entries.filter(e =>
      e.title.toLowerCase().includes(q) ||
      e.content.toLowerCase().includes(q) ||
      e.tags.some((t: string) => t.toLowerCase().includes(q))
    );
  }

  startEdit(e: KbEntry) {
    this.editId = e.id;
    this.editTitle = e.title;
    this.editContent = e.content;
    this.editTags = [...e.tags];
  }

  saveEdit() {
    const e = this.entries.find(x => x.id === this.editId);
    if (e) {
      e.title = this.editTitle; e.content = this.editContent; e.tags = [...this.editTags];
      // Persist to backend (best-effort; local state already updated).
      this.api.updateKbEntry(e.id, e).subscribe();
    }
    this.editId = null;
  }

  cancelEdit() { this.editId = null; }

  addEntry() {
    const id = 'KB-' + String(this.entries.length + 1).padStart(3, '0');
    const entry: KbEntry = {
      id,
      title: this.newTitle,
      content: this.newContent,
      tags: this.newTags.split(',').map(s => s.trim()).filter(Boolean),
      uses: 0,
      updated: 'just now',
    };
    this.entries.push(entry);
    this.newTitle = ''; this.newContent = ''; this.newTags = '';
    this.showAdd = false;
    // Persist; if the backend assigns a different id, reconcile it.
    this.api.createKbEntry(entry).subscribe(created => {
      if (created && created.id && created.id !== entry.id) entry.id = created.id;
    });
  }

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
