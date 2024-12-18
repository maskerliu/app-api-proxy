import path from "path"


console.log(process.env.ELECTRON_BUILDER_BINARIES_MIRROR)
console.log(process.release)

const args = process.argv.slice(2)

let parmas = new Map()

if (args.length != 0)
  args.forEach(arg => {
    let [key, val] = arg.split('=')
    if (!key.startsWith('--')) return
    parmas.set(key.substring(2), val)
  })

console.log(parmas)

console.log(process.resourcesPath)
console.log(path.dirname(path.dirname('D:/repo/app-api-proxy/build/1.0.0/win-unpacked/AppApiProxy.exe')))