import { client, cursors, layerEncoderMap, layerLabelMap } from "../state.js";

export async function updateLayerDisplays(): Promise<void> {
  const layers = client.getLayers();
  const idx    = Math.max(0, Math.min(Math.max(0, layers.length - 1), cursors.layer));
  for (const [col, act] of layerEncoderMap.entries()) {
    const title = layerLabelMap.get(col) || "Layer";
    const value = layers.length === 0 ? "—" : layers[idx].name;
    await act.setFeedback({ title, value }).catch(() => {});
  }
}
