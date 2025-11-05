import { contextBridge } from 'electron'
import mainApi from './MainApi'

contextBridge.exposeInMainWorld('electronAPI', mainApi)