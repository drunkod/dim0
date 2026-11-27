import { expect, test } from "vitest"
import { readCatalogIntent, retainCatalogIntent, releaseCatalogIntent, type CatalogIntent, type CatalogIntentScope } from "./catalog-intent"

const scope: CatalogIntentScope = {
  subjectId: "owner", accountId: "11111111-1111-4111-8111-111111111111",
  boardId: "22222222-2222-4222-8222-222222222222",
}
const action: CatalogIntent = { kind: "row", viewId: "33333333-3333-4333-8333-333333333333", input: {
  board_id: scope.boardId, dataset_id: "44444444-4444-4444-8444-444444444444",
  field_id: "55555555-5555-4555-8555-555555555555", schema_version: 1,
  value: "One row", request_id: "first-request",
} }
function fixture() {
  const records = new Map<string, string>()
  return { records, storage: {
    getItem: (k: string) => records.get(k) ?? null,
    setItem: (k: string, v: string) => { records.set(k, v) },
    removeItem: (k: string) => { records.delete(k) },
  } }
}
test("journal keeps one exact request per account and board, releases only its own completion", () => {
  const { storage } = fixture()
  retainCatalogIntent(scope, action, false, storage)
  expect(readCatalogIntent(scope, storage)).toEqual(action)
  expect(readCatalogIntent({ ...scope, subjectId: "other" }, storage)).toBeNull()
  expect(readCatalogIntent({ ...scope, accountId: "different" }, storage)).toBeNull()
  expect(readCatalogIntent({ ...scope, boardId: "different" }, storage)).toBeNull()
  expect(() => retainCatalogIntent(scope, action, false, storage)).toThrow()
  const changed = { ...action, input: { ...action.input, request_id: "second-request" } }
  expect(() => retainCatalogIntent(scope, changed, true, storage)).toThrow()
  expect(() => releaseCatalogIntent(scope, changed, storage)).toThrow()
  retainCatalogIntent(scope, action, true, storage)
  releaseCatalogIntent(scope, action, storage)
  expect(readCatalogIntent(scope, storage)).toBeNull()
  expect(() => retainCatalogIntent(scope, action, true, storage)).toThrow()
})
test("malformed, cross-board and inaccessible storage never appear empty", () => {
  const { storage, records } = fixture()
  retainCatalogIntent(scope, action, false, storage)
  const k = [...records.keys()][0]
  records.set(k, "{")
  expect(() => readCatalogIntent(scope, storage)).toThrow()
  expect(() => retainCatalogIntent(scope, action, false, storage)).toThrow()
  records.set(k, JSON.stringify({ ...action, input: { ...action.input, board_id: "77777777-7777-4777-8777-777777777777" } }))
  expect(() => readCatalogIntent(scope, storage)).toThrow()
  const inaccessible = { ...storage, getItem: () => { throw new Error("blocked") } }
  expect(() => readCatalogIntent(scope, inaccessible)).toThrow()
  const full = { ...storage, getItem: () => null, setItem: () => { throw new Error("quota") } }
  expect(() => retainCatalogIntent(scope, action, false, full)).toThrow()
})
