import { Effect, Option, Schema, Stream } from "effect";
import { createJazzClient } from "jazz-tools/client";
import { Jazz, type JazzDb } from "jazz-tools/effect";
import { Command, ManagedResource, Runtime, Subscription, type Update } from "foldkit";
import type { Document, Html, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";
import { defineTaggedUnion } from "foldkit/schema";
import { modifyFields } from "foldkit/struct";
import { Input } from "@foldkit/ui";

import { app } from "@patchboard/jazz-schema";
import { createBoard, createNote, moveNote, updateNote } from "./board/jazz-effects";

const privateMode = import.meta.env.VITE_PATCHBOARD_PRIVATE === "1";

const BoardSummary = Schema.Struct({ id: Schema.String, title: Schema.String });
type BoardSummary = typeof BoardSummary.Type;
const NoteView = Schema.Struct({
  id: Schema.String,
  boardId: Schema.String,
  text: Schema.String,
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
  fill: Schema.String,
  authorId: Schema.optional(Schema.String),
  authorName: Schema.optional(Schema.String),
});
type NoteView = typeof NoteView.Type;

type BoardSession = { jazz: JazzDb; userId: string };
const BoardConnection = ManagedResource.tag<BoardSession>()("BoardConnection");
type BoardConnectionService = ManagedResource.ServiceOf<typeof BoardConnection>;

export const ConnectionState = defineTaggedUnion({
  Connecting: {},
  Ready: {},
  Failed: { error: Schema.String },
});
export type ConnectionState = typeof ConnectionState.Type;

export const Model = Schema.Struct({
  connection: ConnectionState,
  boards: Schema.Array(BoardSummary),
  selectedBoardId: Schema.String,
  notes: Schema.Array(NoteView),
  boardTitleDraft: Schema.String,
  noteDraft: Schema.String,
  errorMessage: Schema.String,
  editingNoteId: Schema.String,
  editingNoteText: Schema.String,
  privateAuthStatus: Schema.String,
  privateAuthName: Schema.String,
  privateAuthId: Schema.String,
  privateAuthError: Schema.String,
  inviteToken: Schema.String,
  inviteUrl: Schema.String,
});
export type Model = typeof Model.Type;

export const Message = defineMessageUnion({
  Connected: {},
  Disconnected: {},
  FailedConnect: { error: Schema.String },
  ReceivedBoards: { boards: Schema.Array(BoardSummary) },
  ReceivedNotes: { boardId: Schema.String, notes: Schema.Array(NoteView) },
  ClickedSelectBoard: { boardId: Schema.String },
  UpdatedBoardTitleDraft: { value: Schema.String },
  UpdatedNoteDraft: { value: Schema.String },
  SubmittedBoard: {},
  SubmittedNote: {},
  ClickedMoveNote: { id: Schema.String, dx: Schema.Number, dy: Schema.Number },
  ClickedEditNote: { id: Schema.String },
  UpdatedNoteText: { id: Schema.String, value: Schema.String },
  ClickedSaveNote: { id: Schema.String },
  SucceededCreateBoard: { boardId: Schema.String },
  SucceededCreateNote: {},
  SucceededMoveNote: {},
  SucceededUpdateNote: { id: Schema.String },
  SucceededSetBoardUrl: {},
  FailedAction: { error: Schema.String },
  PrivateAuthResolved: { signedIn: Schema.Boolean, id: Schema.String, name: Schema.String },
  PrivateAuthFailed: { error: Schema.String },
  ClickedCreatePrivateAccount: {},
  ClickedPrivateSignIn: {},
  ClickedPrivateSignOut: {},
  ClickedInvite: { role: Schema.String },
  InviteCreated: { url: Schema.String },
  ClickedAcceptInvite: {},
  InviteAccepted: {},
});
export type Message = typeof Message.Type;

type UpdateReturn = Update.Return<Model, Message, BoardConnectionService>;

export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    PrivateAuthResolved: ({ signedIn, id, name }) => ({
      model: modifyFields(model, {
        privateAuthStatus: () => signedIn ? "signedIn" : "signedOut",
        privateAuthId: () => signedIn ? id : "",
        privateAuthName: () => signedIn ? name : "",
        privateAuthError: () => "",
        boards: () => signedIn ? model.boards : [],
        notes: () => signedIn ? model.notes : [],
      }),
    }),
    PrivateAuthFailed: ({ error }) => ({
      model: modifyFields(model, {
        privateAuthStatus: () => "signedOut",
        privateAuthError: () => error,
        boards: () => [],
        notes: () => [],
      }),
    }),
    ClickedCreatePrivateAccount: () => ({
      model: modifyFields(model, { privateAuthStatus: () => "busy", privateAuthError: () => "" }),
      commands: [CreatePrivateAccount()],
    }),
    ClickedPrivateSignIn: () => ({
      model: modifyFields(model, { privateAuthStatus: () => "busy", privateAuthError: () => "" }),
      commands: [SignInPrivateAccount()],
    }),
    ClickedPrivateSignOut: () => ({
      model: modifyFields(model, {
        privateAuthStatus: () => "busy", boards: () => [], notes: () => [],
        privateAuthError: () => "",
      }),
      commands: [SignOutPrivateAccount()],
    }),
    ClickedInvite: ({ role }) => model.selectedBoardId ? ({
      model: modifyFields(model, { inviteUrl: () => "" }),
      commands: [CreatePrivateInvite({ boardId: model.selectedBoardId, role })],
    }) : ({ model }),
    InviteCreated: ({ url }) => ({
      model: modifyFields(model, { inviteUrl: () => url }),
    }),
    ClickedAcceptInvite: () => model.inviteToken && model.selectedBoardId ? ({
      model,
      commands: [AcceptPrivateInvite({ boardId: model.selectedBoardId, token: model.inviteToken })],
    }) : ({ model }),
    InviteAccepted: () => ({
      model: modifyFields(model, { inviteToken: () => "" }),
      commands: [FinishPrivateInvite()],
    }),
    Connected: () => ({
      model: modifyFields(model, { connection: () => ConnectionState.Ready() }),
    }),
    Disconnected: () => ({
      model: modifyFields(model, { connection: () => ConnectionState.Connecting() }),
    }),
    FailedConnect: ({ error }) => ({
      model: modifyFields(model, { connection: () => ConnectionState.Failed({ error }) }),
    }),
    ReceivedBoards: ({ boards }) => {
      const previous = model.selectedBoardId;
      const selectedBoardId =
        !boards.length || boards.some((board) => board.id === previous) ? previous : boards[0]!.id;
      return {
        model: modifyFields(model, {
          boards: () => boards,
          selectedBoardId: () => selectedBoardId,
          notes: (notes) => (selectedBoardId === previous ? notes : []),
        }),
        ...(selectedBoardId && selectedBoardId !== previous
          ? { commands: [SetBoardUrl({ boardId: selectedBoardId })] }
          : {}),
      };
    },
    ReceivedNotes: ({ boardId, notes }) => ({
      model:
        model.selectedBoardId === boardId ? modifyFields(model, { notes: () => notes }) : model,
    }),
    ClickedSelectBoard: ({ boardId }) => ({
      model: modifyFields(model, {
        selectedBoardId: () => boardId,
        notes: () => [],
        errorMessage: () => "",
      }),
      commands: [SetBoardUrl({ boardId })],
    }),
    UpdatedBoardTitleDraft: ({ value }) => ({
      model: modifyFields(model, { boardTitleDraft: () => value }),
    }),
    UpdatedNoteDraft: ({ value }) => ({
      model: modifyFields(model, { noteDraft: () => value }),
    }),
    SubmittedBoard: () => {
      const title = model.boardTitleDraft.trim();
      if (!title || model.connection._tag !== "Ready") return { model };
      return {
        model: modifyFields(model, { boardTitleDraft: () => "", errorMessage: () => "" }),
        commands: [CreateBoard({ title })],
      };
    },
    SubmittedNote: () => {
      const text = model.noteDraft.trim();
      if (!text || !model.selectedBoardId || model.connection._tag !== "Ready") return { model };
      return {
        model: modifyFields(model, { noteDraft: () => "", errorMessage: () => "" }),
        commands: [
          CreateNote({
            boardId: model.selectedBoardId,
            text,
            zIndex: model.notes.length,
          }),
        ],
      };
    },
    ClickedEditNote: ({ id }) => {
      const note = model.notes.find((item) => item.id === id);
      return note
        ? {
            model: modifyFields(model, {
              editingNoteId: () => id,
              editingNoteText: () => note.text,
            }),
          }
        : { model };
    },
    UpdatedNoteText: ({ value }) => ({
      model: modifyFields(model, { editingNoteText: () => value }),
    }),
    ClickedSaveNote: ({ id }) => {
      if (model.editingNoteId !== id) return { model };
      return {
        model: modifyFields(model, { errorMessage: () => "" }),
        commands: [UpdateNote({ id, text: model.editingNoteText })],
      };
    },
    ClickedMoveNote: ({ id, dx, dy }) => {
      const note = model.notes.find((note) => note.id === id);
      if (!note || model.connection._tag !== "Ready") return { model };
      return {
        model: modifyFields(model, { errorMessage: () => "" }),
        commands: [
          MoveNote({
            id,
            x: Math.max(0, note.x + dx),
            y: Math.max(0, note.y + dy),
          }),
        ],
      };
    },
    SucceededCreateBoard: ({ boardId }) => ({
      model: modifyFields(model, { selectedBoardId: () => boardId, notes: () => [] }),
      commands: [SetBoardUrl({ boardId })],
    }),
    SucceededCreateNote: () => ({ model }),
    SucceededMoveNote: () => ({ model }),
    SucceededUpdateNote: ({ id }) => ({
      model:
        model.editingNoteId === id
          ? modifyFields(model, { editingNoteId: () => "", editingNoteText: () => "" })
          : model,
    }),
    SucceededSetBoardUrl: () => ({ model }),
    FailedAction: ({ error }) => ({
      model: modifyFields(model, { errorMessage: () => error }),
    }),
  });

