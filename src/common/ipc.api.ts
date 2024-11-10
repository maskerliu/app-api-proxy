

export const ElectronAPICMD = {
  openFile: 'openFile',
  openMockRuleMgr: 'openMockRuleMgr',
  openSettings: 'openSettings'
}

export interface IElectronAPI {

  openFile(...args: any): Promise<void>

  onOpenMockRuleMgr(callback: any): void

  onOpenSettings(callback: any): void
}
