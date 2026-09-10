/**
 * Global AI-query stream manager.
 *
 * Streaming query state used to live inside <NLQueryPage /> component state,
 * which meant: navigating away from the page dropped the whole UI state, and
 * switching conversations / starting a new chat explicitly aborted the fetch.
 *
 * This module owns the stream state at module scope instead, so:
 * - Page navigation does NOT affect a running query — the fetch keeps going
 *   and the backend persists the result on `done`.
 * - Switching conversations does NOT abort the query; coming back to the
 *   conversation re-attaches to the live stream.
 * - Finished streams are kept until the conversation history (which by then
 *   contains the persisted exchange) replaces them.
 *
 * The page subscribes via useSyncExternalStore.
 */

import { executeNLQueryStream } from '../api/llm';
import type { ConnectionSchemaSelection, SSEEvent, NLQueryRequest } from '../types';

// ─── Types ────────────────────────────────────────────────────────

export type StreamBlockType = 'think' | 'sql' | 'result' | 'error' | 'summary';

export type StreamPhase =
  | 'connecting'   // request sent, waiting for first event
  | 'thinking'     // LLM streaming text
  | 'executing'    // SQL produced / executed
  | 'done'         // finished successfully
  | 'error'        // transport or fatal error (partial content kept)
  | 'stopped';     // manually stopped by the user (partial content kept)

export interface StreamBlock {
  key: number;
  type: StreamBlockType;
  content: string;
  columns?: string[];
  rows?: unknown[][];
  totalRows?: number;
}

export interface StreamScopeTag {
  key: string;
  text: string;
}

export interface QueryStream {
  uid: number;
  /** Conversation the query belongs to (known once the backend announces it). */
  conversationId: number | null;
  /** Conversation view the query was started from (null = new-chat view). */
  viewConversationId: number | null;
  /** Detached from any view (e.g. "new chat" was clicked while running). */
  hidden: boolean;
  question: string;
  scopeTags: StreamScopeTag[];
  blocks: StreamBlock[];
  think: string;
  llmTimeMs: number | null;
  phase: StreamPhase;
  error: string | null;
  startedAt: number;
  elapsed: number;
}

export function isActivePhase(phase: StreamPhase): boolean {
  return phase === 'connecting' || phase === 'thinking' || phase === 'executing';
}

export interface StartStreamParams {
  connectionName: string;
  connectionSchemas: ConnectionSchemaSelection[];
  llmConfigId: number;
  question: string;
  language: string;
  skillIds?: number[];
  /** Existing conversation id, or undefined to let the backend create one. */
  conversationId?: number;
  /** The view (conversation id or null for new chat) the stream renders in. */
  viewConversationId: number | null;
  scopeTags: StreamScopeTag[];
  /** Called when the backend announces the conversation id for this stream. */
  onConversationKnown?: (conversationId: number) => void;
  /** Called once when the stream settles (done, error or aborted). */
  onSettled?: () => void;
}

// ─── Manager ──────────────────────────────────────────────────────

const THINK_FLUSH_INTERVAL_MS = 50;
const ELAPSED_TICK_MS = 1000;

class QueryStreamManager {
  private streams: QueryStream[] = [];
  private snapshot: QueryStream[] = [];
  private listeners = new Set<() => void>();
  private nextUid = 1;
  private nextKey = 1;
  private thinkBuffers = new Map<number, string>();
  private flushTimers = new Map<number, ReturnType<typeof setInterval>>();
  private controllers = new Map<number, AbortController>();
  private onSettled = new Map<number, () => void>();
  private onConversationKnown = new Map<number, (conversationId: number) => void>();
  private ticker: ReturnType<typeof setInterval> | null = null;