/** The Jazz Canvas invite keeps its secret in the URL fragment. Passkey
 * registration can reload Patchboard; recover the invitation from same-tab
 * sessionStorage only for explicit canvas joins. */
const initialPrivateInviteToken = (): string => {
  if (!privateMode || typeof window === "undefined") return "";
  const query = new URLSearchParams(window.location.search);
  if (query.get("invite")) return query.get("invite")!;
  if (query.get("canvas") !== "1") return "";
  try {
    const raw = sessionStorage.getItem("dim0:jazz:pendingInvite");
    const saved = raw ? JSON.parse(raw) as { boardId?: string; token?: string } : null;
    return saved?.boardId === query.get("board") && typeof saved?.token === "string"
      ? saved.token : "";
  } catch { return ""; }
};

export const init: Runtime.ApplicationInit<Model, Message> = () => ({
  model: {
    connection: ConnectionState.Connecting(),
    boards: [],
    selectedBoardId:
      typeof window === "undefined"
        ? ""
        : (new URLSearchParams(window.location.search).get("board") ?? ""),
    notes: [],
    boardTitleDraft: "",
    noteDraft: "",
    errorMessage: "",
    editingNoteId: "",
    editingNoteText: "",
    privateAuthStatus: privateMode ? "loading" : "guest",
    privateAuthName: "",
    privateAuthId: "",
    privateAuthError: "",
    inviteToken: initialPrivateInviteToken(),
    inviteUrl: "",
  },
  ...(privateMode ? { commands: [CheckPrivateAccount()] } : {}),
});

