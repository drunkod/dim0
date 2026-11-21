import { Effect } from "effect";
import type { JazzDb } from "jazz-tools/effect";
import { app } from "@patchboard/jazz-schema";
import { noteFields } from "@patchboard/jazz-schema/note-defaults";

/** Effect programs are separate from Foldkit's pure UI state machine. */
export const createBoard = Effect.fn("Board.create")(function* (
  jazz: JazzDb,
  userId: string,
  title: string,
) {
  return yield* jazz.insert(app.boards, { title, ownerId: userId }, { wait: "global" });
});

export const createNote = Effect.fn("Board.createNote")(function* (
  jazz: JazzDb,
  boardId: string,
  text: string,
  zIndex: number,
) {
  return yield* jazz.insert(app.shapes, noteFields(boardId, text, zIndex), { wait: "global" });
});

export const updateNote = Effect.fn("Board.updateNote")(function* (
  jazz: JazzDb,
  shapeId: string,
  text: string,
) {
  return yield* jazz.update(app.shapes, shapeId, { text }, { wait: "global" });
});

export const moveNote = Effect.fn("Board.moveNote")(function* (
  jazz: JazzDb,
  shapeId: string,
  x: number,
  y: number,
) {
  return yield* jazz.update(app.shapes, shapeId, { x, y }, { wait: "global" });
});
