import { Request } from "express"
import { File, Files } from "formidable"
import { readFileSync } from "fs"
import { Address6 } from 'ip-address'
import JSONBig from 'json-bigint'
import { NetworkInterfaceInfo, networkInterfaces } from 'os'
import { BizContext, LocalIP, UserDevice, UserNetwork } from '../../common/base.models'

const ipRegex = /(192|169)\.(172|168|254)\.(99|59|164)\.[1-9]\d{0,2}/

export namespace BizNetwork {
  export const Method_Get = 'get'
  export const Method_Post = 'post'
  export const BIZ_HEADER_TOKEN = 'x-token'
  export const BIZ_HEADER_UA = 'x-ua'
  export const BIZ_HEADER_DEVICE = 'x-did'
  export const BIZ_HEADER_AUTH = 'x-auth'
  export const BIZ_HEADER_NETWORK = 'x-network'
  export const BIZ_HEADER_MOCK_HOST = 'x-mock-host'
  export const BIZ_HEADER_MOCK_UID = 'x-mock-uid'

  export const MIME_EVENT_STREAM = 'text/event-stream'
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
/**
 * use webpack dev server implement
 * @param gatewayOrFamily 
 * @param isInternal 
 * @returns 
 */
export function findIp(gatewayOrFamily: string, isInternal?: boolean) {
  if (gatewayOrFamily === "v4" || gatewayOrFamily === "v6") {
    let host: string

    const networks = Object.values(networkInterfaces())
      .flatMap((networks) => networks ?? [])
      .filter((network) => {
        if (!network || !network.address) {
          return false
        }

        if (network.family !== `IP${gatewayOrFamily}`) {
          return false
        }

        if (
          typeof isInternal !== "undefined" &&
          network.internal !== isInternal
        ) {
          return false
        }

        if (gatewayOrFamily === "v6") {
          return Address6.isValid(network.address)
        }

        return network.address
      })

    for (const network of networks) {
      host = network.address

      if (host.includes(":")) {
        host = `[${host}]`
      }
    }

    return host
  }
}


export function parseContext(req: Request): BizContext {

  let network = req.headers[BizNetwork.BIZ_HEADER_NETWORK] as string
  network = network == null ? 'unknown' : network
  let netType = UserNetwork.UNKNOWN
  switch (network.toLowerCase()) {
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
    default:
      netType = UserNetwork.UNKNOWN
  }

  let ua = req.headers[BizNetwork.BIZ_HEADER_UA] as string
  let scheme: string, appId: string, appVersion: string, deviceInfo: UserDevice, channel: string
  if (ua == null) {
    ua = req.headers['user-agent'] as string
    let regArr = ua.match(/[\(]*[0-9A-Za-z;,_.\s\/]+[\)]*/g)
    scheme = regArr[0].trim()
    const os = regArr[1].trim().substring(1, regArr[1].length - 1).split(';')[0]
    const [brand, _] = regArr[4].trim().split(' ')
    deviceInfo = { os, version: '', brand, model: '' }
  } else {
    let regArr = ua.match(/[0-9A-Za-z\/\.\s:-]+/g)
    scheme = regArr[0]
    let [os, version] = regArr[1].split(' ')
    let [brand, model] = regArr[3].split(':')
    let [appId, appVersion] = regArr[2].split(' ')
    channel = regArr[4]
    deviceInfo = { os, version, brand, model }
  }
  let context: BizContext = {
    scheme,
    token: req.headers[BizNetwork.BIZ_HEADER_TOKEN] as string,
    did: req.headers[BizNetwork.BIZ_HEADER_DEVICE] as string,
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

export async function parseMultipartForm(files: Files<string>, req: Request) {

  let formData = new FormData()
  try {
    for (const key in files) {
      let file = files[key][0]
      let data: any
      switch (file.mimetype) {
        case BizNetwork.MIME_JSON:
          data = readFileSync(file.filepath, 'utf-8')
          let blob = new Blob([data], { type: file.mimetype })
          formData.set(key, data)
          break
        case BizNetwork.MIME_TEXT:
          data = readFileSync(file.filepath, 'utf-8')
          formData.set(key, data)
          break
        case BizNetwork.MIME_IMAGE:
          data = readFileSync(file.filepath, 'utf-8')
          formData.set(key, data)
          break
      }
    }
    return formData
  } catch (error) {
    console.log('parse multpart form data fail', error)
    return null
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