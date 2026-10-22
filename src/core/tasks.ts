import crypto from 'node:crypto';
import type { TaskState } from '../shared/types';
import { CancelledError, describeError, UserError } from './errors';
import type { ProgressContext } from './source';

interface InternalTask<T = unknown> {
  state: TaskState<T>;
  controller: AbortController;
}

export interface TaskRunner extends ProgressContext {
  signal: AbortSignal;
}

/**
 * Gestionnaire de tâches longues (import, vérification, export).
 * L'interface interroge l'état par identifiant : aucune requête bloquante.
 */
export class TaskManager {
  private readonly tasks = new Map<string, InternalTask>();

  run<T>(label: string, work: (ctx: TaskRunner) => Promise<T>): string {
    const id = crypto.randomUUID();
    const controller = new AbortController();
    const state: TaskState<T> = {
      id,
      label,
      status: 'running',
      current: 0,
      total: 0,
      startedAt: Date.now(),
    };
    this.tasks.set(id, { state, controller } as InternalTask);

    const ctx: TaskRunner = {
      signal: controller.signal,
      isCancelled: () => controller.signal.aborted,
      onProgress: (current, total, detail) => {
        if (controller.signal.aborted) return;
        state.current = Math.max(0, Math.round(current));
        state.total = Math.max(0, Math.round(total));
        if (detail !== undefined) state.detail = detail;
      },
    };

    void (async () => {
      try {
        const result = await work(ctx);
        if (controller.signal.aborted) {
          state.status = 'cancelled';
          state.detail = 'Opération annulée.';
        } else {
          state.status = 'done';
          state.result = result;
          state.detail = 'Terminé';
        }
      } catch (error) {
        if (controller.signal.aborted || error instanceof CancelledError) {
          state.status = 'cancelled';
          state.detail = 'Opération annulée.';
        } else {
          state.status = 'error';
          state.error = error instanceof UserError ? error.message : describeError(error);
        }
      } finally {
        state.finishedAt = Date.now();
        this.prune();
      }
    })();

    return id;
  }

  get<T>(id: string): TaskState<T> | undefined {
    const task = this.tasks.get(id);
    return task ? (JSON.parse(JSON.stringify(task.state)) as TaskState<T>) : undefined;
  }

  cancel(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task || task.state.status !== 'running') return false;
    task.controller.abort();
    task.state.detail = 'Annulation en cours…';
    return true;
  }

  cancelAll(): void {
    for (const [id, task] of this.tasks) {
      if (task.state.status === 'running') this.cancel(id);
    }
  }

  private prune(): void {
    const finished = [...this.tasks.values()]
      .filter((task) => task.state.status !== 'running')
      .sort((a, b) => (a.state.finishedAt ?? 0) - (b.state.finishedAt ?? 0));
    while (finished.length > 30) {
      const oldest = finished.shift();
      if (oldest) this.tasks.delete(oldest.state.id);
    }
  }
}
