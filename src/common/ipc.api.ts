

export const ElectronAPICMD = {
  openFile: 'openFile',
  openDevTools: 'openDevTools',
  openMockRuleMgr: 'openMockRuleMgr',
  openSettings: 'openSettings'
}

export interface IElectronAPI {

  openFile(...args: any): Promise<void>

  openDevTools(...args: any): void

  onOpenMockRuleMgr(callback: any): void

  onOpenSettings(callback: any): void
}
