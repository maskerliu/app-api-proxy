import cv, { Mat } from '@u4/opencv4nodejs'
import { contextBridge, ipcRenderer } from 'electron'
import path from 'path'
import { LocalServerConfig } from '../common/base.models'
import { ElectronAPICMD, IElectronAPI } from '../common/ipc.api'


let apis: IElectronAPI = {
  relaunch() {
    ipcRenderer.invoke(ElectronAPICMD.Relaunch)
  },
  openFile: function (...args: any): Promise<void> {
    ipcRenderer.invoke('dialog:openFile')
    return null
  },
  openDevTools(...args: any) {
    ipcRenderer.invoke(ElectronAPICMD.OpenDevTools, args)
  },
  saveSysSettings(...args: any) {
    ipcRenderer.invoke(ElectronAPICMD.SaveSysSettings, args)
  },
  downloadUpdate(newVersion: any) {
    ipcRenderer.invoke(ElectronAPICMD.DownloadUpdate, newVersion)
  },

  sendServerEvent: function (): void {
    ipcRenderer.invoke(ElectronAPICMD.SendServerEvent)
  },

  getSysSettings(callback: (result: LocalServerConfig) => void) {
    ipcRenderer.on(ElectronAPICMD.GetSysSettings, (_event, result: LocalServerConfig) => callback(result))
  },

  setAppTheme(theme: ('system' | 'light' | 'dark')) {
    ipcRenderer.invoke(ElectronAPICMD.SetAppTheme, theme)
  },

  getSysTheme(callback: any) {
    ipcRenderer.on(ElectronAPICMD.GetSysTheme, (theme) => callback(theme))
  },

  onOpenMockRuleMgr(callback: any) {
    ipcRenderer.on(ElectronAPICMD.OpenMockRuleMgr, (_event) => callback())
  },

  onOpenSettings(callback: any) {
    ipcRenderer.on(ElectronAPICMD.OpenSettings, (_event) => callback())
  },

  onSysThemeChanged(callback: (theme: string) => void) {
    ipcRenderer.on(ElectronAPICMD.SysThemeChanged, (_, theme: string) => callback(theme))
  },

  onDownloadUpdate(callback: (...args: any) => void) {
    ipcRenderer.on(ElectronAPICMD.DownloadUpdate, (_, ...args: any) => callback(...args))
  },
}

let originFrame: Mat
let sharedData: Uint8ClampedArray
let bgrFrame: Mat
const faceClassifier = new cv.CascadeClassifier(cv.HAAR_FRONTALFACE_DEFAULT)

contextBridge.exposeInMainWorld('electronAPI', apis)
contextBridge.exposeInMainWorld('cv', {
  imread: (file: string) => {
    try {
      let image = cv.imread(path.join(__dirname, '../../images/opencv-logo.png'))
      let grayImage = image.cvtColor(cv.COLOR_BGR2GRAY)
      grayImage = grayImage.cvtColor(cv.COLOR_GRAY2RGBA)
      const data = new Uint8ClampedArray(grayImage.getData())
      let cols = grayImage.cols, rows = grayImage.rows
      grayImage.release()
      image.release()
      return { data, cols, rows }
    } catch (e) {
      console.log(e)
    }
  },
  faceRecognize: (frame: ImageData, width: number, height: number) => {
    if (originFrame == null) {
      originFrame = new cv.Mat(height, width, cv.CV_8UC4)
    }
    if (sharedData == null) {
      sharedData = new Uint8ClampedArray(height * width * cv.CV_8UC4)
    }

    originFrame.setData(Buffer.from(frame.data.buffer))
    const bgrFrame = originFrame.cvtColor(cv.COLOR_RGBA2BGR)
    let grayImage = bgrFrame.cvtColor(cv.COLOR_BGR2GRAY)
    const faces = faceClassifier.detectMultiScale(grayImage).objects

    // TODO do face landmarks
    // const modelFile = getCachedFile(getResourcePath('face/lbfmodel.yaml'), 'https://raw.githubusercontent.com/kurnianggoro/GSOC2017/master/data/lbfmodel.yaml', { notice: 'could not find landmarks model' })
    const classifier = new cv.CascadeClassifier(cv.HAAR_FRONTALFACE_ALT2)
    // create the facemark object with the landmarks model
    const facemark = new cv.FacemarkLBF()
    // facemark.loadModel(modelFile)

    grayImage = grayImage.cvtColor(cv.COLOR_GRAY2RGBA)
    const data = Uint8ClampedArray.from(grayImage.getData())
    let cols = grayImage.cols, rows = grayImage.rows
    grayImage.release()
    bgrFrame.release()
    return { faces }
  }
})