import { ipcRenderer } from 'electron'
import { LocalServerConfig } from '../common/base.models'
import { IMainAPI, MainAPICMD } from '../common/ipc.api'

let mainApi: IMainAPI = {
  relaunch() {
    ipcRenderer.invoke(MainAPICMD.Relaunch)
  },
  openFile: function (callback: Function): void {
    ipcRenderer.invoke(MainAPICMD.OpenFile)
    ipcRenderer.once(MainAPICMD.OpenFile, (event, result) => callback(result))
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
    ipcRenderer.once(MainAPICMD.GetSysSettings, (_event, result: LocalServerConfig) => callback(result))
  },

  setAppTheme(theme: ('system' | 'light' | 'dark')) {
    ipcRenderer.invoke(MainAPICMD.SetAppTheme, theme)
  },

  getSysTheme(callback: any) {
    ipcRenderer.once(MainAPICMD.GetSysTheme, (theme) => callback(theme))
  },

  onOpenMockRuleMgr(callback: any) {
    ipcRenderer.once(MainAPICMD.OpenMockRuleMgr, (_event) => callback())
  },

  onOpenSettings(callback: any) {
    ipcRenderer.once(MainAPICMD.OpenSettings, (_event) => callback())
  },

  onSysThemeChanged(callback: (theme: string) => void) {
    ipcRenderer.once(MainAPICMD.SysThemeChanged, (_, theme: string) => callback(theme))
  },

  onDownloadUpdate(callback: (...args: any) => void) {
    ipcRenderer.once(MainAPICMD.DownloadUpdate, (_, ...args: any) => callback(...args))
  },
}

export default mainApi