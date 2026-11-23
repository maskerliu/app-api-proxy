import type { LocalServerConfig } from "./base.models"
import type {
  MockPackExportOptions, MockPackExportProgress, MockPackImportOptions, MockPackImportResult,
  MockPackPreviewOptions, MockPackPreviewResult,
} from './mock.pack'
import type {
  MockShareBackupEstimate, MockShareBackupProgress, MockShareBackupResult, MockShareCheckResult,
  MockShareRemoteOverview,
} from './mock.share'

export const MAIN_API_CMD = {
  Relaunch: 'relaunch',
  SelectFile: 'selectFile',
  SelectFolder: 'selectFolder',
  OpenFolder: 'openFolder',
  SaveFileAs: 'saveFile',
  SelectSavePath: 'selectSavePath',
  ExportMockPack: 'exportMockPack',
  ExportPackProgress: 'exportPackProgress',
  MockShareCheck: 'mockShareCheck',
  MockShareEstimate: 'mockShareEstimate',
  MockShareBackup: 'mockShareBackup',
  MockShareCancel: 'mockShareCancel',
  MockShareProgress: 'mockShareProgress',
  MockShareOverview: 'mockShareOverview',
  MockSharePreview: 'mockSharePreview',
  MockShareImport: 'mockShareImport',
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
 * 主进程直调的回执。错误码必须自己带上：structured clone 只搬 `Error` 的 name/message/stack，
 * `MockError.code` 上了 IPC 就没了，而界面文案（`mock.share.*`）正是按码取的——
 * 只回一句 message 等于把 C5「不许统一成『同步失败』」在传输那一层抹平。
 */
export interface MainCallResult<T> {
  status: 'ok' | 'canceled' | 'failed'
  data?: T
  code?: string
  detail?: string
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

  /**
   * Mock 云共享（v1.3 Phase A）的桌面端入口。全部走主进程直调，不进 8884 那两个 multipart 端点：
   * 那两个端点收的是文件，而这里的失败归因空间（配置 / 网络 / 权限 / 内容 / 写 / 上限）比本地导入大一整截。
   * 备份正文与恢复正文都不经渲染进程——和导出同一个理由，几十 MB 经 IPC 会被克隆两遍。
   *
   * 「读取并预览」与「导入」各读一次远端：中间隔着用户点确认，快照留在这儿就等于把
   * 「远端此刻有什么」这句话改成「刚才那一刻有什么」。
   */
  mockShareCheck(): Promise<MainCallResult<MockShareCheckResult>>

  mockShareEstimate(): Promise<MainCallResult<MockShareBackupEstimate>>

  mockShareBackup(): Promise<MainCallResult<MockShareBackupResult>>

  mockShareCancel(): Promise<boolean>

  mockShareOverview(): Promise<MainCallResult<MockShareRemoteOverview>>

  mockSharePreview(keys: string[], options: MockPackPreviewOptions): Promise<MainCallResult<MockPackPreviewResult>>

  mockShareImport(keys: string[], options: MockPackImportOptions): Promise<MainCallResult<MockPackImportResult>>

  onMockShareProgress(callback: (progress?: MockShareBackupProgress) => void): void

  offMockShareProgress(): void

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
