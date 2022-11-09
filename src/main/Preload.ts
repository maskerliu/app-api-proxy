import { contextBridge, ipcRenderer } from 'electron'
import { IElectronAPI } from '../global'



let apis: IElectronAPI = {
  openFile: (...args: any) => ipcRenderer.invoke('dialog:openFile'),

  openGame: (...args: any) => ipcRenderer.invoke('openGame', args),

}

contextBridge.exposeInMainWorld('electronAPI', apis)