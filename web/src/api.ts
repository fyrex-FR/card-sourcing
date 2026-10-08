import type { AlertDto, PreviewItemDto, SearchDto, StatusDto } from "../../src/web/dto";
import type { SearchInput } from "../../src/web/schemas";

export type { AlertDto, PreviewItemDto, SearchDto, StatusDto, SearchInput };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(response.status, data?.error ?? `Erreur ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  /** Vrai si la session est valide. */
  me: () =>
    request<{ ok: true }>("GET", "/api/me").then(
      () => true,
      (error: unknown) => {
        if (error instanceof ApiError && error.status === 401) return false;
        throw error;
      },
    ),
  requestLogin: () => request<{ sent: true }>("POST", "/api/auth/request"),
  verifyCode: (code: string) => request<{ ok: true }>("POST", "/api/auth/code", { code }),
  logout: () => request<{ ok: true }>("POST", "/api/auth/logout"),

  status: () => request<StatusDto>("GET", "/api/status"),
  setPaused: (paused: boolean) => request<{ paused: boolean }>("PUT", "/api/state", { paused }),

  searches: () => request<SearchDto[]>("GET", "/api/searches"),
  createSearch: (input: SearchInput) => request<SearchDto>("POST", "/api/searches", input),
  updateSearch: (id: number, patch: Partial<SearchInput> & { active?: boolean }) =>
    request<SearchDto>("PATCH", `/api/searches/${id}`, patch),
  deleteSearch: (id: number) => request<{ ok: true }>("DELETE", `/api/searches/${id}`),
  checkSearch: (id: number) => request<{ sent: number }>("POST", `/api/searches/${id}/check`),
  preview: (input: Omit<SearchInput, "endingWindowMin">) => request<PreviewItemDto[]>("POST", "/api/preview", input),

  alerts: (limit = 100) => request<AlertDto[]>("GET", `/api/alerts?limit=${limit}`),
  muteItem: (itemKey: string) => request<{ ok: true }>("POST", `/api/items/${encodeURIComponent(itemKey)}/mute`),

  blockedSellers: () => request<string[]>("GET", "/api/blocked-sellers"),
  blockSeller: (username: string) => request<{ ok: true }>("POST", "/api/blocked-sellers", { username }),
  unblockSeller: (username: string) => request<{ ok: true }>("DELETE", `/api/blocked-sellers/${encodeURIComponent(username)}`),
};
