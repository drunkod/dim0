import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import type { Editor } from "@tiptap/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SheetInlineEditor } from "./sheet-inline-editor"

// Use real TipTap/ProseMirror transactions and markdown serialization without
// the unrelated board-specific node views, menus or network dependencies.
vi.mock("@/components/editor/tiptap/extensions", async () => {
  const { default: StarterKit } = await import("@tiptap/starter-kit")
  const { Markdown } = await import("tiptap-markdown")
  return { getExtensions: () => [StarterKit, Markdown] }
})

describe("SheetInlineEditor persistence", () => {
  let host: HTMLDivElement
  let root: Root
  let editor: Editor | null
  const onSave = vi.fn<(markdown: string) => void>()
  const onEditor = (instance: Editor | null) => { editor = instance }
  const emptyRect = () => new DOMRect()
  const emptyRects = () => [] as unknown as DOMRectList

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    vi.useFakeTimers()
    // jsdom has no layout engine; ProseMirror still measures the caret.
    Range.prototype.getBoundingClientRect = emptyRect
    Range.prototype.getClientRects = emptyRects
    onSave.mockClear()
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    editor = null
  })

  afterEach(async () => {
    await act(async () => { root.unmount() })
    host.remove()
    Reflect.deleteProperty(Range.prototype, "getBoundingClientRect")
    Reflect.deleteProperty(Range.prototype, "getClientRects")
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  async function render(markdown: string, editable: boolean) {
    await act(async () => {
      root.render(<SheetInlineEditor markdown={markdown} editable={editable}
        onSave={onSave} onEditor={onEditor} />)
    })
    expect(editor).not.toBeNull()
  }

  async function settle() {
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  }

  it("does not save on passive mount, remote content hydration or unmount", async () => {
    await render("Initial body", false)
    await settle()
    expect(onSave).not.toHaveBeenCalled()
    await render("Remote Editor body", false)
    await settle()
    expect(editor!.getText()).toBe("Remote Editor body")
    expect(onSave).not.toHaveBeenCalled()
    await act(async () => { root.render(null) })
    expect(onSave).not.toHaveBeenCalled()
  })

  it("ignores emitted non-document and read-only document transactions", async () => {
    await render("Initial body", false)
    await act(async () => {
      // TipTap defaults to emitting update even when only mode changes.
      editor!.setEditable(false)
      editor!.commands.setContent("Programmatic preview", { emitUpdate: true })
    })
    await settle()
    expect(onSave).not.toHaveBeenCalled()
  })

  it("flushes a pending genuine edit on unmount", async () => {
    await render("Initial body", true)
    await act(async () => {
      editor!.commands.setContent("Unsaved user edit", { emitUpdate: true })
    })
    expect(onSave).not.toHaveBeenCalled()
    await act(async () => { root.render(null) })
    expect(onSave).toHaveBeenCalledExactlyOnceWith("Unsaved user edit")
    await settle()
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it("persists a genuine edit once and does not save when leaving edit mode", async () => {
    await render("Initial body", false)
    await render("Initial body", true)
    await settle()
    expect(onSave).not.toHaveBeenCalled()
    await act(async () => {
      editor!.commands.setContent("Real edit", { emitUpdate: true })
    })
    await settle()
    expect(onSave).toHaveBeenCalledExactlyOnceWith("Real edit")
    await render("Real edit", false)
    await settle()
    expect(onSave).toHaveBeenCalledTimes(1)
  })
})
