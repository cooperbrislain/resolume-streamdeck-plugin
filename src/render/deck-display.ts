import { client, cursors, deckEncoderMap, deckLabelMap } from "../state.js";
import { colorDotIcon } from "./color-dots.js";

export async function updateDeckDisplays(): Promise<void> {
  const decks = client.getDecks();
  const idx   = Math.max(0, Math.min(Math.max(0, decks.length - 1), cursors.deck));
  const deck  = decks[idx];
  const icon  = colorDotIcon(deck?.colorIndex);
  for (const [col, act] of deckEncoderMap.entries()) {
    const title = deckLabelMap.get(col) || "Deck";
    const value = decks.length === 0 ? "—" : deck.name;
    await act.setFeedback({ title, value, icon }).catch(() => {});
  }
}