// The M1 server is selected by VITE_JAZZ_SERVER_URL. Without it, the app keeps its device-local fallback.
const openSession = () => {
  const serverUrl = import.meta.env.VITE_JAZZ_SERVER_URL as string | undefined;
  return serverUrl
    ? createJazzClient({
        serverUrl,
        initial: privateMode ? "signed-out" : "device",
        ...(privateMode ? { clearOnSignOut: true, linkDeviceAccountOnSignUp: false } : {}),
      })
    : createJazzClient({
        serverUrl: null,
        initial: "device",
        scope: "patchboard-effect-foldkit",
        client: () => import("jazz-tools/local-first"),
        driver: { type: "persistent" },
      });
};

export const managedResources = ManagedResource.make<Model, Message>()((entry) => ({
  boardConnection: entry(Schema.Option(Schema.Boolean), {
    resource: BoardConnection,
    modelToMaybeRequirements: (model) =>
      privateMode && model.privateAuthStatus !== "signedIn"
        ? Option.none()
        : Option.some(true),
    acquire: () =>
      Effect.acquireRelease(Effect.promise(openSession), (session) =>
        Effect.promise(() => session.close()),
      ).pipe(
        Effect.flatMap((session) => {
          const userId = session.db.getAuthState().session?.user;
          return userId
            ? Effect.succeed({ jazz: Jazz.fromDb(session.db), userId })
            : Effect.fail(new Error("Jazz session has no device identity"));
        }),
      ),
    release: () => Effect.void,
    onAcquired: () => Message.Connected(),
    onReleased: () => Message.Disconnected(),
    onAcquireError: (error) => Message.FailedConnect({ error: String(error) }),
  }),
}));

