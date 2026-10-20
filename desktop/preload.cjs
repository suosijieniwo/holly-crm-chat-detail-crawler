const { contextBridge, ipcRenderer } = require("electron");
const names = ["getState", "openBrowser", "startExport", "stopExport", "openOutputFolder", "openLatestFile", "clearJobs", "clearLogin"];
contextBridge.exposeInMainWorld("exporter", {
  ...Object.fromEntries(names.map(name => [name, () => ipcRenderer.invoke(`exporter:${name}`)])),
  onState(handler) {
    const listener = (_event, state) => handler(state);
    ipcRenderer.on("exporter:state", listener);
    return () => ipcRenderer.removeListener("exporter:state", listener);
  }
});
