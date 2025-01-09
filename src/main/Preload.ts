import { contextBridge, ipcRenderer } from 'electron'
import { LocalServerConfig } from '../common/base.models'
import { ElectronAPICMD, IElectronAPI } from '../common/ipc.api'


let apis: IElectronAPI = {
  relaunch() {
    ipcRenderer.invoke(ElectronAPICMD.Relaunch)
  },
  openFile: function (...args: any): Promise<void> {
    ipcRenderer.invoke('dialog:openFile')
    return null
  },
  openDevTools(...args: any) {
    ipcRenderer.invoke(ElectronAPICMD.OpenDevTools, args)
  },
  saveSysSettings(...args: any) {
    ipcRenderer.invoke(ElectronAPICMD.SaveSysSettings, args)
  },
  downloadUpdate(newVersion: any) {
    ipcRenderer.invoke(ElectronAPICMD.DownloadUpdate, newVersion)
  },

  sendServerEvent: function (): void {
    ipcRenderer.invoke(ElectronAPICMD.SendServerEvent)
  },

  getSysSettings(callback: (result: LocalServerConfig) => void) {
    ipcRenderer.on(ElectronAPICMD.GetSysSettings, (_event, result: LocalServerConfig) => callback(result))
  },

  setAppTheme(theme: ('system' | 'light' | 'dark')) {
    ipcRenderer.invoke(ElectronAPICMD.SetAppTheme, theme)
  },

  getSysTheme(callback: any) {
    ipcRenderer.on(ElectronAPICMD.GetSysTheme, (theme) => callback(theme))
  },

  onOpenMockRuleMgr(callback: any) {
    ipcRenderer.on(ElectronAPICMD.OpenMockRuleMgr, (_event) => callback())
  },

  onOpenSettings(callback: any) {
    ipcRenderer.on(ElectronAPICMD.OpenSettings, (_event) => callback())
  },

  onSysThemeChanged(callback: (theme: string) => void) {
    ipcRenderer.on(ElectronAPICMD.SysThemeChanged, (_, theme: string) => callback(theme))
  },

  onDownloadUpdate(callback: (...args: any) => void) {
    ipcRenderer.on(ElectronAPICMD.DownloadUpdate, (_, ...args: any) => callback(...args))
  },
}

contextBridge.exposeInMainWorld('electronAPI', apis)