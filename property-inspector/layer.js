const $label = document.getElementById("label");

window.connectElgatoStreamDeckSocket = PiCore.createConnectFn({
  loadSettings(s) {
    $label.value = s?.label ?? "";
  },
  buildPayload() {
    return { label: $label.value.trim() };
  },
  onOpen({ save }) {
    PiCore.bindAutoSave([$label], save);
  },
});
