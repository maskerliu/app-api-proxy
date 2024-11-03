import { IpcRenderer } from "electron"

export interface IElectronAPI {
  openFile: (...args: any) => Promise<void>
  openGame: (...args: any) => Promise<void>

  onOpenMockRuleMgr: (value: any) => void

  onOpenSettings: (value: any) => void
}


declare global {
  let __DEV__: boolean
  let __VUE_OPTIONS_API__: boolean

  interface Window {
    electronAPI: IElectronAPI
    ipcRenderer: IpcRenderer
  }

  let __IS_WEB__: boolean
  let PROTOCOL: string
  let SERVER_BASE_URL: string
}