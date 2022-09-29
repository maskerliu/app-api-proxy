'use strict'



import chalk from 'chalk'
import { ChildProcess, exec, spawn } from 'child_process'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import webpack from 'webpack'
import WebpackDevServer from 'webpack-dev-server'
import WebpackHotMiddleware from 'webpack-hot-middleware'

import mainConfig from './webpack.main.config.js'
import rendererConfig from './webpack.renderer.config.js'
import webConfig from './webpack.web.config.js'

import HtmlWebpackPlugin from 'html-webpack-plugin'

import { BaseConfig } from './webpack.base.config.js'


const Run_Mode_DEV = 'development'
const Run_Mode_PROD = 'production'

const dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.NODE_ENV = 'development'
const __DEV__ = true
const __LOCAL_SERVER__ = await WebpackDevServer.internalIP('v4')

let electronProcess: ChildProcess | null = null
let manualRestart = false
let hotMiddleware: any

function logStats(proc: String, data: any) {
  let log = ''

  log += chalk.yellow(`┏ ${proc} Process ${new Array((19 - proc.length) + 1).join('-')}`)
  log += '\n\n'

  if (typeof data === 'object') {
    data.toString({ colors: true, chunks: false }).split(/\r?\n/)
      .forEach((line: String) => { log += '  ' + line + '\n' })
  } else {
    log += `  ${data}\n`
  }

  log += '\n' + chalk.yellow(`┗ ${new Array(28 + 1).join('-')}`) + '\n'
  console.log(log)
}

async function startDevServer(config: BaseConfig, port: number) {
  return new Promise<void>((resolve, reject) => {
    config.mode = Run_Mode_DEV
    const compiler = webpack(config)

    let hotMiddleware = WebpackHotMiddleware(compiler, { log: false, heartbeat: 2500 });

    compiler.hooks.compilation.tap("compilation", compilation => {
      HtmlWebpackPlugin.getHooks(compilation).afterEmit.tapAsync("html-webpack-plugin-after-emit", (data: any, cb: Function) => {
        hotMiddleware.publish({ action: "reload" });
        cb()
      })
    })

    compiler.hooks.done.tap("done", stats => { logStats(`${config.target}`, stats) })

    const server = new WebpackDevServer(
      {
        port: port,
        hot: true,
        liveReload: true,
        allowedHosts: "all",
        static: { directory: path.join(dirname, "../"), },
        setupMiddlewares(middlewares, devServer) {
          devServer.app.use(hotMiddleware)
          devServer.middleware.waitUntilValid(() => { resolve() })
          return middlewares
        }
      }, compiler)

    server.start().then(() => resolve())
      .catch(err => {
        console.log(`fail to start ${config.target} server`, err)
        reject()
      })
  })
}

async function startMain() {
  return new Promise<void>((resolve, reject) => {
    mainConfig.mode = Run_Mode_DEV
    const compiler = webpack(mainConfig)
    hotMiddleware = WebpackHotMiddleware(compiler, { log: false, heartbeat: 2500 })
    compiler.hooks.watchRun.tapAsync("watch-run", (compilation, done) => {
      logStats("Main", chalk.white("compiling..."))
      hotMiddleware.publish({ action: "compiling" })
      done()
    })

    compiler.watch({}, (err, stats) => {
      if (err) {
        console.log(err)
        reject()
        return
      }

      logStats("Main", stats)

      if (electronProcess && electronProcess.kill()) {
        manualRestart = true

        if (os.platform() === "darwin") {
          process.kill(electronProcess.pid!)
          electronProcess = null;
          startElectron()
          setTimeout(() => { manualRestart = false }, 5000)
        } else {
          const pid = electronProcess.pid
          exec(`TASKKILL /F /IM electron.exe`, (err, data) => {
            if (err) console.log(err)
            else console.log("kill pid: " + pid + " success!")
            electronProcess = null
            startElectron()
            manualRestart = false
          })
        }
      }
      resolve()
    })
  })
}

function startElectron() {
  let args = [
    '--inspect=5858',
    '--remote-debugging-port=9223', // add this line
    path.join(dirname, '../dist/electron/main.js')
  ]

  // detect yarn or npm and process commandline args accordingly
  if (process.env.npm_execpath?.endsWith('yarn.js')) {
    args = args.concat(process.argv.slice(3))
  } else if (process.env.npm_execpath?.endsWith('npm-cli.js')) {
    args = args.concat(process.argv.slice(2))
  }

  electronProcess = spawn('electron', args)

  electronProcess?.stdout?.on('data', data => {
    electronLog(data, 'blue')
  })
  electronProcess?.stderr?.on('data', data => {
    electronLog(data, 'red')
  })

  electronProcess?.on('close', () => {
    if (!manualRestart) process.exit()
  })
}

function electronLog(data: any, color: any) {
  let log = ''
  data = data.toString().split(/\r?\n/)
  data.forEach((line: String) => { log += `  ${line}\n` })
  if (/[0-9A-z]+/.test(log)) {
    console.log(
      chalk[color]('┏ Electron -------------------') +
      '\n\n' +
      chalk[color](log) +
      chalk[color]('┗ ----------------------------') +
      '\n'
    )
  }
}

function greeting() {
  const cols = process.stdout.columns
  let text: String | boolean = ''

  if (cols > 104) text = 'electron-vue'
  else if (cols > 76) text = 'electron-|vue'
  else text = false

  console.log(chalk.green('\n  electron-vue'))
  console.log(chalk.blue('  getting ready...') + '\n')
}

async function start() {
  greeting()

  const localIPv4 = await WebpackDevServer.internalIP('v4')

  Promise.all([
    startDevServer(webConfig.init(localIPv4), 9081),
    startDevServer(rendererConfig.init(localIPv4), 9080),
    startMain()])
    .then(() => { startElectron() })
    .catch(err => {
      console.error(err)
    })
}

start()