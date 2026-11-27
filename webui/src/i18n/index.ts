import { useSyncExternalStore } from "react"
import russian from "./locales/ru.json"

export type UiLanguage = "en" | "ru"
type Values = Record<string, string | number>
const messages: Readonly<Record<string, string>> = russian
const listeners = new Set<() => void>()
let language: UiLanguage = "en"
let sessionEpoch = 0
let readEpoch = 0
let version = -1

export function supportedLanguage(tag: unknown): UiLanguage | undefined {
  if (typeof tag !== "string") return
  try {
    const base = new Intl.Locale(tag).language
    return base === "en" || base === "ru" ? base : undefined
  } catch { return }
}

function setLanguage(next: UiLanguage) {
  language = next
  if (typeof document !== "undefined") document.documentElement.lang = next
  listeners.forEach(listener => listener())
}

export function clearAccountLocale() {
  ++sessionEpoch
  ++readEpoch
  version = -1
  setLanguage("en")
}

export function localeSessionEpoch() { return sessionEpoch }

/** Only a confirmed, session-bound preference response can affect rendering. */
export function applyAccountLocale(tag: unknown, nextVersion: number, epoch: number) {
  if (epoch !== sessionEpoch || !Number.isSafeInteger(nextVersion) || nextVersion < 0 || nextVersion < version) return
  ++readEpoch
  version = nextVersion
  setLanguage(supportedLanguage(tag) ?? "en")
}

export async function refreshAccountLocale(signal?: AbortSignal) {
  const epoch = sessionEpoch
  const read = ++readEpoch
  try {
    const response = await fetch("/patchboard-private/api/account/preferences", {
      credentials: "same-origin", cache: "no-store", signal,
    })
    if (signal?.aborted || read !== readEpoch || epoch !== sessionEpoch) return
    if (response.status === 401 || response.status === 403) { clearAccountLocale(); return }
    if (!response.ok) return
    const result = await response.json() as { locale?: unknown; version?: number }
    if (!signal?.aborted && read === readEpoch && typeof result.version === "number")
      applyAccountLocale(result.locale, result.version, epoch)
  } catch { /* Presentation must not block sign-in or data. */ }
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
const getLanguage = () => language
const english = (): UiLanguage => "en"

/** English copy is the fallback. Translate only authored UI labels, never
 * user-provided names, values or protocol identifiers. Interpolation is plain
 * React text; an interpolated name is not recursively translated. */
export function translateCopy(lang: UiLanguage, copy: string, values: Values = {}) {
  const template = lang === "ru" && Object.hasOwn(messages, copy) ? messages[copy] : copy
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : match)
}

export function useCopy() {
  const lang = useSyncExternalStore(subscribe, getLanguage, english)
  return { language: lang, t: (copy: string, values?: Values) => translateCopy(lang, copy, values) }
}
