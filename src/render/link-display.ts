/**
 * Feedback formatting + bar-fill for Parameter (link) dials.
 *
 * The encoder uses Stream Deck's built-in `$B1` layout: title, value, and an
 * indicator bar. The indicator is a 0–100 integer that fills the bar from
 * left to right; we compute it from the assignment's min/max/value.
 */

import { linkEncoderMap, knobHandler } from "../state.js";
import type { AssignmentInfo } from "../knob-handler.js";
import { knobIcon } from "./knob-icon.js";

function formatLinkValue(info: AssignmentInfo): string {
  if (info.max <= 1 && info.min >= 0) {
    const pct = ((info.value - info.min) / (info.max - info.min)) * 100;
    return `${Math.round(pct)}%`;
  }
  return info.value.toFixed(1);
}

export async function updateLinkFeedback(column: number): Promise<void> {
  const act = linkEncoderMap.get(column);
  if (!act) return;

  const info = knobHandler.getInfo(column);
  if (!info) {
    await act.setFeedback({
      title:     "Unassigned",
      value:     "—",
      indicator: 0,
      icon:      knobIcon(null),
    }).catch(() => {});
    return;
  }

  const range = info.max - info.min;
  const pct   = range > 0
    ? Math.max(0, Math.min(100, ((info.value - info.min) / range) * 100))
    : 0;

  await act.setFeedback({
    title:     info.label,
    value:     formatLinkValue(info),
    indicator: Math.round(pct),
    icon:      knobIcon(pct),
  }).catch(() => {});
}
