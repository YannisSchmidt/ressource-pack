import type { RpcMethod } from '../shared/types';

interface RpcEnvelope {
  ok: boolean;
  result?: unknown;
  error?: { message?: string; code?: string; details?: string };
}

interface DesktopBridge {
  invoke(method: string, params: unknown): Promise<RpcEnvelope>;
}

declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}

export class ApiError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

export function isDesktop(): boolean {
  return Boolean(window.desktop);
}

export async function rpc<T>(method: RpcMethod | string, params: unknown = {}): Promise<T> {
  let envelope: RpcEnvelope;
  if (window.desktop) {
    envelope = await window.desktop.invoke(method, params);
  } else {
    const response = await fetch('/api/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, params }),
    });
    try {
      envelope = (await response.json()) as RpcEnvelope;
    } catch {
      throw new ApiError(`Le serveur local a renvoyé une réponse illisible (HTTP ${response.status}).`);
    }
    if (!response.ok && envelope.error?.message) {
      throw new ApiError(envelope.error.message, envelope.error.code);
    }
  }
  if (!envelope || envelope.ok !== true) {
    throw new ApiError(envelope?.error?.message ?? 'Erreur inconnue du service local.', envelope?.error?.code);
  }
  return envelope.result as T;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
