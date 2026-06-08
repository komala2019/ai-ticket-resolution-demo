import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map, timeout } from 'rxjs/operators';
import {
  Thresholds, Scenario, QueueTicket, KbEntry, Metric,
  SCENARIOS, SCENARIO_ORDER, QUEUE, KB, METRICS, TREND,
} from './ticket-data';
import { DemoStateService } from './demo-state.service';

/** Result of the classify endpoint (the "AI" entry point). */
export interface ClassifyResponse {
  type: number;
  confidence: number;
  route: string;
  productArea: string;
  priority: string;
  canAutoResolve: boolean;
  headline: string;
  intro: string;
  steps: string[];
  evidence: { t: string; m: number }[];
  escalated: boolean;
  clarifyingQuestion?: string;
}

export interface ClassifyRequest {
  message: string;
  context?: string;
  productArea?: string;
}

export interface TicketActionResult {
  success: boolean;
  message: string;
  tone: string;
  ticket?: QueueTicket;
}

export interface ChatResponse {
  ok: boolean;
  route?: string;
  answer?: string;
  confidence?: number;
  model?: string;
  traceId?: string;
  context?: any[];
}

/**
 * Talks to the .NET backend at /api/ticket-resolution/*.
 *
 * Every read falls back to the bundled static demo data (ticket-data.ts) if
 * the backend is unreachable, so the module renders identically with or
 * without a running backend. Writes (KB CRUD, ticket actions) are best-effort:
 * callers update local state optimistically and these calls persist when the
 * backend is live.
 */
@Injectable({ providedIn: 'root' })
export class TicketResolutionApiService {
  private readonly base: string;
  private readonly headers = new HttpHeaders({ 'Content-Type': 'application/json' });
  /** Fail fast so a down/slow backend never leaves the UI hanging. */
  private readonly TIMEOUT = 5000;

  constructor(private http: HttpClient, private demo: DemoStateService) {
    // Standalone demo: no backend is deployed, so these calls fail fast and the
    // service falls back to the bundled data. Point this at a real
    // /api/ticket-resolution/ host to go live.
    this.base = '/api/ticket-resolution/';
  }

  // --- Thresholds ----------------------------------------------------------

  getThresholds(fallback: Thresholds): Observable<Thresholds> {
    return this.http.get<Thresholds>(this.base + 'thresholds')
      .pipe(timeout(this.TIMEOUT), catchError(() => of(fallback)));
  }

  updateThresholds(t: Thresholds): Observable<Thresholds> {
    return this.http.put<Thresholds>(this.base + 'thresholds', t, { headers: this.headers })
      .pipe(timeout(this.TIMEOUT), catchError(() => of(t)));
  }

  // --- Scenarios -----------------------------------------------------------

  /** Returns scenarios keyed by id (matching the SCENARIOS record shape). */
  getScenarios(): Observable<{ map: Record<string, Scenario>; order: string[] }> {
    return this.http.get<Scenario[]>(this.base + 'scenarios').pipe(
      timeout(this.TIMEOUT),
      map(list => ({
        map: list.reduce((acc, s) => { acc[s.id] = s; return acc; }, {} as Record<string, Scenario>),
        order: list.map(s => s.id),
      })),
      catchError(() => of({ map: SCENARIOS, order: SCENARIO_ORDER })),
    );
  }

  // --- Classification ------------------------------------------------------

  classify(request: ClassifyRequest): Observable<ClassifyResponse | null> {
    return this.http.post<ClassifyResponse>(this.base + 'classify', request, { headers: this.headers })
      .pipe(timeout(this.TIMEOUT), catchError(() => of(null)));
  }

  chat(message: string): Observable<ChatResponse> {
    return this.http.post<ChatResponse>('http://localhost:3001/api/chat', { message }, { headers: this.headers })
      .pipe(
        timeout(10000),
        catchError(() => of({
          ok: false,
          route: 'fallback',
          answer: 'The live assistant is currently unavailable. The demo flow is still available for exploration.',
          confidence: 0,
          model: 'demo-fallback',
        })),
      );
  }

  // --- Queue ---------------------------------------------------------------

  getQueue(): Observable<QueueTicket[]> {
    return this.http.get<QueueTicket[]>(this.base + 'queue')
      .pipe(timeout(this.TIMEOUT), catchError(() => of(this.demo.queue)));
  }

  getQueueCounts(fallback: Record<string, number>): Observable<Record<string, number>> {
    return this.http.get<Record<string, number>>(this.base + 'queue/counts')
      .pipe(timeout(this.TIMEOUT), catchError(() => of(fallback)));
  }

  approveTicket(id: string): Observable<TicketActionResult | null> {
    return this.http.post<TicketActionResult>(this.base + 'queue/' + id + '/approve', {}, { headers: this.headers })
      .pipe(timeout(this.TIMEOUT), catchError(() => of(null)));
  }

  escalateTicket(id: string, team?: string, note?: string): Observable<TicketActionResult | null> {
    return this.http.post<TicketActionResult>(this.base + 'queue/' + id + '/escalate', { team, note }, { headers: this.headers })
      .pipe(timeout(this.TIMEOUT), catchError(() => of(null)));
  }

  confirmTicket(id: string, fixed: boolean): Observable<TicketActionResult | null> {
    return this.http.post<TicketActionResult>(this.base + 'queue/' + id + '/confirm', { fixed }, { headers: this.headers })
      .pipe(timeout(this.TIMEOUT), catchError(() => of(null)));
  }

  // --- Knowledge base ------------------------------------------------------

  getKnowledgeBase(): Observable<KbEntry[]> {
    return this.http.get<KbEntry[]>(this.base + 'kb')
      .pipe(timeout(this.TIMEOUT), catchError(() => of(this.demo.kb)));
  }

  createKbEntry(entry: KbEntry): Observable<KbEntry | null> {
    return this.http.post<KbEntry>(this.base + 'kb', entry, { headers: this.headers })
      .pipe(timeout(this.TIMEOUT), catchError(() => of(null)));
  }

  updateKbEntry(id: string, entry: KbEntry): Observable<KbEntry | null> {
    return this.http.put<KbEntry>(this.base + 'kb/' + id, entry, { headers: this.headers })
      .pipe(timeout(this.TIMEOUT), catchError(() => of(null)));
  }

  deleteKbEntry(id: string): Observable<boolean> {
    return this.http.delete(this.base + 'kb/' + id)
      .pipe(timeout(this.TIMEOUT), map(() => true), catchError(() => of(false)));
  }

  // --- Analytics -----------------------------------------------------------

  getMetrics(): Observable<Metric[]> {
    return this.http.get<Metric[]>(this.base + 'metrics')
      .pipe(timeout(this.TIMEOUT), catchError(() => of(this.demo.getMetrics())));
  }

  getTrend(): Observable<number[]> {
    return this.http.get<number[]>(this.base + 'metrics/trend')
      .pipe(timeout(this.TIMEOUT), catchError(() => of(TREND)));
  }
}
