const $layerSelect = document.getElementById("layerSelect");
const $layerHint   = document.getElementById("layerHint");
const $deckSelect  = document.getElementById("deckSelect");
const $deckColumn  = document.getElementById("deckColumn");
const $bindBtn     = document.getElementById("bind-btn");
const $bindHint    = document.getElementById("bind-hint");
const $refreshBtn  = document.getElementById("refresh-btn");

/** Repopulate the layer dropdown, preserving selection where possible. */
function populateLayers(layers) {
  const current = $layerSelect.value;
  while ($layerSelect.options.length > 1) $layerSelect.remove(1); // keep "Currently selected"

  if (!layers.length) {
    $layerHint.textContent = "No layers found in composition.";
  } else {
    $layerHint.textContent = "";
    layers.forEach((layer, i) => {
      const opt = document.createElement("option");
      opt.value = String(i + 1);
      opt.textContent = layer.name ? `${i + 1}: ${layer.name}` : `Layer ${i + 1}`;
      $layerSelect.appendChild(opt);
    });
  }

  if (current && Array.from($layerSelect.options).some(o => o.value === current)) {
    $layerSelect.value = current;
  } else if ($layerSelect.dataset.pendingValue) {
    const p = $layerSelect.dataset.pendingValue;
    delete $layerSelect.dataset.pendingValue;
    if (Array.from($layerSelect.options).some(o => o.value === p)) $layerSelect.value = p;
  } else {
    $layerSelect.value = "selected";
  }
}

function populateDecks(decks) {
  const current = $deckSelect.value;
  while ($deckSelect.options.length > 1) $deckSelect.remove(1);
  (decks ?? []).forEach((deck, i) => {
    const opt = document.createElement("option");
    opt.value = String(i + 1);
    opt.textContent = deck.name ? `${i + 1}: ${deck.name}` : `Deck ${i + 1}`;
    $deckSelect.appendChild(opt);
  });
  if (current && Array.from($deckSelect.options).some(o => o.value === current)) {
    $deckSelect.value = current;
  } else if ($deckSelect.dataset.pendingValue) {
    const p = $deckSelect.dataset.pendingValue;
    delete $deckSelect.dataset.pendingValue;
    if (Array.from($deckSelect.options).some(o => o.value === p)) $deckSelect.value = p;
  }
}

window.connectElgatoStreamDeckSocket = PiCore.createConnectFn({
  loadSettings(s) {
    if (s?.deckColumn != null) $deckColumn.value = s.deckColumn;

    // Deck: "current" or a 1-based deck number
    if (!s?.deckMode || s.deckMode === "current") {
      $deckSelect.value = "current";
    } else {
      const target = String(s.deck ?? 1);
      if (Array.from($deckSelect.options).some(o => o.value === target)) {
        $deckSelect.value = target;
      } else {
        $deckSelect.dataset.pendingValue = target;
      }
    }

    // Layer: "selected" (default) or explicit layer number
    if (!s?.layerMode || s.layerMode === "selected") {
      $layerSelect.value = "selected";
    } else {
      const target = String(s.layer ?? 1);
      if (Array.from($layerSelect.options).some(o => o.value === target)) {
        $layerSelect.value = target;
      } else {
        $layerSelect.dataset.pendingValue = target;
      }
    }
  },

  buildPayload() {
    const val           = $layerSelect.value;
    const isSelected    = val === "selected";
    const deckVal       = $deckSelect.value;
    const isCurrentDeck = deckVal === "current";
    return {
      layerMode:  isSelected ? "selected" : "fixed",
      layer:      isSelected ? 1 : (parseInt(val) || 1),
      deckColumn: parseInt($deckColumn.value) || 1,
      deckMode:   isCurrentDeck ? "current" : "fixed",
      deck:       isCurrentDeck ? 0 : (parseInt(deckVal) || 1),
    };
  },

  onOpen({ save, sendToPlugin }) {
    PiCore.bindAutoSave([$layerSelect, $deckSelect, $deckColumn], save);

    $refreshBtn.addEventListener("click", () => sendToPlugin({ event: "refreshCache" }));
    $bindBtn.addEventListener("click", () => {
      $bindHint.textContent = "Binding…";
      sendToPlugin({ event: "bindToSelected" });
    });
  },

  onPluginMessage(p) {
    if (Array.isArray(p.layers)) populateLayers(p.layers);
    if (Array.isArray(p.decks))  populateDecks(p.decks);

    if (p.event === "bindToSelectedResult") {
      $bindHint.textContent = p.ok
        ? `Bound to deck ${p.deck}, layer ${p.layer}, clip ${p.clip}.`
        : "No selected clip found in Resolume.";
    }
  },
});
