import { describe, expect, test } from "vitest";
import { Command, given, message, model, story } from "foldkit/story";
import { modifyFields } from "foldkit/struct";
import {
  ConnectionState,
  CreateBoard,
  CreateNote,
  Message,
  Model,
  MoveNote,
  SetBoardUrl,
  UpdateNote,
  update,
} from "../main";

const idle = Model.make({
  connection: ConnectionState.Ready(),
  boards: [],
  selectedBoardId: "",
  notes: [],
  boardTitleDraft: "",
  noteDraft: "",
  errorMessage: "",
  editingNoteId: "",
  editingNoteText: "",
  privateAuthStatus: "guest",
  privateAuthName: "",
  privateAuthId: "",
  privateAuthError: "",
  inviteToken: "",
  inviteUrl: "",
});

const boards = [
  { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", title: "Design" },
  { id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", title: "Planning" },
];

const note = {
  id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  boardId: boards[0]!.id,
  text: "Discuss architecture",
  x: 10,
  y: 20,
  width: 230,
  height: 140,
  fill: "#fff1b6",
};

describe("Patchboard Foldkit Story tests", () => {
  test("selects the first Jazz board after subscription emits", () => {
    story(
      update,
      given(idle),
      message(Message.ReceivedBoards({ boards })),
      Command.expectExact(SetBoardUrl({ boardId: boards[0]!.id })),
      Command.resolve(SetBoardUrl, Message.SucceededSetBoardUrl()),
      model((value) => {
        expect(value.selectedBoardId).toBe(boards[0]!.id);
        expect(value.boards).toHaveLength(2);
      }),
    );
  });

  test("preserves an existing selection across board updates", () => {
    story(
      update,
      given(modifyFields(idle, { selectedBoardId: () => boards[1]!.id })),
      message(Message.ReceivedBoards({ boards })),
      model((value) => expect(value.selectedBoardId).toBe(boards[1]!.id)),
    );
  });

  test("does not create empty boards", () => {
    story(
      update,
      given(modifyFields(idle, { boardTitleDraft: () => "   " })),
      message(Message.SubmittedBoard()),
      Command.expectNone(),
    );
  });

  test("trimmed create board action emits an Effect command", () => {
    story(
      update,
      given(modifyFields(idle, { boardTitleDraft: () => "  Roadmap  " })),
      message(Message.SubmittedBoard()),
      model((value) => expect(value.boardTitleDraft).toBe("")),
      Command.expectExact(CreateBoard({ title: "Roadmap" })),
      Command.resolve(CreateBoard, Message.SucceededCreateBoard({ boardId: boards[0]!.id })),
      Command.expectExact(SetBoardUrl({ boardId: boards[0]!.id })),
      Command.resolve(SetBoardUrl, Message.SucceededSetBoardUrl()),
    );
  });

  test("submitting a note emits Jazz-backed create operation", () => {
    story(
      update,
      given(
        modifyFields(idle, {
          selectedBoardId: () => boards[0]!.id,
          noteDraft: () => "  Review effects  ",
        }),
      ),
      message(Message.SubmittedNote()),
      Command.expectExact(
        CreateNote({
          boardId: boards[0]!.id,
          text: "Review effects",
          zIndex: 0,
        }),
      ),
      Command.resolve(CreateNote, Message.SucceededCreateNote()),
    );
  });

  test("moving a note clamps its coordinates to zero", () => {
    story(
      update,
      given(
        modifyFields(idle, {
          notes: () => [note],
          selectedBoardId: () => boards[0]!.id,
        }),
      ),
      message(Message.ClickedMoveNote({ id: note.id, dx: -30, dy: -40 })),
      Command.expectExact(MoveNote({ id: note.id, x: 0, y: 0 })),
      Command.resolve(MoveNote, Message.SucceededMoveNote()),
    );
  });

  test("rejects moves for an unknown note", () => {
    story(
      update,
      given(idle),
      message(Message.ClickedMoveNote({ id: "missing", dx: 1, dy: 1 })),
      Command.expectNone(),
    );
  });

  test("a failed note edit preserves the draft for retry", () => {
    story(
      update,
      given(
        modifyFields(idle, {
          notes: () => [note],
          selectedBoardId: () => boards[0]!.id,
          editingNoteId: () => note.id,
          editingNoteText: () => "Draft kept after rejection",
        }),
      ),
      message(Message.ClickedSaveNote({ id: note.id })),
      Command.expectExact(UpdateNote({ id: note.id, text: "Draft kept after rejection" })),
      Command.resolve(UpdateNote, Message.FailedAction({ error: "Write rejected" })),
      model((value) => {
        expect(value.editingNoteId).toBe(note.id);
        expect(value.editingNoteText).toBe("Draft kept after rejection");
        expect(value.errorMessage).toBe("Write rejected");
      }),
    );
  });

  test("confirmed note edit closes the editor only after the write succeeds", () => {
    story(
      update,
      given(
        modifyFields(idle, {
          notes: () => [note],
          selectedBoardId: () => boards[0]!.id,
          editingNoteId: () => note.id,
          editingNoteText: () => "Saved edit",
        }),
      ),
      message(Message.ClickedSaveNote({ id: note.id })),
      model((value) => {
        expect(value.editingNoteText).toBe("Saved edit");
        expect(value.editingNoteId).toBe(note.id);
      }),
      Command.expectExact(UpdateNote({ id: note.id, text: "Saved edit" })),
      Command.resolve(UpdateNote, Message.SucceededUpdateNote({ id: note.id })),
      model((value) => {
        expect(value.editingNoteId).toBe("");
        expect(value.editingNoteText).toBe("");
      }),
    );
  });

  test("ignores late note snapshots for a board that is no longer selected", () => {
    story(
      update,
      given(
        modifyFields(idle, {
          notes: () => [note],
          selectedBoardId: () => boards[0]!.id,
        }),
      ),
      message(Message.ReceivedNotes({ boardId: boards[1]!.id, notes: [] })),
      model((value) => {
        expect(value.notes).toEqual([note]);
      }),
    );
  });

  test("propagates Jazz write rejections visibly", () => {
    story(
      update,
      given(idle),
      message(Message.FailedAction({ error: "Write rejected by permissions" })),
      model((value) => expect(value.errorMessage).toBe("Write rejected by permissions")),
    );
  });
});