  // ── useSyncExternalStore contract ──
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): QueryStream[] => this.snapshot;

  // ── Public actions ──

  start(params: StartStreamParams): number {
    const uid = this.nextUid++;
    const stream: QueryStream = {
      uid,
      conversationId: params.conversationId ?? null,
      viewConversationId: params.viewConversationId,
      hidden: false,
      question: params.question,
      scopeTags: params.scopeTags,
      blocks: [],
      think: '',
      llmTimeMs: null,
      phase: 'connecting',
      error: null,
      startedAt: Date.now(),
      elapsed: 0,
    };
    this.streams = [...this.streams, stream];
    this.emit();
    this.ensureTicker();

    if (params.onSettled) this.onSettled.set(uid, params.onSettled);
    if (params.onConversationKnown) this.onConversationKnown.set(uid, params.onConversationKnown);

    const request: NLQueryRequest = {
      connection_name: params.connectionName,
      connection_schemas: params.connectionSchemas,
      llm_config_id: params.llmConfigId,
      question: params.question,
      conversation_id: params.conversationId,
      language: params.language,
      skill_ids: params.skillIds,
    };

    const controller = executeNLQueryStream(
      request,
      (event) => this.handleEvent(uid, event),
      (msg) => this.fail(uid, msg),
      () => this.finish(uid),
    );
    this.controllers.set(uid, controller);
    return uid;
  }

  /** User pressed stop: keep partial content, mark as stopped. */
  abort(uid: number): void {
    this.controllers.get(uid)?.abort();
    this.flushThink(uid);
    this.stopFlushTimer(uid);
    this.patch(uid, () => ({ phase: 'stopped' }));
  }

  /**
   * "New chat" clicked: move streams that were rendering in the new-chat view
   * out of it (they keep running / stay visible in their own conversation).
   */
  detachFromNewChat(): void {
    let changed = false;
    this.streams = this.streams.map((q) => {
      if (q.viewConversationId === null && !q.hidden) {
        changed = true;
        return q.conversationId !== null
          ? { ...q, viewConversationId: q.conversationId }
          : { ...q, hidden: true };
      }
      return q;
    });
    if (changed) this.emit();
  }

  /**
   * Called when a conversation's persisted history has been loaded: finished
   * streams for that conversation are dropped because the DB rows now carry
   * the same content.
   */
  clearFinishedForConv(conversationId: number): void {
    const kept = this.streams.filter(
      (q) =>
        isActivePhase(q.phase) ||
        (q.conversationId !== conversationId && q.viewConversationId !== conversationId),
    );
    if (kept.length !== this.streams.length) {
      this.streams = kept;
      this.emit();
    }
  }

  dismissError(uid: number): void {
    this.patch(uid, () => ({ error: null }));
  }

  // ── Stream event handling ──

  private handleEvent(uid: number, event: SSEEvent): void {
    // Any event proves the stream is alive — make sure the elapsed ticker is
    // running (it self-stops when no stream is active).
    this.ensureTicker();
    switch (event.type) {
      case 'conversation': {
        const convId = event.conversation_id ?? null;
        this.patch(uid, () => ({ conversationId: convId }));
        if (convId !== null) {
          const cb = this.onConversationKnown.get(uid);
          cb?.(convId);
        }
        break;
      }
      case 'think':
        this.patch(uid, () => ({ phase: 'thinking' }));
        this.thinkBuffers.set(uid, (this.thinkBuffers.get(uid) || '') + (event.content || ''));
        this.ensureFlushTimer(uid);
        break;
      case 'sql':
        this.flushThink(uid);
        this.patch(uid, (q) => ({
          phase: 'executing',
          blocks: [...q.blocks, { key: this.nextBlockKey(), type: 'sql', content: event.content || '' }],
        }));
        break;
      case 'result':
        this.patch(uid, (q) => ({
          phase: 'executing',
          blocks: [
            ...q.blocks,
            {
              key: this.nextBlockKey(),
              type: 'result',
              content: '',
              columns: event.columns,
              rows: event.rows,
              totalRows: event.total_rows,
            },
          ],
        }));
        break;
      case 'error':
        // Non-fatal agent errors (SQL failure, bad tool args, LLM partial
        // timeout…) stream as blocks and the loop usually CONTINUES
        // afterwards. Keep the current active phase — flipping to 'error'
        // here would falsely render the "connection lost" tag mid-query and
        // could stop the elapsed ticker on a phase-flap tick.
        this.patch(uid, (q) => ({
          phase: isActivePhase(q.phase) ? q.phase : 'executing',
          blocks: [...q.blocks, { key: this.nextBlockKey(), type: 'error', content: event.message || '' }],
        }));
        break;
      case 'done': {
        // Drop the conclusion from the pending think content; it is shown once
        // as a dedicated "summary" block instead.
        this.flushThink(uid, event.message || '');
        this.patch(uid, (q) => ({
          phase: 'done',
          conversationId: event.conversation_id ?? q.conversationId,
          llmTimeMs: event.llm_time_ms ?? q.llmTimeMs,
          blocks:
            event.message && event.message.trim()
              ? [...q.blocks, { key: this.nextBlockKey(), type: 'summary', content: event.message }]
              : q.blocks,
        }));
        break;
      }
    }
  }

  /** Transport-level error (HTTP error, premature close, watchdog, network). */
  private fail(uid: number, msg: string): void {
    this.flushThink(uid);
    this.stopFlushTimer(uid);
    this.patch(uid, (q) => ({ phase: 'error', error: q.error ?? msg }));
  }

  /** Stream settled (any outcome). */
  private finish(uid: number): void {
    this.stopFlushTimer(uid);
    this.flushThink(uid);
    this.controllers.delete(uid);
    // Belt & braces: if the client reports completion while the stream was
    // never `done`/`error`/`stopped`, surface it instead of a silent stop.
    this.patch(uid, (q) =>
      isActivePhase(q.phase) ? { phase: 'error', error: q.error ?? '连接在查询完成前中断' } : {},
    );
    const cb = this.onSettled.get(uid);
    this.onSettled.delete(uid);
    this.onConversationKnown.delete(uid);
    cb?.();
    this.maybeStopTicker();
  }

  // ── Think buffer flushing ──

  private ensureFlushTimer(uid: number): void {
    if (this.flushTimers.has(uid)) return;
    const timer = setInterval(() => {
      const buf = this.thinkBuffers.get(uid) || '';
      if (buf) {
        this.thinkBuffers.set(uid, '');
        this.patch(uid, (q) => ({ think: q.think + buf }));
      }
    }, THINK_FLUSH_INTERVAL_MS);
    this.flushTimers.set(uid, timer);
  }

  private stopFlushTimer(uid: number): void {
    const timer = this.flushTimers.get(uid);
    if (timer) {
      clearInterval(timer);
      this.flushTimers.delete(uid);
    }
    // Flush whatever is left in the buffer into the visible text.
    const buf = this.thinkBuffers.get(uid) || '';
    if (buf) {
      this.thinkBuffers.set(uid, '');
      this.patch(uid, (q) => ({ think: q.think + buf }));
    }
  }

  /**
   * Move buffered + accumulated think text into a `think` block. When
   * `trimTail` is given, the tail (the final conclusion) is stripped — it is
   * rendered once as a summary block instead.
   */
  private flushThink(uid: number, trimTail?: string): void {
    const buf = this.thinkBuffers.get(uid) || '';
    this.thinkBuffers.set(uid, '');
    this.patch(uid, (q) => {
      let combined = q.think + buf;
      const tail = trimTail?.trimEnd();
      if (tail) {
        const trimmed = combined.trimEnd();
        if (trimmed.endsWith(tail)) {
          combined = trimmed.slice(0, trimmed.length - tail.length).trimEnd();
        }
      }
      const blocks = combined.trim()
        ? [...q.blocks, { key: this.nextBlockKey(), type: 'think' as const, content: combined }]
        : q.blocks;
      return { think: '', blocks };
    });
  }

  // ── Elapsed ticker ──

  private ensureTicker(): void {
    if (this.ticker) return;
    this.ticker = setInterval(() => {
      let anyActive = false;
      this.streams = this.streams.map((q) => {
        if (isActivePhase(q.phase)) {
          anyActive = true;
          return { ...q, elapsed: (Date.now() - q.startedAt) / 1000 };
        }
        return q;
      });
      if (anyActive) {
        this.emit();
      } else {
        this.stopTicker();
      }
    }, ELAPSED_TICK_MS);
  }

  private stopTicker(): void {
    if (this.ticker) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
  }

  private maybeStopTicker(): void {
    if (!this.streams.some((q) => isActivePhase(q.phase))) this.stopTicker();
  }

  // ── State plumbing ──

  private nextBlockKey(): number {
    return this.nextKey++;
  }

  private patch(uid: number, patcher: (q: QueryStream) => Partial<QueryStream>): void {
    this.streams = this.streams.map((q) => (q.uid === uid ? { ...q, ...patcher(q) } : q));
    this.emit();
  }

  private emit(): void {
    this.snapshot = [...this.streams];
    this.listeners.forEach((l) => l());
  }
}

export const queryStreamManager = new QueryStreamManager();