const fail = (cause: unknown) =>
  Message.FailedAction({ error: cause instanceof Error ? cause.message : String(cause) });

/** URL query is per-browser navigation state, never Jazz business data. */
const privateIdentityMessage = (identity: { id: string; name: string } | null) =>
  Message.PrivateAuthResolved({
    signedIn: identity !== null,
    id: identity?.id ?? "",
    name: identity?.name ?? "",
  });

/** After passkey login, re-enter server-side OAuth validation/consent with the original PKCE parameters. */
async function continuePrivateOAuth(): Promise<void> {
  if (typeof window === "undefined") return;
  const signed = new URLSearchParams(window.location.search);
  if (!signed.has("sig") || !signed.has("client_id")) return;
  const authorize = new URL("/patchboard-auth/oauth2/authorize", window.location.origin);
  // Only standard OAuth request parameters, never a caller-supplied redirect destination.
  for (const key of ["client_id", "redirect_uri", "response_type", "code_challenge",
    "code_challenge_method", "scope", "state", "resource", "nonce"]) {
    for (const value of signed.getAll(key)) authorize.searchParams.append(key, value);
  }
  // The provider checks client registration, redirect URI and PKCE again, then
  // presents consent; a browser session never grants MCP access by itself.
  window.location.replace(authorize.href);
}

export const CheckPrivateAccount = Command.define("CheckPrivateAccount", {
  messages: [Message.PrivateAuthResolved, Message.PrivateAuthFailed],
  execute: Effect.promise(async () => {
    const client = await import("./private-auth-client.ts");
    const identity = await client.session();
    if (identity) await continuePrivateOAuth();
    return privateIdentityMessage(identity);
  }).pipe(
    Effect.catch((error) => Effect.succeed(Message.PrivateAuthFailed({ error: String(error) }))),
  ),
});

export const CreatePrivateAccount = Command.define("CreatePrivateAccount", {
  messages: [Message.PrivateAuthResolved, Message.PrivateAuthFailed],
  execute: Effect.promise(async () => {
    const client = await import("./private-auth-client.ts");
    const identity = await client.register();
    if (identity) await continuePrivateOAuth();
    return privateIdentityMessage(identity);
  }).pipe(
    Effect.catch((error) => Effect.succeed(Message.PrivateAuthFailed({ error: String(error) }))),
  ),
});

export const SignInPrivateAccount = Command.define("SignInPrivateAccount", {
  messages: [Message.PrivateAuthResolved, Message.PrivateAuthFailed],
  execute: Effect.promise(async () => {
    const client = await import("./private-auth-client.ts");
    const identity = await client.signIn();
    if (identity) await continuePrivateOAuth();
    return privateIdentityMessage(identity);
  }).pipe(
    Effect.catch((error) => Effect.succeed(Message.PrivateAuthFailed({ error: String(error) }))),
  ),
});

