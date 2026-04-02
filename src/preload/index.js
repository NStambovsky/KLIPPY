const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('klippy', {
  openFile: () => ipcRenderer.invoke('openFile'),
  getFileInfo: (path) => ipcRenderer.invoke('getFileInfo', path),
  transcribe: (audioPath, opts) => ipcRenderer.invoke('transcribe', audioPath, opts),
  exportEdit: (opts) => ipcRenderer.invoke('exportEdit', opts),
  exportClip: (opts) => ipcRenderer.invoke('exportClip', opts),
  findClipsAI: (transcript, opts) => ipcRenderer.invoke('findClipsAI', transcript, opts),
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (data) => ipcRenderer.invoke('settings:set', data),
  },
  // Returns an unsubscribe function
  on: (event, cb) => {
    const handler = (_, ...args) => cb(...args)
    ipcRenderer.on(event, handler)
    return () => ipcRenderer.removeListener(event, handler)
  },
})
