import {Address6} from 'ip-address'
import { NetworkInterfaceInfo, networkInterfaces } from 'os'

export function getLocalIPs() {
  let ips = []
  for (let devName in networkInterfaces()) {
    let iface: NetworkInterfaceInfo[] = networkInterfaces()[devName]
    for (let i = 0; i < iface.length; i++) {
      let alias: NetworkInterfaceInfo = iface[i]
      if (alias.family === "IPv4" && alias.address !== "127.0.0.1" && (devName === 'WLAN' || devName === 'eth0')) {
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
      host = network.address;

      if (host.includes(":")) {
        host = `[${host}]`
      }
    }

    return host
  }
}