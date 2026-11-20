import type { LocalServerConfig } from "./base.models"
import type { MockPackExportOptions, MockPackExportProgress } from './mock.pack'

export const MAIN_API_CMD = {
  Relaunch: 'relaunch',
  SelectFile: 'selectFile',
  SelectFolder: 'selectFolder',
  OpenFolder: 'openFolder',
  SaveFileAs: 'saveFile',
  SelectSavePath: 'selectSavePath',
  ExportMockPack: 'exportMockPack',
  ExportPackProgress: 'exportPackProgress',
  OpenDevTools: 'openDevTools',
  OpenMockRuleMgr: 'openMockRuleMgr',
  OpenSettings: 'openSettings',
  OpenOnboarding: 'openOnboarding',
  GetBizConfig: 'getBizConfig',
  UpdateBizConfig: 'updateBizConfig',
  SetAppTheme: 'setAppTheme',
  DownloadUpdate: 'downloadUpdate',
  CancelUpdate: 'cancelUpdate',
  WriteClipboard: 'writeClipboard'
}

/**
 * @public
 * 落盘结果三态：用户取消不是失败。合成一个布尔会让 UI 在取消后弹「导出失败」。
 */
export interface SaveFileResult {
  status: 'saved' | 'canceled' | 'failed'
  filePath?: string
  error?: string
}

/**
 * @public
 * 只弹保存框拿路径，不写任何字节。导出必须走这一步再加 `exportMockPack`：
 * 合成一把 `saveFile(data)` 就等于把几十 MB 的包文本经 structured clone 搬进渲染进程再搬回来，
 * 内存峰值下界仍是包体积（见技术设计 6.3 基准）。
 */
export interface SelectSavePathResult {
  status: 'selected' | 'canceled'
  filePath?: string
}

/**
 * @public
 * 落盘回执带条数：UI 据此提示「已导出 N 条」，并在超过 `MOCK_PACK_MAX_RECORDS` 时说明
 * 这份包本程序读得动、导入侧却会整包拒绝。
 */
export interface SaveMockPackResult extends SaveFileResult {
  ruleCount?: number
  recordCount?: number
}

export interface IMainAPI {

  relaunch(): void

  selectFile(callback?: (result?: string) => void): Promise<string | undefined>

  selectFolder(callback?: (result?: string) => void): Promise<string | undefined>

  openFolder(path: string): void

  saveFile(title: string, fileName: string, file: string | ArrayBuffer, silent?: boolean): Promise<SaveFileResult>

  selectSavePath(title: string, fileName: string): Promise<SelectSavePathResult>

  exportMockPack(filePath: string, options: MockPackExportOptions): Promise<SaveMockPackResult>

  openDevTools(...args: any): void

  updateBizConfig(...args: any): Promise<LocalServerConfig>

  writeClipboard(text: string): Promise<void>

  downloadUpdate(...args: any): void

  cancelUpdate(): void

  onOpenMockRuleMgr(callback: any): void

  onOpenSettings(callback: any): void

  onOpenOnboarding(callback: any): void

  getBizConfig(callback: (result: LocalServerConfig) => void): void

  setAppTheme(theme: ('system' | 'light' | 'dark')): void

  onDownloadUpdate(callback: any): void

  offDownloadUpdate(): void

  /**
   * 导出进度推送：桌面端的导出是主进程边拼边写，渲染层手里没有字节，
   * 不推就只能在对话框上挂一个和进度无关的转圈（本仓库明确不用 toast 承载进度）。
   */
  onExportPackProgress(callback: (progress?: MockPackExportProgress) => void): void

  offExportPackProgress(): void
}
