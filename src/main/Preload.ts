import { contextBridge, ipcRenderer } from 'electron'
import { LocalServerConfig } from '../common/base.models'
import { ElectronAPICMD, IElectronAPI } from '../common/ipc.api'


let apis: IElectronAPI = {
  openFile: function (...args: any): Promise<void> {
    ipcRenderer.invoke('dialog:openFile')
    return null
  },
  openDevTools(...args: any): void {
    ipcRenderer.invoke(ElectronAPICMD.openDevTools, args)
  },
  saveSysSettings(...args: any): void {
    ipcRenderer.invoke(ElectronAPICMD.saveSysSettings, args)
  },
  downloadUpdate(...args: any) {
    ipcRenderer.invoke(ElectronAPICMD.downloadUpdate, args)
  },

  onGetSysSettings(callback: (result: LocalServerConfig) => void): void {
    ipcRenderer.on(ElectronAPICMD.getSysSettings, (_event, result: LocalServerConfig) => callback(result))
  },

  onOpenMockRuleMgr: function (callback: any): void {
    ipcRenderer.on(ElectronAPICMD.openMockRuleMgr, (_event) => callback())
  },

  onOpenSettings: function (callback: any): void {
    ipcRenderer.on(ElectronAPICMD.openSettings, (_event) => callback())
  },

  onDownloadUpdate(callback: (...args: any) => void) {
    ipcRenderer.on(ElectronAPICMD.downloadUpdate, (_event, ...args: any) => callback(...args))
  }
}

contextBridge.exposeInMainWorld('electronAPI', apis)