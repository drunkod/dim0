// Structural disabled UI semantics, NOT registered app routes.
import type { AccId } from "./ids.ts";
import { CAPABILITIES } from "./registry.ts";
export type UnavailableAccountScreen = Readonly<{
  accId: AccId; mockupReference: string; available: false;
  actionDisabled: true; emailSent: false;
}>;
export const UNAVAILABLE_ACCOUNT_SCREENS: readonly UnavailableAccountScreen[] =
  CAPABILITIES.filter(row => row.classification !== "EXISTS").map(row => ({
    accId: row.id, mockupReference: row.mockup,
    available: false, actionDisabled: true, emailSent: false,
  }));
