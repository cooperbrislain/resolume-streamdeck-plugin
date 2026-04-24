const $paramId        = document.getElementById("paramId");
const $paramHint      = document.getElementById("param-hint");
const $layerIndex     = document.getElementById("layerIndex");
const $layerParam     = document.getElementById("layerParam");
const $clipLayerIndex = document.getElementById("clipLayerIndex");
const $clipIndex      = document.getElementById("clipIndex");
const $clipUsePlaying = document.getElementById("clipUsePlaying");
const $clipParam      = document.getElementById("clipParam");
const $sensitivity    = document.getElementById("sensitivity");
const $sensitivityVal = document.getElementById("sensitivityValue");

const SOURCES = ["composition", "layer", "clip"];
let currentSource = "composition";
let saveFn = null;

/** Show/hide the right subsection and mark the chosen toggle active. */
function applySource(src) {
  currentSource = src;
  for (const s of SOURCES) {
    document.getElementById(`btn-${s}`).classList.toggle("active", s === src);
    document.getElementById(`${s}-section`).style.display = s === src ? "" : "none";
  }
}

/** Called from inline onclick in link.html. */
window.setSource = function (src) {
  applySource(src);
  saveFn?.();
};

/**
 * Populate both layer selects from the live layer list.
 * $layerIndex gets a leading "Currently selected" option (value "0").
 * $clipLayerIndex starts from layer 1.
 */
function populateLayers(layers) {
  if (!layers || layers.length === 0) return;

  // $layerIndex: "currently selected" first, then named layers
  const prevLayer = $layerIndex.value;
  while ($layerIndex.options.length > 0) $layerIndex.remove(0);
  const selOpt = document.createElement("option");
  selOpt.value = "0";
  selOpt.textContent = "Currently selected in Resolume";
  $layerIndex.appendChild(selOpt);
  layers.forEach((layer, i) => {
    const opt = document.createElement("option");
    opt.value = String(i + 1);
    opt.textContent = layer.name ? `${i + 1}: ${layer.name}` : `Layer ${i + 1}`;
    $layerIndex.appendChild(opt);
  });
  if (Array.from($layerIndex.options).some(o => o.value === prevLayer)) {
    $layerIndex.value = prevLayer;
  }

  // $clipLayerIndex: numbered layers only
  const prevClipLayer = $clipLayerIndex.value;
  while ($clipLayerIndex.options.length > 0) $clipLayerIndex.remove(0);
  layers.forEach((layer, i) => {
    const opt = document.createElement("option");
    opt.value = String(i + 1);
    opt.textContent = layer.name ? `${i + 1}: ${layer.name}` : `Layer ${i + 1}`;
    $clipLayerIndex.appendChild(opt);
  });
  if (prevClipLayer && Array.from($clipLayerIndex.options).some(o => o.value === prevClipLayer)) {
    $clipLayerIndex.value = prevClipLayer;
  }
}

function populateParamDropdown(params, connected) {
  while ($paramId.options.length > 1) $paramId.remove(1);
  if (!connected || params.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.disabled = true;
    opt.textContent = connected ? "(no dashboard params)" : "(not connected to Resolume)";
    $paramId.appendChild(opt);
    return;
  }
  for (const p of params) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    opt.dataset.min = p.min;
    opt.dataset.max = p.max;
    $paramId.appendChild(opt);
  }
}

function updateParamHint() {
  const opt = $paramId.selectedOptions[0];
  $paramHint.textContent = (!opt || !opt.value)
    ? ""
    : `Range: ${opt.dataset.min ?? 0} – ${opt.dataset.max ?? 1}`;
}

function updateSensitivityLabel() {
  $sensitivityVal.textContent = `${parseFloat($sensitivity.value).toFixed(1)}×`;
}

window.connectElgatoStreamDeckSocket = PiCore.createConnectFn({
  loadSettings(s) {
    applySource(s.source ?? "composition");

    if (currentSource === "layer") {
      const li = String(s.layerIndex ?? 0);
      if (Array.from($layerIndex.options).some(o => o.value === li)) $layerIndex.value = li;
      if (s.layerParam != null) $layerParam.value = s.layerParam;
    } else if (currentSource === "clip") {
      const li = String(s.layerIndex ?? 1);
      if (Array.from($clipLayerIndex.options).some(o => o.value === li)) $clipLayerIndex.value = li;
      const usePlaying = s.clipIndex === 0;
      $clipUsePlaying.checked = usePlaying;
      $clipIndex.disabled = usePlaying;
      if (!usePlaying && s.clipIndex != null) $clipIndex.value = s.clipIndex;
      if (s.clipParam != null) $clipParam.value = s.clipParam;
    } else if ("paramId" in s) {
      $paramId.value = s.paramId ?? "";
      updateParamHint();
    }

    const sens = (typeof s.sensitivity === "number" && s.sensitivity > 0) ? s.sensitivity : 1;
    $sensitivity.value = String(sens);
    updateSensitivityLabel();
  },

  buildPayload() {
    let payload;
    if (currentSource === "layer") {
      payload = {
        source:     "layer",
        layerIndex: parseInt($layerIndex.value),
        layerParam: $layerParam.value || "opacity",
        paramId:    null,
      };
    } else if (currentSource === "clip") {
      const useCurrent = $clipUsePlaying.checked;
      payload = {
        source:     "clip",
        layerIndex: parseInt($clipLayerIndex.value) || 1,
        clipIndex:  useCurrent ? 0 : (parseInt($clipIndex.value) || 1),
        clipParam:  $clipParam.value || "opacity",
        paramId:    null,
      };
    } else {
      const raw = $paramId.value;
      payload = {
        source:  "composition",
        paramId: raw ? parseInt(raw) : null,
      };
    }
    payload.sensitivity = parseFloat($sensitivity.value) || 1;
    return payload;
  },

  onOpen({ sendToPlugin, save }) {
    saveFn = save;

    populateParamDropdown([], false);
    sendToPlugin({ event: "requestDashboardParams" });

    PiCore.bindAutoSave(
      [$layerIndex, $layerParam, $clipLayerIndex, $clipIndex, $clipParam, $sensitivity],
      save,
    );

    $paramId.addEventListener("change", () => { updateParamHint(); save(); });
    $clipUsePlaying.addEventListener("change", () => {
      $clipIndex.disabled = $clipUsePlaying.checked;
      save();
    });
    $sensitivity.addEventListener("input", updateSensitivityLabel);
  },

  onPluginMessage(p) {
    if (Array.isArray(p.layers)) populateLayers(p.layers);
    if (p.event === "dashboardParams") {
      populateParamDropdown(p.params ?? [], p.connected === true);
      if (Array.isArray(p.layers)) populateLayers(p.layers);
      // Re-apply paramId now that the dropdown is populated
      updateParamHint();
    }
  },
});
