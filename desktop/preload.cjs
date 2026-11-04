// Narrow bridge for overlay.html: one message channel each way, nothing else.
'use strict'
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('whaleDesktop', {
  send: (msg) => ipcRenderer.send('whale-mate', msg),
  on: (fn) => {
    const listener = (_e, msg) => fn(msg)
    ipcRenderer.on('whale-mate', listener)
    return () => ipcRenderer.removeListener('whale-mate', listener)
  }
})
