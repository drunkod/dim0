/** Shared, browser-safe default fields for a text note in Jazz. */
export const noteFields = (boardId: string, text: string, zIndex: number) => ({
  boardId,
  kind: "note" as const,
  text,
  // A growing grid keeps the editor buttons reachable in the basic MVP.
  x: 40 + (zIndex % 3) * 270,
  y: 45 + Math.floor(zIndex / 3) * 190,
  width: 240,
  height: 150,
  fill: "#fff1b6",
  zIndex,
});
