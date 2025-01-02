import { NetworkInterfaceInfo, networkInterfaces } from 'os'

const ipRegex = /(192|169)\.(172|168|254)\.(99|59|164)\.[1-9]\d{0,2}/

export function getLocalIPs(): Array<any> {
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