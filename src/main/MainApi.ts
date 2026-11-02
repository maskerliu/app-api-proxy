import { ipcRenderer } from 'electron'
import type { LocalServerConfig } from '@shared/base.models'
import { IMainAPI, MainApiCmd } from '@shared/ipc.api'

let downloadUpdateListener: ((event: any, ...args: any[]) => void) | null = null

const mainApi: IMainAPI = {
  relaunch() {
    ipcRenderer.invoke(MainApiCmd.Relaunch)
  },
  async selectFile(callback?: Function): Promise<string | undefined> {
    const result = await ipcRenderer.invoke(MainApiCmd.SelectFile)
    callback?.(result)
    return result
  },
  async selectFolder(callback?: Function): Promise<string | undefined> {
    const result = await ipcRenderer.invoke(MainApiCmd.SelectFolder)
    callback?.(result)
    return result
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
  updateBizConfig(...args: any): Promise<LocalServerConfig> {
    return ipcRenderer.invoke(MainApiCmd.UpdateBizConfig, ...args)
  },
  downloadUpdate(newVersion: any) {
    ipcRenderer.invoke(MainApiCmd.DownloadUpdate, newVersion)
      .catch(err => console.error('downloadUpdate failed:', err))
  },

  sendServerEvent: function (): void {
    ipcRenderer.invoke(MainApiCmd.SendServerEvent)
  },

  writeClipboard(text: string): Promise<void> {
    return ipcRenderer.invoke(MainApiCmd.WriteClipboard, text)
  },

  getBizConfig(callback: (result: LocalServerConfig) => void) {
    ipcRenderer.invoke(MainApiCmd.GetBizConfig)
      .then((result: LocalServerConfig) => callback(result))
      .catch(err => console.error('getBizConfig failed:', err))
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
    if (downloadUpdateListener != null) ipcRenderer.removeListener(MainApiCmd.DownloadUpdate, downloadUpdateListener)
    downloadUpdateListener = (_, ...args: any) => callback(...args)
    ipcRenderer.on(MainApiCmd.DownloadUpdate, downloadUpdateListener)
  },

  offDownloadUpdate() {
    if (downloadUpdateListener != null) {
      ipcRenderer.removeListener(MainApiCmd.DownloadUpdate, downloadUpdateListener)
      downloadUpdateListener = null
    }
  },
}

export default mainApi
