const { contextBridge, ipcRenderer } = require("electron");
const names = ["getState", "openBrowser", "startExport", "stopExport", "selectOutputDirectory", "openOutputFolder", "openLatestFile", "clearJobs", "clearLogin"];
contextBridge.exposeInMainWorld("exporter", {
  ...Object.fromEntries(names.map(name => [name, () => ipcRenderer.invoke(`exporter:${name}`)])),
  setSenderSelection(selection) { return ipcRenderer.invoke("exporter:setSenderSelection", selection); },
  onState(handler) {
    const listener = (_event, state) => handler(state);
    ipcRenderer.on("exporter:state", listener);
    return () => ipcRenderer.removeListener("exporter:state", listener);
  }
});
