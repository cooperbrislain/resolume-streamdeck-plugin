/// <reference path="../node_modules/@elgato/streamdeck/property-inspector/index.d.ts" />

const $keypadSection  = document.getElementById("keypad-section");
const $encoderSection = document.getElementById("encoder-section");
const $layer    = document.getElementById("layer");
const $clip     = document.getElementById("clip");
const $paramId  = document.getElementById("paramId");
const $paramHint = document.getElementById("param-hint");
const $statusDot  = document.getElementById("status-dot");
const $statusText = document.getElementById("status-text");

window.connectElgatoStreamDeckSocket = function (port, uuid, registerEvent, info, actionInfo) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const parsed   = JSON.parse(actionInfo);
  const action   = parsed?.action ?? "";
  const isEncoder = parsed?.payload?.controller === "Encoder";

  // Show the right section
  if (isEncoder) {
    $encoderSection.hidden = false;
  } else {
    $keypadSection.hidden = false;
  }

  function sendToPlugin(payload) {
    ws.send(JSON.stringify({ event: "sendToPlugin", action, context: uuid, payload }));
  }

  ws.onopen = () => {
    ws.send(JSON.stringify({ event: registerEvent, uuid }));
    applySettings(parsed?.payload?.settings ?? {});

    // Always ask the plugin for current connection status
    sendToPlugin({ event: "requestConnectionStatus" });

    if (isEncoder) {
      // Populate with just the bank option until Resolume responds
      populateParamDropdown([], false);
      applySettings(parsed?.payload?.settings ?? {});
      // Ask the plugin for available dashboard params
      sendToPlugin({ event: "requestDashboardParams" });
    }
  };

  ws.onmessage = (evt) => {
    const msg = JSON.parse(evt.data);

    if (msg.event === "didReceiveSettings") {
      applySettings(msg.payload?.settings ?? {});
    }

    if (msg.event === "sendToPropertyInspector") {
      const payload = msg.payload ?? {};
      if (typeof payload.connected === "boolean") {
        setConnectionStatus(payload.connected);
      }
      if (payload.event === "dashboardParams") {
        populateParamDropdown(payload.params ?? [], payload.connected === true);
        applySettings(parsed?.payload?.settings ?? {});
      }
    }
  };

  function saveSettings() {
    let settings;
    if (isEncoder) {
      const raw = $paramId.value;
      if (raw === "__bank__") {
        settings = { mode: "bank", paramId: null };
      } else {
        settings = { mode: "param", paramId: raw ? parseInt(raw) : null };
      }
    } else {
      settings = {
        layer: parseInt($layer.value) || 1,
        clip:  parseInt($clip.value)  || 1,
      };
    }
    ws.send(JSON.stringify({ event: "setSettings", context: uuid, payload: settings }));
  }

  $layer.addEventListener("change", saveSettings);
  $clip.addEventListener("change", saveSettings);
  $paramId.addEventListener("change", () => {
    saveSettings();
    updateParamHint();
  });
};

function applySettings(settings) {
  if (settings.layer != null) $layer.value = settings.layer;
  if (settings.clip  != null) $clip.value  = settings.clip;
  if (settings.mode === "bank") {
    $paramId.value = "__bank__";
    updateParamHint();
  } else if ("paramId" in settings) {
    $paramId.value = settings.paramId ?? "";
    updateParamHint();
  }
}

function populateParamDropdown(params, connected) {
  // Keep only the first "unassigned" option, rebuild the rest
  while ($paramId.options.length > 1) $paramId.remove(1);

  // Always add bank navigation option
  const bankOpt = document.createElement("option");
  bankOpt.value = "__bank__";
  bankOpt.textContent = "← → Bank / Scene Navigation";
  $paramId.appendChild(bankOpt);

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
  if (!opt || !opt.value || opt.value === "__bank__") { $paramHint.textContent = ""; return; }
  const min = parseFloat(opt.dataset.min ?? "0");
  const max = parseFloat(opt.dataset.max ?? "1");
  $paramHint.textContent = `Range: ${min} – ${max}`;
}

function setConnectionStatus(connected) {
  $statusDot.className = "status-dot" + (connected ? " connected" : "");
  $statusText.textContent = connected ? "Connected to Resolume" : "Not connected";
}
