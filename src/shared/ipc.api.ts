import type { LocalServerConfig } from "./base.models"

export const MainApiCmd = {
  Relaunch: 'relaunch',
  SelectFile: 'selectFile',
  SelectFolder: 'selectFolder',
  OpenFolder: 'openFolder',
  SaveFileAs: 'saveFile',
  OpenDevTools: 'openDevTools',
  OpenMockRuleMgr: 'openMockRuleMgr',
  OpenSettings: 'openSettings',
  GetBizConfig: 'getBizConfig',
  UpdateBizConfig: 'updateBizConfig',
  SetAppTheme: 'setAppTheme',
  GetSysTheme: 'getSysTheme',
  SysThemeChanged: 'sysThemeChanged',
  DownloadUpdate: 'downloadUpdate',
  SendServerEvent: 'sendServerEvent',
  WriteClipboard: 'writeClipboard'
}

export interface IMainAPI {

  relaunch(): void

  selectFile(callback?: (result?: string) => void): Promise<string | undefined>

  selectFolder(callback?: (result?: string) => void): Promise<string | undefined>

  openFolder(path: string): void

  saveFile(title: string, fileName: string, file: string | ArrayBuffer, slient?: boolean): void

  openDevTools(...args: any): void

  updateBizConfig(...args: any): Promise<LocalServerConfig>

  sendServerEvent(): void

  writeClipboard(text: string): Promise<void>

  downloadUpdate(...args: any): void

  onOpenMockRuleMgr(callback: any): void

  onOpenSettings(callback: any): void

  getBizConfig(callback: (result: LocalServerConfig) => void): void

  setAppTheme(theme: ('system' | 'light' | 'dark')): void

  getSysTheme(callback: any): void

  onSysThemeChanged(callback: (theme: string) => void): void

  onDownloadUpdate(callback: any): void

  offDownloadUpdate(): void
}
