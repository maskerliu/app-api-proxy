import { get, post } from './base.api'
import { IOT } from './iot.models'


export function searchDevices(keyword: string) {
  return get<Array<IOT.IOTDevice>>('/iot/search', null, { keyword })
}

export function deviceInfo(deviceId: string) {
  return get<IOT.IOTDevice>('/iot/deviceInfo', null, { deviceId })
}

export function updateDevice(device: IOT.IOTDevice) {
  return post<string>('/iot/updateInfo', null, null, device)
}

export function removeDevice(deviceId: string) {
  return post<string>('/iot/removeDevice', null, { deviceId })
}