export interface HistoryEntry<T> {
  state: T;
  label: string;
  bytes: number;
}

export interface HistoryOptions<T> {
  limit?: number;
  maxBytes?: number;
  measure?: (state: T) => number;
}

/**
 * Historique annuler/rétablir générique, borné en nombre d'états et en mémoire.
 * Utilisé par l'éditeur d'image (pixels) et par l'éditeur de texte.
 */
export class History<T> {
  private undoStack: HistoryEntry<T>[] = [];
  private redoStack: HistoryEntry<T>[] = [];
  private readonly limit: number;
  private readonly maxBytes: number;
  private readonly measure: (state: T) => number;
  private totalBytes = 0;

  constructor(options: HistoryOptions<T> = {}) {
    this.limit = options.limit ?? 40;
    this.maxBytes = options.maxBytes ?? 96 * 1024 * 1024;
    this.measure = options.measure ?? (() => 0);
  }

  push(state: T, label: string): void {
    const entry: HistoryEntry<T> = { state, label, bytes: this.measure(state) };
    this.undoStack.push(entry);
    this.totalBytes += entry.bytes;
    this.redoStack = [];
    this.trim();
  }

  undo(current: T): HistoryEntry<T> | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.totalBytes -= entry.bytes;
    this.redoStack.push({ state: current, label: entry.label, bytes: this.measure(current) });
    return entry;
  }

  redo(current: T): HistoryEntry<T> | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    const bytes = this.measure(entry.state);
    this.undoStack.push({ state: current, label: entry.label, bytes: this.measure(current) });
    this.totalBytes += this.measure(current);
    void bytes;
    return entry;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get undoLabel(): string {
    return this.undoStack[this.undoStack.length - 1]?.label ?? '';
  }

  get redoLabel(): string {
    return this.redoStack[this.redoStack.length - 1]?.label ?? '';
  }

  get depth(): number {
    return this.undoStack.length;
  }

  get bytes(): number {
    return this.totalBytes + this.redoStack.reduce((sum, entry) => sum + entry.bytes, 0);
  }

  reset(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.totalBytes = 0;
  }

  private trim(): void {
    while (this.undoStack.length > this.limit) {
      const removed = this.undoStack.shift();
      if (removed) this.totalBytes -= removed.bytes;
    }
    while (this.totalBytes > this.maxBytes && this.undoStack.length > 1) {
      const removed = this.undoStack.shift();
      if (removed) this.totalBytes -= removed.bytes;
    }
    if (!Number.isFinite(this.totalBytes) || this.totalBytes < 0) this.totalBytes = 0;
  }
}
