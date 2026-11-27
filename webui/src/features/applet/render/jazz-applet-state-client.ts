/** Shared applet runtime state transport. No local IndexedDB is used on Jazz boards. */
export type JazzAppletState = {
  board_id: string; note_id: string;
  version: number; value: Record<string, unknown> | null;
};

export class JazzAppletStateError extends Error {
  readonly status: number;
  constructor(status: number) {
    super("Jazz applet state request failed with HTTP " + status);
    this.name = "JazzAppletStateError";
    this.status = status;
  }
}

const endpoint = "/patchboard-private/api/applet-state";
const ensureOk = (response: Response) => {
  if (!response.ok) throw new JazzAppletStateError(response.status);
  return response;
};

export async function readJazzAppletState(
  boardId: string, noteId: string,
): Promise<JazzAppletState> {
  const query = new URLSearchParams({ board_id: boardId, note_id: noteId });
  const res = ensureOk(await fetch(endpoint + "?" + query, {
    credentials: "include", cache: "no-store",
  }));
  return await res.json() as JazzAppletState;
}

export async function writeJazzAppletState(
  boardId: string, noteId: string, expectedVersion: number,
  value: Record<string, unknown>,
): Promise<JazzAppletState> {
  const res = ensureOk(await fetch(endpoint, {
    method: "POST", credentials: "include", cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      board_id: boardId, note_id: noteId,
      expected_version: expectedVersion, value,
    }),
  }));
  return await res.json() as JazzAppletState;
}