export const SignOutPrivateAccount = Command.define("SignOutPrivateAccount", {
  messages: [Message.PrivateAuthResolved, Message.PrivateAuthFailed],
  execute: Effect.promise(async () => {
    const client = await import("./private-auth-client.ts");
    await client.signOut();
    // A new page deliberately drops Foldkit state and the current Jazz subscription.
    window.location.replace("/patchboard-private/");
    return privateIdentityMessage(null);
  }).pipe(
    Effect.catch((error) => Effect.succeed(Message.PrivateAuthFailed({ error: String(error) }))),
  ),
});

export const CreatePrivateInvite = Command.define("CreatePrivateInvite", {
  args: { boardId: Schema.String, role: Schema.String },
  messages: [Message.InviteCreated, Message.FailedAction],
  execute: ({ boardId, role }) => Effect.promise(async () => {
    const reply = await privatePost("invite", { board_id: boardId, role });
    if (typeof reply.invite_url !== "string") throw new Error("Missing invitation link");
    return Message.InviteCreated({ url: reply.invite_url });
  }).pipe(Effect.catch((cause) => Effect.succeed(fail(cause)))),
});

export const AcceptPrivateInvite = Command.define("AcceptPrivateInvite", {
  args: { boardId: Schema.String, token: Schema.String },
  messages: [Message.InviteAccepted, Message.FailedAction],
  execute: ({ boardId, token }) => Effect.promise(async () => {
    await privatePost("join", { board_id: boardId, token });
    return Message.InviteAccepted();
  }).pipe(Effect.catch((cause) => Effect.succeed(fail(cause)))),
});

export const FinishPrivateInvite = Command.define("FinishPrivateInvite", {
  messages: [Message.SucceededSetBoardUrl],
  execute: Effect.sync(() => {
    const url = new URL(window.location.href);
    const boardId = url.searchParams.get("board");
    if (url.searchParams.get("canvas") === "1" && boardId &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(boardId)) {
      sessionStorage.removeItem("dim0:jazz:pendingInvite");
      window.location.replace("/boards/" + encodeURIComponent(boardId));
    } else {
      url.searchParams.delete("invite");
      window.location.replace(url.toString());
    }
    return Message.SucceededSetBoardUrl();
  }),
});

export const SetBoardUrl = Command.define("SetBoardUrl", {
  args: { boardId: Schema.String },
  messages: [Message.SucceededSetBoardUrl, Message.FailedAction],
  execute: ({ boardId }) =>
    Effect.sync(() => {
      const url = new URL(window.location.href);
      url.searchParams.set("board", boardId);
      window.history.replaceState(window.history.state, "", url);
      return Message.SucceededSetBoardUrl();
    }).pipe(Effect.catch((cause) => Effect.succeed(fail(cause)))),
});

async function privatePost(path: string, data: unknown) {
  const response = await fetch("/patchboard-private/api/" + path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });
  const result = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Private request failed");
  return result;
}

export const CreateBoard = Command.define("CreateBoard", {
  args: { title: Schema.String },
  messages: [Message.SucceededCreateBoard, Message.FailedAction],
  execute: ({ title }) =>
    privateMode
      ? Effect.promise(async () => {
          const created = await privatePost("boards", { title });
          if (typeof created.board_id !== "string") throw new Error("Missing private board ID");
          return Message.SucceededCreateBoard({ boardId: created.board_id });
        }).pipe(Effect.catch((cause) => Effect.succeed(fail(cause))))
      : BoardConnection.get.pipe(
          Effect.flatMap(({ jazz, userId }) => createBoard(jazz, userId, title)),
          Effect.map((board) => Message.SucceededCreateBoard({ boardId: board.id })),
          Effect.catch((cause) => Effect.succeed(fail(cause))),
        ),
});

