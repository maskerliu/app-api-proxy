import { ipcRenderer } from 'electron'
import type { LocalServerConfig } from '@shared/base.models'
import type {
  MockPackExportOptions, MockPackExportProgress, MockPackImportOptions, MockPackImportResult,
  MockPackPreviewOptions, MockPackPreviewResult,
} from '@shared/mock.pack'
import type {
  MockShareBackupEstimate, MockShareBackupProgress, MockShareBackupResult, MockShareCheckResult,
  MockShareRemoteOverview,
} from '@shared/mock.share'
import {
  IMainAPI, MAIN_API_CMD, MainCallResult, SaveFileResult, SaveMockPackResult, SelectSavePathResult,
} from '@shared/ipc.api'

let downloadUpdateListener: ((event: any, ...args: any[]) => void) | null = null
let exportPackProgressListener: ((event: any, ...args: any[]) => void) | null = null
let shareProgressListener: ((event: any, ...args: any[]) => void) | null = null

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
  async saveFile(title: string, fileName: string, file: string | ArrayBuffer, silent: boolean = false): Promise<SaveFileResult> {
    return ipcRenderer.invoke(MAIN_API_CMD.SaveFileAs, title, fileName, file, silent)
  },
  async selectSavePath(title: string, fileName: string): Promise<SelectSavePathResult> {
    return ipcRenderer.invoke(MAIN_API_CMD.SelectSavePath, title, fileName)
  },
  async exportMockPack(filePath: string, options: MockPackExportOptions): Promise<SaveMockPackResult> {
    return ipcRenderer.invoke(MAIN_API_CMD.ExportMockPack, filePath, options)
  },
  async mockShareCheck(): Promise<MainCallResult<MockShareCheckResult>> {
    return ipcRenderer.invoke(MAIN_API_CMD.MockShareCheck)
  },
  async mockShareEstimate(): Promise<MainCallResult<MockShareBackupEstimate>> {
    return ipcRenderer.invoke(MAIN_API_CMD.MockShareEstimate)
  },
  async mockShareBackup(): Promise<MainCallResult<MockShareBackupResult>> {
    return ipcRenderer.invoke(MAIN_API_CMD.MockShareBackup)
  },
  async mockShareCancel(): Promise<boolean> {
    return ipcRenderer.invoke(MAIN_API_CMD.MockShareCancel)
  },
  async mockShareOverview(): Promise<MainCallResult<MockShareRemoteOverview>> {
    return ipcRenderer.invoke(MAIN_API_CMD.MockShareOverview)
  },
  async mockSharePreview(keys: string[], options: MockPackPreviewOptions): Promise<MainCallResult<MockPackPreviewResult>> {
    return ipcRenderer.invoke(MAIN_API_CMD.MockSharePreview, keys, options)
  },
  async mockShareImport(keys: string[], options: MockPackImportOptions): Promise<MainCallResult<MockPackImportResult>> {
    return ipcRenderer.invoke(MAIN_API_CMD.MockShareImport, keys, options)
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

  onExportPackProgress(callback: (progress?: MockPackExportProgress) => void) {
    if (exportPackProgressListener != null) ipcRenderer.removeListener(MAIN_API_CMD.ExportPackProgress, exportPackProgressListener)
    exportPackProgressListener = (_, progress: MockPackExportProgress) => callback(progress)
    ipcRenderer.on(MAIN_API_CMD.ExportPackProgress, exportPackProgressListener)
  },

  offExportPackProgress() {
    if (exportPackProgressListener != null) {
      ipcRenderer.removeListener(MAIN_API_CMD.ExportPackProgress, exportPackProgressListener)
      exportPackProgressListener = null
    }
  },

  onMockShareProgress(callback: (progress?: MockShareBackupProgress) => void) {
    if (shareProgressListener != null) ipcRenderer.removeListener(MAIN_API_CMD.MockShareProgress, shareProgressListener)
    shareProgressListener = (_, progress: MockShareBackupProgress) => callback(progress)
    ipcRenderer.on(MAIN_API_CMD.MockShareProgress, shareProgressListener)
  },

  offMockShareProgress() {
    if (shareProgressListener != null) {
      ipcRenderer.removeListener(MAIN_API_CMD.MockShareProgress, shareProgressListener)
      shareProgressListener = null
    }
  },
}

export default mainApi
