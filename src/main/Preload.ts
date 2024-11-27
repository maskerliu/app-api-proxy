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
  onGetSysSettings(callback: (result: LocalServerConfig) => void): void {
    ipcRenderer.on(ElectronAPICMD.getSysSettings, (_event, result: LocalServerConfig) => callback(result))
  },
  saveSysSettings(...args: any): void {
    ipcRenderer.invoke(ElectronAPICMD.saveSysSettings, args)
  },
  onOpenMockRuleMgr: function (callback: any): void {
    ipcRenderer.on(ElectronAPICMD.openMockRuleMgr, (_event) => callback())
  },
  onOpenSettings: function (callback: any): void {
    ipcRenderer.on(ElectronAPICMD.openSettings, (_event) => callback())
  }
}

contextBridge.exposeInMainWorld('electronAPI', apis)