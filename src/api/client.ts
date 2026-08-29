/**
 * Small fetch wrapper shared by every API call in this app (real or mock). Centralised
 * here so timeout handling, error typing, and JSON parsing aren't duplicated per
 * endpoint, per the brief's "no duplicated API logic" instruction.
 */

export class ApiError extends Error {
  readonly status: number | null;
  readonly kind: "timeout" | "network" | "http" | "parse";

  constructor(message: string, kind: ApiError["kind"], status: number | null = null) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
  }
}

const DEFAULT_TIMEOUT_MS = 6000;

export async function fetchJson<T>(url: string, opts: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...init } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) {
      throw new ApiError(`Request to ${url} failed with status ${res.status}`, "http", res.status);
    }
    try {
      return (await res.json()) as T;
    } catch {
      throw new ApiError(`Request to ${url} returned invalid JSON`, "parse");
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new ApiError(`Request to ${url} timed out after ${timeoutMs}ms`, "timeout");
    }
    throw new ApiError(`Network error reaching ${url}: ${(err as Error).message}`, "network");
  } finally {
    clearTimeout(timer);
  }
}

/** Base URL for the real backend, from VITE_API_BASE_URL (see .env.example). Empty
 * string means "no backend configured" — callers should fall back to mock mode
 * rather than hard-coding localhost, per the brief's environment-config rule. */
export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? "";

export const IS_BACKEND_CONFIGURED = API_BASE_URL.trim().length > 0;
