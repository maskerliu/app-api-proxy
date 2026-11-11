import { ipcRenderer } from 'electron'
import type { LocalServerConfig } from '@shared/base.models'
import { IMainAPI, MAIN_API_CMD } from '@shared/ipc.api'

let downloadUpdateListener: ((event: any, ...args: any[]) => void) | null = null

const mainApi: IMainAPI = {
  relaunch() {
    ipcRenderer.invoke(MAIN_API_CMD.Relaunch)
  },
  async selectFile(callback?: Function): Promise<string | undefined> {
    const result = await ipcRenderer.invoke(MAIN_API_CMD.SelectFile)
    callback?.(result)
    return result
  },
  async selectFolder(callback?: Function): Promise<string | undefined> {
    const result = await ipcRenderer.invoke(MAIN_API_CMD.SelectFolder)
    callback?.(result)
    return result
  },
  openFolder(path: string) {
    ipcRenderer.invoke(MAIN_API_CMD.OpenFolder, path)
  },
  saveFile(title: string, fileName: string, file: string | ArrayBuffer, silent: boolean = false): void {
    ipcRenderer.invoke(MAIN_API_CMD.SaveFileAs, title, fileName, file, silent)
  },
  openDevTools(...args: any) {
    ipcRenderer.invoke(MAIN_API_CMD.OpenDevTools, args)
  },
  updateBizConfig(...args: any): Promise<LocalServerConfig> {
    return ipcRenderer.invoke(MAIN_API_CMD.UpdateBizConfig, ...args)
  },
  downloadUpdate(newVersion: any) {
    ipcRenderer.invoke(MAIN_API_CMD.DownloadUpdate, newVersion)
      .catch(err => console.error('downloadUpdate failed:', err))
  },

  cancelUpdate() {
    ipcRenderer.invoke(MAIN_API_CMD.CancelUpdate)
  },

  sendServerEvent: function (): void {
    ipcRenderer.invoke(MAIN_API_CMD.SendServerEvent)
  },

  writeClipboard(text: string): Promise<void> {
    return ipcRenderer.invoke(MAIN_API_CMD.WriteClipboard, text)
  },

  getBizConfig(callback: (result: LocalServerConfig) => void) {
    ipcRenderer.invoke(MAIN_API_CMD.GetBizConfig)
      .then((result: LocalServerConfig) => callback(result))
      .catch(err => console.error('getBizConfig failed:', err))
  },

  setAppTheme(theme: ('system' | 'light' | 'dark')) {
    ipcRenderer.invoke(MAIN_API_CMD.SetAppTheme, theme)
  },

  onOpenMockRuleMgr(callback: any) {
    ipcRenderer.once(MAIN_API_CMD.OpenMockRuleMgr, (_event) => callback())
  },

  onOpenSettings(callback: any) {
    ipcRenderer.once(MAIN_API_CMD.OpenSettings, (_event) => callback())
  },

  onOpenOnboarding(callback: any) {
    ipcRenderer.once(MAIN_API_CMD.OpenOnboarding, (_event) => callback())
  },

  onDownloadUpdate(callback: (...args: any) => void) {
    if (downloadUpdateListener != null) ipcRenderer.removeListener(MAIN_API_CMD.DownloadUpdate, downloadUpdateListener)
    downloadUpdateListener = (_, ...args: any) => callback(...args)
    ipcRenderer.on(MAIN_API_CMD.DownloadUpdate, downloadUpdateListener)
  },

  offDownloadUpdate() {
    if (downloadUpdateListener != null) {
      ipcRenderer.removeListener(MAIN_API_CMD.DownloadUpdate, downloadUpdateListener)
      downloadUpdateListener = null
    }
  },
}

export default mainApi
