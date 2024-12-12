import { contextBridge, ipcRenderer } from 'electron'
import { LocalServerConfig } from '../common/base.models'
import { ElectronAPICMD, IElectronAPI } from '../common/ipc.api'


let apis: IElectronAPI = {
  openFile: function (...args: any): Promise<void> {
    ipcRenderer.invoke('dialog:openFile')
    return null
  },
  openDevTools(...args: any): void {
    ipcRenderer.invoke(ElectronAPICMD.OpenDevTools, args)
  },
  saveSysSettings(...args: any): void {
    ipcRenderer.invoke(ElectronAPICMD.SaveSysSettings, args)
  },
  downloadUpdate(...args: any) {
    ipcRenderer.invoke(ElectronAPICMD.DownloadUpdate, args)
  },

  getSysSettings(callback: (result: LocalServerConfig) => void): void {
    ipcRenderer.on(ElectronAPICMD.GetSysSettings, (_event, result: LocalServerConfig) => callback(result))
  },

  setAppTheme(theme: ('system' | 'light' | 'dark')): void {
    ipcRenderer.invoke(ElectronAPICMD.SetAppTheme, theme)
  },

  getSysTheme(callback: any): void {
    ipcRenderer.on(ElectronAPICMD.GetSysTheme, (theme) => callback(theme))
  },

  onOpenMockRuleMgr(callback: any): void {
    ipcRenderer.on(ElectronAPICMD.OpenMockRuleMgr, (_event) => callback())
  },

  onOpenSettings(callback: any): void {
    ipcRenderer.on(ElectronAPICMD.OpenSettings, (_event) => callback())
  },

  onSysThemeChanged(callback: (theme: string) => void): void {
    ipcRenderer.on(ElectronAPICMD.SysThemeChanged, (_, theme: string) => callback(theme))
  },

  onDownloadUpdate(callback: (...args: any) => void) {
    ipcRenderer.on(ElectronAPICMD.DownloadUpdate, (_, ...args: any) => callback(...args))
  }
}

contextBridge.exposeInMainWorld('electronAPI', apis)