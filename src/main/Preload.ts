import { contextBridge } from 'electron'
import mainApis from './MainApis'

contextBridge.exposeInMainWorld('electronAPI', mainApis)