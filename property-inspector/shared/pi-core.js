/**
 * Shared Property Inspector boilerplate.
 *
 * Stream Deck's PI API uses a global entry point — `connectElgatoStreamDeckSocket`
 * — called by the host with connection info for the current action instance.
 * This helper abstracts the standard wire-up so each PI script can focus on
 * its own form fields.
 *
 * Usage:
 *
 *   window.connectElgatoStreamDeckSocket = PiCore.createConnectFn({
 *     loadSettings(settings, { sendToPlugin })        {},
 *     buildPayload()                                   { return {...}; },
 *     onPluginMessage(payload, { sendToPlugin })       {},
 *   });
 *
 *   // In your DOM code:
 *   PiCore.bindAutoSave([$field1, $field2]);
 */

(function (global) {
  "use strict";

  function setStatus(connected) {
    const dot = document.getElementById("status-dot");
    const txt = document.getElementById("status-text");
    if (dot) dot.className = "status-dot" + (connected ? " connected" : "");
    if (txt) txt.textContent = connected ? "Connected to Resolume" : "Not connected";
  }

  /**
   * Build a `connectElgatoStreamDeckSocket` implementation.
   *
   * Hooks:
   *   - loadSettings(settings, api)   — called when initial or updated
   *                                     settings arrive. Populate form fields.
   *   - buildPayload()                — return the settings object to save.
   *                                     Called by the internal save() helper
   *                                     (returned in the api object).
   *   - onPluginMessage(payload, api) — called on every message forwarded
   *                                     from the plugin (sendToPropertyInspector).
   *                                     Also receives `connected`/`layers`/`decks`
   *                                     hints, but common ones (connected,
   *                                     setStatus) are handled automatically.
   */
  function createConnectFn(hooks) {
    return function connectElgatoStreamDeckSocket(port, uuid, registerEvent, _info, actionInfo) {
      const ws     = new WebSocket(`ws://127.0.0.1:${port}`);
      const parsed = JSON.parse(actionInfo);
      const action = parsed?.action ?? "";

      function sendToPlugin(payload) {
        ws.send(JSON.stringify({ event: "sendToPlugin", action, context: uuid, payload }));
      }

      function save() {
        const payload = hooks.buildPayload?.() ?? {};
        ws.send(JSON.stringify({ event: "setSettings", context: uuid, payload }));
      }

      const api = { sendToPlugin, save, uuid };

      ws.onopen = () => {
        ws.send(JSON.stringify({ event: registerEvent, uuid }));
        hooks.loadSettings?.(parsed?.payload?.settings ?? {}, api);
        sendToPlugin({ event: "requestConnectionStatus" });
        hooks.onOpen?.(api);
      };

      ws.onmessage = (evt) => {
        let msg;
        try { msg = JSON.parse(evt.data); } catch { return; }

        if (msg.event === "didReceiveSettings") {
          hooks.loadSettings?.(msg.payload?.settings ?? {}, api);
        }

        if (msg.event === "sendToPropertyInspector") {
          const p = msg.payload ?? {};
          if (typeof p.connected === "boolean") setStatus(p.connected);
          hooks.onPluginMessage?.(p, api);
        }
      };
    };
  }

  /** Auto-save when any of the given elements change. */
  function bindAutoSave(elements, save) {
    for (const el of elements) {
      if (!el) continue;
      el.addEventListener("change", save);
    }
  }

  global.PiCore = { createConnectFn, bindAutoSave, setStatus };
})(window);
