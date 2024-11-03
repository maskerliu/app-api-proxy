import { contextBridge, ipcRenderer, IpcRenderer } from 'electron'
import { IElectronAPI } from '../global'
import { callInterceptor } from 'vant/lib/utils'


let apis: IElectronAPI = {
  openFile: (...args: any) => ipcRenderer.invoke('dialog:openFile'),

  openGame: (...args: any) => ipcRenderer.invoke('openGame', args),

  onOpenMockRuleMgr: (callback: any) => ipcRenderer.on('openMockRuleMgr', (_event, value) => callback(value)),

  onOpenSettings: (callback: any) => ipcRenderer.on('openSettings', (_event, value) => callback(value))
}

contextBridge.exposeInMainWorld('electronAPI', apis)