export const CreateNote = Command.define("CreateNote", {
  args: { boardId: Schema.String, text: Schema.String, zIndex: Schema.Number },
  messages: [Message.SucceededCreateNote, Message.FailedAction],
  execute: ({ boardId, text, zIndex }) =>
    privateMode
      ? Effect.promise(async () => {
          await privatePost("note", {
            board_id: boardId, text, request_id: crypto.randomUUID(),
          });
          return Message.SucceededCreateNote();
        }).pipe(Effect.catch((cause) => Effect.succeed(fail(cause))))
      : BoardConnection.get.pipe(
          Effect.flatMap(({ jazz }) => createNote(jazz, boardId, text, zIndex)),
          Effect.as(Message.SucceededCreateNote()),
          Effect.catch((cause) => Effect.succeed(fail(cause))),
        ),
});

export const UpdateNote = Command.define("UpdateNote", {
  args: { id: Schema.String, text: Schema.String },
  messages: [Message.SucceededUpdateNote, Message.FailedAction],
  execute: ({ id, text }) =>
    privateMode
      ? Effect.promise(async () => {
          await privatePost("note/update", { note_id: id, text });
          return Message.SucceededUpdateNote({ id });
        }).pipe(Effect.catch((cause) => Effect.succeed(fail(cause))))
      : BoardConnection.get.pipe(
          Effect.flatMap(({ jazz }) => updateNote(jazz, id, text)),
          Effect.as(Message.SucceededUpdateNote({ id })),
          Effect.catch((cause) => Effect.succeed(fail(cause))),
        ),
});

export const MoveNote = Command.define("MoveNote", {
  args: { id: Schema.String, x: Schema.Number, y: Schema.Number },
  messages: [Message.SucceededMoveNote, Message.FailedAction],
  execute: ({ id, x, y }) =>
    privateMode
      ? Effect.promise(async () => {
          await privatePost("note/move", { note_id: id, x, y });
          return Message.SucceededMoveNote();
        }).pipe(Effect.catch((cause) => Effect.succeed(fail(cause))))
      : BoardConnection.get.pipe(
          Effect.flatMap(({ jazz }) => moveNote(jazz, id, x, y)),
          Effect.as(Message.SucceededMoveNote()),
          Effect.catch((cause) => Effect.succeed(fail(cause))),
        ),
});

const boardEvents = Stream.unwrap(
  BoardConnection.get.pipe(
    Effect.map(({ jazz }) =>
      jazz.stream(app.boards).pipe(
        Stream.map((rows) =>
          Message.ReceivedBoards({
            boards: rows.map(({ id, title }) => ({ id, title })),
          }),
        ),
        Stream.catch((cause) => Stream.make(fail(cause))),
      ),
    ),
    Effect.catch(() => Effect.succeed(Stream.empty)),
  ),
);

export const subscriptions = Subscription.make<Model, Message, BoardConnectionService>()(
  (entry) => ({
    boardList: entry(
      { connected: Schema.Boolean },
      {
        modelToDependencies: (model) => ({ connected: model.connection._tag === "Ready" }),
        dependenciesToStream: ({ connected }) =>
          Stream.when(boardEvents, Effect.succeed(connected)),
      },
    ),
    boardNotes: entry(
      { boardId: Schema.String, connected: Schema.Boolean },
      {
        modelToDependencies: (model) => ({
          boardId: model.selectedBoardId,
          connected: model.connection._tag === "Ready",
        }),
        dependenciesToStream: ({ boardId, connected }) =>
          !connected || !boardId
            ? Stream.empty
            : Stream.unwrap(
                BoardConnection.get.pipe(
                  Effect.map(({ jazz }) =>
                    jazz.stream(app.shapes.where({ boardId }).orderBy("zIndex", "asc")).pipe(
                      Stream.map((rows) =>
                        Message.ReceivedNotes({
                          boardId,
                          notes: rows.map(({ id, boardId, text, x, y, width, height, fill, authorId, authorName }) => ({
                            authorId: authorId ?? undefined,
                            authorName: authorName ?? undefined,
                            id,
                            boardId,
                            text,
                            x,
                            y,
                            width,
                            height,
                            fill,
                          })),
                        }),
                      ),
                      Stream.catch((cause) => Stream.make(fail(cause))),
                    ),
                  ),
                  Effect.catch(() => Effect.succeed(Stream.empty)),
                ),
              ),
      },
    ),
  }),
);

