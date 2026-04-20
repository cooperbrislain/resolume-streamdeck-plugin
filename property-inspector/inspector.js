/// <reference path="../node_modules/@elgato/streamdeck/property-inspector/index.d.ts" />

const $host = document.getElementById("host");
const $port = document.getElementById("port");
const $gridWidth = document.getElementById("gridWidth");
const $gridHeight = document.getElementById("gridHeight");
const $statusDot = document.getElementById("status-dot");
const $statusText = document.getElementById("status-text");

// Load settings when the inspector opens
window.connectElgatoStreamDeckSocket = function (
  port,
  uuid,
  registerEvent,
  info,
  actionInfo
) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);

  ws.onopen = () => {
    ws.send(JSON.stringify({ event: registerEvent, uuid }));

    const parsed = JSON.parse(actionInfo);
    const settings = parsed?.payload?.settings ?? {};
    applySettings(settings);
  };

  ws.onmessage = (evt) => {
    const msg = JSON.parse(evt.data);
    if (msg.event === "didReceiveSettings") {
      applySettings(msg.payload?.settings ?? {});
    }
    if (msg.event === "sendToPropertyInspector") {
      const { connected } = msg.payload ?? {};
      setConnectionStatus(connected === true);
    }
  };

  function saveSettings() {
    const settings = {
      host: $host.value.trim() || "localhost",
      port: parseInt($port.value) || 8080,
      gridWidth: parseInt($gridWidth.value) || 4,
      gridHeight: parseInt($gridHeight.value) || 2,
    };
    ws.send(
      JSON.stringify({
        event: "setSettings",
        uuid,
        payload: settings,
      })
    );
  }

  [$host, $port, $gridWidth, $gridHeight].forEach((el) =>
    el.addEventListener("change", saveSettings)
  );
};

function applySettings(settings) {
  if (settings.host) $host.value = settings.host;
  if (settings.port) $port.value = settings.port;
  if (settings.gridWidth) $gridWidth.value = settings.gridWidth;
  if (settings.gridHeight) $gridHeight.value = settings.gridHeight;
}

function setConnectionStatus(connected) {
  $statusDot.className = "status-dot" + (connected ? " connected" : "");
  $statusText.textContent = connected ? "Connected to Resolume" : "Not connected";
}
