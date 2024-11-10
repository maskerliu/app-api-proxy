import { IpcRenderer } from "electron"
import { IElectronAPI } from "./common/ipc.api"

declare global {
  let __DEV__: boolean
  let __VUE_OPTIONS_API__: boolean

  interface Window {
    electronAPI: IElectronAPI
    ipcRenderer: IpcRenderer
  }

  let __IS_WEB__: boolean
  let SERVER_BASE_URL: string
}