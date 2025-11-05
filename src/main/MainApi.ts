import { ipcRenderer } from 'electron'
import { LocalServerConfig } from '../common/base.models'
import { IMainAPI, MainAPICMD } from '../common/ipc.api'

let mainApi: IMainAPI = {
  relaunch() {
    ipcRenderer.invoke(MainAPICMD.Relaunch)
  },
  openFile: function (...args: any): Promise<void> {
    ipcRenderer.invoke('dialog:openFile')
    return null
  },
  openDevTools(...args: any) {
    ipcRenderer.invoke(MainAPICMD.OpenDevTools, args)
  },
  saveSysSettings(...args: any) {
    ipcRenderer.invoke(MainAPICMD.SaveSysSettings, args)
  },
  downloadUpdate(newVersion: any) {
    ipcRenderer.invoke(MainAPICMD.DownloadUpdate, newVersion)
  },

  sendServerEvent: function (): void {
    ipcRenderer.invoke(MainAPICMD.SendServerEvent)
  },

  getSysSettings(callback: (result: LocalServerConfig) => void) {
    ipcRenderer.on(MainAPICMD.GetSysSettings, (_event, result: LocalServerConfig) => callback(result))
  },

  setAppTheme(theme: ('system' | 'light' | 'dark')) {
    ipcRenderer.invoke(MainAPICMD.SetAppTheme, theme)
  },

  getSysTheme(callback: any) {
    ipcRenderer.on(MainAPICMD.GetSysTheme, (theme) => callback(theme))
  },

  onOpenMockRuleMgr(callback: any) {
    ipcRenderer.on(MainAPICMD.OpenMockRuleMgr, (_event) => callback())
  },

  onOpenSettings(callback: any) {
    ipcRenderer.on(MainAPICMD.OpenSettings, (_event) => callback())
  },

  onSysThemeChanged(callback: (theme: string) => void) {
    ipcRenderer.on(MainAPICMD.SysThemeChanged, (_, theme: string) => callback(theme))
  },

  onDownloadUpdate(callback: (...args: any) => void) {
    ipcRenderer.on(MainAPICMD.DownloadUpdate, (_, ...args: any) => callback(...args))
  },
}

export default mainApi