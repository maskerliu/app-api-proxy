import { LocalServerConfig } from "./base.models"


export const ElectronAPICMD = {
  openFile: 'openFile',
  openDevTools: 'openDevTools',
  openMockRuleMgr: 'openMockRuleMgr',
  openSettings: 'openSettings',
  getSysSettings: 'getSysSettings',
  saveSysSettings: 'saveSysSettings',
  sysThemeChanged: 'onSysThemeChanged'
}

export interface IElectronAPI {

  openFile(...args: any): Promise<void>

  openDevTools(...args: any): void

  onOpenMockRuleMgr(callback: any): void

  onOpenSettings(callback: any): void

  onGetSysSettings(callback: (result: LocalServerConfig) => void): void

  saveSysSettings(...args: any): void
}
