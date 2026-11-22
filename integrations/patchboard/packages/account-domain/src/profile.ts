/**
 * ACC-037/039: native no-email display name / per-user locale inputs.
 * This narrow command is separate from the unavailable source ACC-037
 * branches (avatar/notification/last visit) and cannot issue an identity.
 */
export type AccountDisplayNameChange = Readonly<{ name: string }>;
export type AccountLocale = string & { readonly __accountLocale: unique symbol };
export type AccountLocaleChange = Readonly<{
  locale: AccountLocale;
  expectedVersion: number;
  requestId: string;
}>;
export function normalizedDisplayName(input: unknown): string {
  if (typeof input !== "string") throw new Error("INVALID_DISPLAY_NAME");
  const name = input.trim().normalize("NFC");
  if (name.length < 1 || Array.from(name).length > 80 ||
      /\p{Cc}|\p{Cf}/u.test(name)) throw new Error("INVALID_DISPLAY_NAME");
  return name;
}
export function normalizedAccountLocale(input: unknown): AccountLocale {
  if (typeof input !== "string" || input.length > 35 || !/^[A-Za-z0-9-]+$/.test(input))
    throw new Error("INVALID_ACCOUNT_LOCALE");
  let canonical: string[];
  try { canonical = Intl.getCanonicalLocales(input); }
  catch { throw new Error("INVALID_ACCOUNT_LOCALE"); }
  if (canonical.length !== 1) throw new Error("INVALID_ACCOUNT_LOCALE");
  // A locale preference never infers organization membership or mailbox.
  return canonical[0]! as AccountLocale;
}
