import { expect, test } from "vitest"
import { readRecipient, sharedViewUrl } from "./saved-view-api"
test("view link uses separate route and fragment-only credential", () => {
  const v = {boardId:"00000000-0000-4000-8000-000000000001",datasetId:"00000000-0000-4000-8000-000000000002",viewId:"00000000-0000-4000-8000-000000000003",shareToken:"a".repeat(43)}
  const url = new URL(sharedViewUrl(v))
  expect(url.pathname).toBe("/shared-view/"+v.boardId+"/"+v.datasetId+"/"+v.viewId)
  expect(url.search).toBe("")
  expect(url.hash).toBe("#share="+v.shareToken)
  expect(readRecipient(url.href)).toEqual(v)
  expect(readRecipient(url.origin+url.pathname)).toBeNull()
})
