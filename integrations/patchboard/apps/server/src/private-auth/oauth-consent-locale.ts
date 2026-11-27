import { readAccountPreferences } from "../account-adapters/profile-preferences.ts";
import { privateAuthDatabase } from "./db.ts";

const en = {
  "title": "{{app}} — authorize MCP",
  "heading": "Authorize a {{app}} connection",
  "thirdParty": "A third-party MCP client",
  "requestAccess": " requests access as ",
  "clientId": "Client ID",
  "unknownClient": "Unknown client",
  "requestedScopes": "Requested scopes",
  "noScopes": "No board permissions requested",
  "chooseBoard": "Choose the one board this connection may access.",
  "boardHint": "No other board names, notes or writes will be available to this MCP client.",
  "approvedBoard": "Approved board",
  "selectBoard": "Select a board...",
  "viewerHint": "A viewer may read the selected board, never write it. Your passkey session is not an MCP credential.",
  "expiration": "Access tokens expire after {{minutes}} minutes.",
  "authorize": "Authorize selected board",
  "deny": "Deny",
  "chooseRequired": "Choose a board",
  "failed": "Authorization failed",
  "tableCreate": "Create a new primary-text table and default grid on the selected board (Owner only). Also requires board:write; no other catalog operation is granted.",
  "owner": "owner",
  "member": "member",
  "editor": "editor",
  "agent": "agent",
  "admin": "admin",
  "viewer": "viewer"
} as const;
const ru: Record<keyof typeof en, string> = {
  "title": "{{app}} — авторизация MCP",
  "heading": "Разрешить подключение к {{app}}",
  "thirdParty": "Сторонний клиент MCP",
  "requestAccess": " запрашивает доступ от имени ",
  "clientId": "ID клиента",
  "unknownClient": "Неизвестный клиент",
  "requestedScopes": "Запрашиваемые разрешения",
  "noScopes": "Разрешения для досок не запрошены",
  "chooseBoard": "Выберите одну доску.",
  "boardHint": "Приложение сможет работать только с выбранной доской. Читать или изменять другие доски оно не сможет.",
  "approvedBoard": "Доска для подключения",
  "selectBoard": "Выберите доску…",
  "viewerHint": "Читатель может просматривать выбранную доску, но не изменять её. Для MCP требуется отдельное разрешение. Вход с ключом доступа его не заменяет.",
  "expiration": "Срок действия токена доступа: {{minutes}} мин.",
  "authorize": "Разрешить доступ",
  "deny": "Отклонить запрос",
  "chooseRequired": "Выберите доску",
  "failed": "Не удалось авторизовать подключение",
  "tableCreate": "Создать таблицу с основным текстовым полем и представлением по умолчанию на выбранной доске (только владелец). Также требуется board:write; другие операции каталога не разрешены.",
  "owner": "Владелец",
  "member": "Редактор",
  "editor": "Редактор",
  "agent": "Агент",
  "admin": "Администратор",
  "viewer": "Читатель"
};
type Language = "en" | "ru";
type Key = keyof typeof en;

function supported(value: string): Language | undefined {
  try {
    const base = new Intl.Locale(value).language;
    return base === "en" || base === "ru" ? base : undefined;
  } catch { return undefined; }
}

/** Same account preference and English fallback as the native UI.
 * Presentation only: the caller has already verified the session. */
export function consentLanguage(verifiedSubject: string): Language {
  try {
    return supported(readAccountPreferences(privateAuthDatabase(), verifiedSubject).locale) ?? "en";
  } catch { return "en"; }
}

/** Localize static copy only. All interpolated values are escaped by the HTML renderer. */
export function consentMessages(language: Language) {
  const messages = language === "ru" ? ru : en;
  return (key: Key, args: Record<string, string | number> = {}) =>
    messages[key].replace(/\{\{(\w+)\}\}/g, (match, name: string) => Object.hasOwn(args, name) ? String(args[name]) : match);
}
