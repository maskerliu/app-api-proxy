import clui from 'clui'
import minimist from 'minimist'
import path from "path"
import Spinnies from 'spinnies'

var Progress = clui.Progress

var countdown = new clui.Spinner('Exiting in 10 seconds...  ', ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷'])
countdown.start()

var number = 10
setInterval(function () {
  number--
  countdown.message('Exiting in ' + number + ' seconds...  ')
  if (number === 0) {
    process.stdout.write('\n')
    process.exit(0)
  }
}, 1000)

const spinner = { interval: 80, frames: ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷'] }
const spinnies = new Spinnies({ color: 'blue', succeedColor: 'green', spinner })
spinnies.add('spinner-1', { text: 'loading...' })
spinnies.add('spinner-2', { text: 'loading...' })
setTimeout(() => {
  spinnies.succeed('spinner-1', { text: 'Success!' })
  spinnies.fail('spinner-2', { text: 'Fail :(' })
}, 2000)

let argv = minimist(process.argv.slice(2))
console.log(argv)

var thisProgressBar = new Progress(20)
console.log(thisProgressBar.update(10, 30))

// or

var thisPercentBar = new Progress(20)
console.log(thisPercentBar.update(0.4))

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