const privateSignInView = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: "Patchboard — Private sign-in",
  body: h.div([h.Class("page")], [
    h.header([h.Class("topbar")], [
      h.div([h.Class("brand")], ["Patch", h.span([], ["board"])]),
      h.div([h.Class("status")], ["Private collaboration · passkey"]),
    ]),
    h.main([h.Class("content")], [
      h.h1([], ["Sign in to your private board"]),
      h.p([], ["Create a separate account using a passkey, or sign into your existing account."]),
      model.inviteToken ? h.p([], ["You have a pending invitation. Sign in to accept it."]) : h.empty,
      model.privateAuthError
        ? h.div([h.Class("alert"), h.Attribute("role", "alert")], [model.privateAuthError])
        : h.empty,
      model.privateAuthStatus === "loading" || model.privateAuthStatus === "busy"
        ? h.p([], ["Checking authentication…"])
        : h.div([h.Class("form")], [
          h.button([h.Class("primary"), h.OnClick(Message.ClickedCreatePrivateAccount())],
            ["Create account with passkey"]),
          h.button([h.OnClick(Message.ClickedPrivateSignIn())], ["Sign in with passkey"]),
        ]),
    ]),
  ]),
});

export const view = (model: Model, h: HtmlBuilder<Message>): Document =>
  privateMode && model.privateAuthStatus !== "signedIn" ? privateSignInView(model, h) : ({
  title: "Patchboard — Staff × Agents",
  body: h.div(
    [h.Class("page")],
    [
      h.header(
        [h.Class("topbar")],
        [
          h.div([h.Class("brand")], ["Patch", h.span([], ["board"])]),
          ...(privateMode ? [h.button(
            [h.Type("button"), h.OnClick(Message.ClickedPrivateSignOut())],
            ["Sign out · " + model.privateAuthName],
          )] : []),
          h.div(
            [h.Class("status")],
            [
              model.connection._tag === "Ready"
                ? import.meta.env.VITE_JAZZ_SERVER_URL
                  ? "Jazz shared · connected"
                  : "Jazz local-first · connected"
                : model.connection._tag === "Failed"
                  ? "Connection failed"
                  : "Connecting to Jazz…",
            ],
          ),
        ],
      ),
      h.div(
        [h.Class("layout")],
        [
          h.aside(
            [h.Class("sidebar")],
            [
              h.h2([], ["Your boards"]),
              h.form(
                [h.Class("form"), h.OnSubmit(Message.SubmittedBoard())],
                [
                  Input.view(
                    {
                      id: "board-title",
                      value: model.boardTitleDraft,
                      placeholder: "New board title",
                      onInput: (value) => Message.UpdatedBoardTitleDraft({ value }),
                      toView: (attrs) => h.input([...attrs.input, h.Class("field")]),
                    },
                    h,
                  ),
                  h.button([h.Class("primary"), h.Type("submit")], ["+"]),
                ],
              ),
              h.div(
                [],
                model.boards.map((board) =>
                  h.keyed("button")(
                    board.id,
                    [
                      h.Class("board-link"),
                      h.Type("button"),
                      h.DataAttribute("current", String(board.id === model.selectedBoardId)),
                      h.OnClick(Message.ClickedSelectBoard({ boardId: board.id })),
                    ],
                    [board.title],
                  ),
                ),
              ),
              h.p(
                [h.Class("caption")],
                [privateMode
                  ? "Private Patchboard · membership checked by Jazz"
                  : "M1 · shared Jazz demo. MCP and review decisions come next."],
              ),
            ],
          ),
          h.main(
            [h.Class("content")],
            [
              ...(privateMode && model.inviteToken ? [
                h.div([h.Class("alert")], [
                  h.p([], ["Invitation received. Accept it to join this private board."]),
                  h.button([h.Class("primary"), h.OnClick(Message.ClickedAcceptInvite())],
                    ["Accept invitation"]),
                ]),
              ] : []),
              model.errorMessage
                ? h.div([h.Class("alert"), h.Attribute("role", "alert")], [model.errorMessage])
                : h.empty,
              model.connection._tag === "Failed"
                ? h.div([h.Class("alert")], [model.connection.error])
                : h.empty,
              model.selectedBoardId
                ? boardView(model, h)
                : h.div(
                    [h.Class("canvas-shell")],
                    [h.div([h.Class("empty")], ["Create a board to begin"])],
                  ),
            ],
          ),
        ],
      ),
    ],
  ),
});

