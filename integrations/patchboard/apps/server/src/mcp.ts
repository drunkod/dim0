import type { IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { Effect } from "effect";
import { z } from "zod";
import type { Db } from "jazz-tools";
import { createMcpNote, DemoBoardMissing, readBoard, RequestIdConflict } from "./board-service.ts";

export async function handleBoardMcp(
  req: IncomingMessage,
  res: ServerResponse,
  db: Db,
  resolveBoard: () => string,
) {
  const server = new McpServer({ name: "patchboard", version: "0.1.0" });
  const transport = new StreamableHTTPServerTransport({});
  server.registerTool(
    "read_board",
    {
      description: "Read up to 50 notes on the connected Patchboard board.",
      annotations: { readOnlyHint: true },
      inputSchema: {},
    },
    async () => {
      const result = await Effect.runPromise(Effect.result(readBoard(db, resolveBoard())));
      if (result._tag === "Failure") {
        return { isError: true, content: [{ type: "text", text: "Board unavailable" }] };
      }
      return { content: [{ type: "text", text: JSON.stringify(result.success) }] };
    },
  );
  server.registerTool(
    "create_note",
    {
      description:
        "Create a text note on the connected Patchboard demo board. Supply a unique request_id to identify retries.",
      annotations: { readOnlyHint: false, destructiveHint: false },
      // Strict parsing also rejects caller-provided board_id / user_id overrides.
      inputSchema: z
        .object({
          text: z.string().trim().min(1).max(2000),
          request_id: z.string().trim().min(1).max(128),
        })
        .strict(),
    },
    async ({ text, request_id }) => {
      try {
        const created = await Effect.runPromise(
          createMcpNote(db, { boardId: resolveBoard(), text, requestId: request_id }),
        );
        return { content: [{ type: "text", text: JSON.stringify(created) }] };
      } catch (error) {
        const message =
          error instanceof RequestIdConflict
            ? "REQUEST_ID_CONFLICT: Reuse the original text or choose a new request_id"
            : error instanceof DemoBoardMissing
              ? "BOARD_UNAVAILABLE: The configured board was not found"
              : "WRITE_FAILED: Note could not be committed; check read_board before retrying";
        return { isError: true, content: [{ type: "text", text: message }] };
      }
    },
  );
  res.once("close", () => {
    void server.close().catch(() => {});
  });
  try {
    // SDK 1.29 declares onclose optional on Transport and explicitly undefined
    // on its Node adapter. Both represent an unset callback at runtime.
    await server.connect(transport as Transport);
    await transport.handleRequest(req, res);
  } catch {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
}
