import { describe, test } from "vitest";
import { Command, click, expect, given, placeholder, role, scene, text, type } from "foldkit/scene";
import { ConnectionState, CreateBoard, Message, Model, SetBoardUrl, update, view } from "../main";

const boardId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
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
const populated = Model.make({
  ...idle,
  boards: [{ id: boardId, title: "Project Alpha" }],
  selectedBoardId: boardId,
  notes: [
    {
      id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      boardId,
      text: "Investigate Jazz streaming",
      x: 40,
      y: 45,
      width: 240,
      height: 150,
      fill: "#fff1b6",
    },
  ],
});

describe("Patchboard Foldkit Scene tests", () => {
  test("shows an empty Jazz-backed workspace", () => {
    scene(
      { update, view },
      given(idle),
      expect(text("Patchboard")).toExist(),
      expect(text("Create a board to begin")).toExist(),
      expect(placeholder("New board title")).toExist(),
    );
  });

  test("board creation UI emits the correct Effect command", () => {
    scene(
      { update, view },
      given(idle),
      type(placeholder("New board title"), "Project Alpha"),
      click(role("button", { name: "+" })),
      Command.expectExact(CreateBoard({ title: "Project Alpha" })),
      Command.resolve(CreateBoard, Message.SucceededCreateBoard({ boardId })),
      Command.expectExact(SetBoardUrl({ boardId })),
      Command.resolve(SetBoardUrl, Message.SucceededSetBoardUrl()),
      expect(placeholder("Write a note…")).toExist(),
    );
  });

  test("renders Jazz snapshot as positioned cards with controls", () => {
    scene(
      { update, view },
      given(populated),
      expect(text("Project Alpha")).toExist(),
      expect(text("Investigate Jazz streaming")).toExist(),
      expect(role("button", { name: "Move note ↑" })).toExist(),
      expect(role("button", { name: "Add note" })).toExist(),
    );
  });
});
