import { BrowserWindow } from "electron"
import { Request } from "express"
import { File } from "formidable"
import { readFileSync } from "fs"
import JSONBig from 'json-bigint'
import { NetworkInterfaceInfo, networkInterfaces } from 'os'
import { BizContext, LocalIP, UserDevice, UserNetwork } from '@shared/base.models'
import { pickHeader } from '@shared/http-header'
import { APP_NAME } from "../constants"

const ipRegex = /(192|169)\.(172|168|254)\.(99|59|164)\.[1-9]\d{0,2}/

export namespace BizNetwork {
  export const Method_Get = 'get'
  export const Method_Post = 'post'
  export const BIZ_HEADER_TOKEN = 'x-token'
  export const BIZ_HEADER_UA = 'x-ua'
  export const BIZ_HEADER_DEVICE = 'x-did'
  export const BIZ_HEADER_NETWORK = 'x-network'

  export const MIME_MULTIPART = 'multipart/form-data'
  export const MIME_JSON = 'application/json'
  export const MIME_TEXT = 'text/plain'
  export const MIME_IMAGE = 'image/jpeg'
  export const MIME_FORM = 'application/x-www-form-urlencoded'
}

export function getLocalIPs(): LocalIP[] {
  let ips = []
  for (let devName in networkInterfaces()) {
    let iface: NetworkInterfaceInfo[] = networkInterfaces()[devName]
    for (let i = 0; i < iface.length; i++) {
      let alias: NetworkInterfaceInfo = iface[i]
      if (alias.family === "IPv4" && alias.address !== "127.0.0.1" &&
        !ipRegex.test(alias.address) &&
        (devName.toLowerCase().indexOf('wlan') !== -1 ||
          devName.toLowerCase().indexOf('eth') !== -1 ||
          devName.toLowerCase().indexOf('en') !== -1 ||
          devName.indexOf('以太网') !== -1)) {
        ips.push({
          name: devName,
          netmask: alias.netmask,
          family: alias.family,
          mac: alias.mac,
          internal: alias.internal,
          cidr: alias.cidr,
          address: alias.address,
        })
      }
    }
  }
  return ips
}
export function parseContext(req: Request): BizContext {

  const network = pickHeader(req.headers, BizNetwork.BIZ_HEADER_NETWORK)
  let netType = UserNetwork.UNKNOWN
  switch (network?.toLowerCase()) {
    case '2g':
      netType = UserNetwork.G2
      break
    case '3g':
      netType = UserNetwork.G3
      break
    case '4g':
      netType = UserNetwork.G4
      break
    case '5g':
      netType = UserNetwork.G5
      break
    case 'wifi':
      netType = UserNetwork.WIFI
      break
    case 'ethernet':
      netType = UserNetwork.Ethernet
      break
    default:
      netType = UserNetwork.UNKNOWN
  }

  let scheme = '', appId = '', appVersion = '', channel = ''
  let deviceInfo: UserDevice = { os: '', version: '', brand: '', model: '' }
  const ua = pickHeader(req.headers, BizNetwork.BIZ_HEADER_UA)
  if (ua != null) {
    const regArr = ua.match(/[0-9A-Za-z\/\.\s:-]+/g) ?? []
    scheme = regArr[0] ?? ''
    const [os = '', version = ''] = (regArr[1] ?? '').trim().split(' ')
    const [brand = '', model = ''] = (regArr[3] ?? '').trim().split(':')
    const [parsedAppId = '', parsedAppVersion = ''] = (regArr[2] ?? '').trim().split(' ')
    appId = parsedAppId
    appVersion = parsedAppVersion
    channel = regArr[4] ?? ''
    deviceInfo = { os, version, brand, model }
  } else {
    const regArr = pickHeader(req.headers, 'user-agent')?.match(/[\(]*[0-9A-Za-z;,_.\s\/]+[\)]*/g) ?? []
    scheme = regArr[0]?.trim() ?? ''
    const os = (regArr[1] ?? '').trim().replace(/^\(|\)$/g, '').split(';')[0].trim()
    const [brand = ''] = (regArr[4] ?? '').trim().split(' ')
    deviceInfo = { os, version: '', brand, model: '' }
  }

  let context: BizContext = {
    scheme,
    token: pickHeader(req.headers, BizNetwork.BIZ_HEADER_TOKEN),
    did: pickHeader(req.headers, BizNetwork.BIZ_HEADER_DEVICE),
    network: netType,
    deviceInfo,
    appId,
    version: appVersion,
    channel
  }
  return context
}

export function parseJsonBody(req: Request) {
  try {
    return JSONBig.parse(req.body)
  } catch (error) {
    console.log('parse json body error', error)
  }
}

export function fetchFormFile(file: File) {
  let data = readFileSync(file.filepath, 'utf-8')
  switch (file.mimetype) {
    case BizNetwork.MIME_JSON:
      data = readFileSync(file.filepath, 'utf-8')
      return JSON.parse(data)
    case BizNetwork.MIME_TEXT:
      return readFileSync(file.filepath, 'utf-8')
      break
    case BizNetwork.MIME_IMAGE:
      return readFileSync(file.filepath, 'utf-8')
  }
}

export function getAppWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows()
    .find((it, idx, _) => { return it.title == APP_NAME })
}