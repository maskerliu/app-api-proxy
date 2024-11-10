import { contextBridge, ipcRenderer } from 'electron'
import { ElectronAPICMD, IElectronAPI } from '../common/ipc.api'


let apis: IElectronAPI = {
  openFile: function (...args: any): Promise<void> {
    ipcRenderer.invoke('dialog:openFile')
    return null
  },
  onOpenMockRuleMgr: function (callback: any): void {
    ipcRenderer.on(ElectronAPICMD.openMockRuleMgr, (_event) => callback())
  },
  onOpenSettings: function (callback: any): void {
    ipcRenderer.on(ElectronAPICMD.openSettings, (_event) => callback())
  }
}

contextBridge.exposeInMainWorld('electronAPI', apis)