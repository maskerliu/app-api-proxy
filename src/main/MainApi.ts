import { ipcRenderer } from 'electron'
import { LocalServerConfig } from '@shared/base.models'
import { IMainAPI, MainApiCmd } from '@shared/ipc.api'

const mainApi: IMainAPI = {
  relaunch() {
    ipcRenderer.invoke(MainApiCmd.Relaunch)
  },
  selectFile(callback: Function): void {
    ipcRenderer.invoke(MainApiCmd.SelectFile)
    ipcRenderer.once(MainApiCmd.SelectFile, (event, result) => callback(result))
  },
  selectFolder(callback: Function): void {
    ipcRenderer.invoke(MainApiCmd.SelectFolder)
    ipcRenderer.once(MainApiCmd.SelectFolder, (event, result) => callback(result))
  },
  openFolder(path: string) {
    ipcRenderer.invoke(MainApiCmd.OpenFolder, path)
  },
  saveFile(title: string, fileName: string, file: string | ArrayBuffer, slient: boolean = false): void {
    ipcRenderer.invoke(MainApiCmd.SaveFileAs, title, fileName, file, slient)
  },
  openDevTools(...args: any) {
    ipcRenderer.invoke(MainApiCmd.OpenDevTools, args)
  },
  updateBizConfig(...args: any) {
    ipcRenderer.invoke(MainApiCmd.UpdateBizConfig, args)
  },
  downloadUpdate(newVersion: any) {
    ipcRenderer.invoke(MainApiCmd.DownloadUpdate, newVersion)
  },

  sendServerEvent: function (): void {
    ipcRenderer.invoke(MainApiCmd.SendServerEvent)
  },

  getBizConfig(callback: (result: LocalServerConfig) => void) {
    ipcRenderer.once(MainApiCmd.GetBizConfig, (_event, result: LocalServerConfig) => callback(result))
  },

  setAppTheme(theme: ('system' | 'light' | 'dark')) {
    ipcRenderer.invoke(MainApiCmd.SetAppTheme, theme)
  },

  getSysTheme(callback: any) {
    ipcRenderer.once(MainApiCmd.GetSysTheme, (theme) => callback(theme))
  },

  onOpenMockRuleMgr(callback: any) {
    ipcRenderer.once(MainApiCmd.OpenMockRuleMgr, (_event) => callback())
  },

  onOpenSettings(callback: any) {
    ipcRenderer.once(MainApiCmd.OpenSettings, (_event) => callback())
  },

  onSysThemeChanged(callback: (theme: string) => void) {
    ipcRenderer.once(MainApiCmd.SysThemeChanged, (_, theme: string) => callback(theme))
  },

  onDownloadUpdate(callback: (...args: any) => void) {
    ipcRenderer.once(MainApiCmd.DownloadUpdate, (_, ...args: any) => callback(...args))
  },
}

export default mainApi