const boardView = (model: Model, h: HtmlBuilder<Message>): Html => {
  const selected = model.boards.find((board) => board.id === model.selectedBoardId);
  return h.section(
    [h.Class("canvas-shell")],
    [
      h.div(
        [h.Class("canvas-header")],
        [
          h.h1([], [selected?.title ?? "Shared board"]),
          ...(privateMode ? [
            h.button([h.Type("button"), h.OnClick(Message.ClickedInvite({ role: "editor" }))],
              ["Invite an editor"]),
            h.button([h.Type("button"), h.OnClick(Message.ClickedInvite({ role: "viewer" }))],
              ["Invite a viewer"]),
            ...(model.inviteUrl ? [
              h.p([h.Class("caption")], ["Invitation link (copy and share): " + model.inviteUrl]),
            ] : []),
          ] : []),
          h.form(
            [h.Class("form"), h.OnSubmit(Message.SubmittedNote())],
            [
              Input.view(
                {
                  id: "note-content",
                  value: model.noteDraft,
                  placeholder: "Write a note…",
                  onInput: (value) => Message.UpdatedNoteDraft({ value }),
                  toView: (attrs) => h.input([...attrs.input, h.Class("field")]),
                },
                h,
              ),
              h.button([h.Class("primary"), h.Type("submit")], ["Add note"]),
            ],
          ),
        ],
      ),
      h.div(
        [h.Class("canvas-stage")],
        [
          ...model.notes.map((note) => noteView(note, model, h)),
          ...(!model.notes.length
            ? [h.p([h.Class("empty")], ["No notes yet. Add a note above to start collaborating."])]
            : []),
        ],
      ),
    ],
  );
};

const noteView = (note: NoteView, model: Model, h: HtmlBuilder<Message>): Html =>
  h.keyed("div")(
    note.id,
    [
      h.Class("note"),
      h.Style({
        left: note.x + "px",
        top: note.y + "px",
        width: note.width + "px",
        minHeight: note.height + "px",
        backgroundColor: note.fill,
      }),
    ],
    [
      model.editingNoteId === note.id
        ? h.div(
            [h.Class("note-edit")],
            [
              h.input([
                h.Attribute("aria-label", "Note text"),
                h.Value(model.editingNoteText),
                h.OnInput((value) => Message.UpdatedNoteText({ id: note.id, value })),
              ]),
              h.button(
                [h.Type("button"), h.OnClick(Message.ClickedSaveNote({ id: note.id }))],
                ["Save note"],
              ),
            ],
          )
        : h.p([], [note.text]),
      ...(privateMode ? [h.p([h.Class("caption")], [
        "Author: " + (note.authorId ? (note.authorName || note.authorId) : "Guest / unverified"),
      ])] : []),
      h.div(
        [h.Class("note-actions")],
        [
          h.button(
            [
              h.Type("button"),
              h.Attribute("aria-label", "Edit note"),
              h.OnClick(Message.ClickedEditNote({ id: note.id })),
            ],
            ["Edit"],
          ),
          directionButton(note.id, 0, -30, "↑", h),
          directionButton(note.id, -30, 0, "←", h),
          directionButton(note.id, 30, 0, "→", h),
          directionButton(note.id, 0, 30, "↓", h),
        ],
      ),
    ],
  );

const directionButton = (
  id: string,
  dx: number,
  dy: number,
  label: string,
  h: HtmlBuilder<Message>,
): Html =>
  h.button(
    [
      h.Type("button"),
      h.Attribute("aria-label", "Move note " + label),
      h.OnClick(Message.ClickedMoveNote({ id, dx, dy })),
    ],
    [label],
  );
