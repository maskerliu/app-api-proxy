
import chalk from 'chalk'
import { ChildProcess, exec, spawn } from 'child_process'
import express from 'express'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import webpack from 'webpack'
import WebpackDevServer from 'webpack-dev-server'
import WebpackHotMiddleware from 'webpack-hot-middleware'
import buildConfig from '../build.config.json' assert { type: 'json' }
import { BaseConfig } from './webpack.base.config.js'
import mainConfig from './webpack.main.config'
import rendererConfig from './webpack.renderer.config'
import webConfig from './webpack.web.config'

const Run_Mode_DEV = 'development'
const dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.NODE_ENV = Run_Mode_DEV

process.env.BUILD_CONFIG = JSON.stringify(buildConfig)

let electronProc: ChildProcess | null = null
let manualRestart = false
let hotMiddleware: any

function startDevServer(config: BaseConfig, port: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    config.mode = Run_Mode_DEV
    const compiler = webpack(config)

    let serverConfig: WebpackDevServer.Configuration = {
      port: port,
      hot: true,
      liveReload: true,
      allowedHosts: "all",
      client: { logging: 'none' },
      static: { directory: path.join(dirname, '../src/'), },
      setupMiddlewares(middlewares, devServer) {
        devServer.app?.use('/node_modules/', express.static(path.resolve(dirname, '../node_modules')))
        devServer.app?.use((_, res, next) => {
          res.setHeader('Access-Control-Allow-Origin', '*')
          res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
          res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
          next()
        })
        devServer.middleware?.waitUntilValid(() => { resolve() })
        return middlewares
      }
    }

    // if (buildConfig.protocol == 'https') {
    //   serverConfig.https = {
    //     key: fs.readFileSync('cert/private.key'),
    //     cert: fs.readFileSync('cert/mydomain.crt')
    //   }
    // }

    compiler.watch({}, (err, stats) => {
      if (err) {
        console.log(config.name, err, 'red')
        reject()
        return
      }

      // console.log(config.name, stats)
    })

    const server = new WebpackDevServer(serverConfig, compiler)

    server.start()
      .then(() => resolve())
      .catch(err => {
        console.log(config.name, chalk.redBright(`fail to start ${config.target} server`, err))
        reject()
      })
  })
}

function startMain(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    mainConfig.mode = Run_Mode_DEV
    const compiler = webpack(mainConfig)
    hotMiddleware = WebpackHotMiddleware(compiler, { log: false, heartbeat: 2500 })
    compiler.hooks.watchRun.tapAsync("watch-run", (_, done) => {
      hotMiddleware.publish({ action: "compiling" })
      done()
    })

    compiler.watch({}, (err, stats) => {
      if (err) {
        console.log("Main", err, 'red')
        reject()
        return
      }

      // console.log("Main", stats)

      if (electronProc && electronProc.kill()) {
        manualRestart = true

        if (os.platform() === "darwin") {
          process.kill(electronProc.pid!)
          electronProc = null
          startElectron()
          setTimeout(() => { manualRestart = false }, 5000)
        } else {
          const pid = electronProc.pid
          exec(`TASKKILL /F /IM electron.exe`, (err, data) => {
            if (err) console.log(err)
            else console.log(chalk['green']("kill pid: " + pid + " success!"))
            electronProc = null
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
    '--trace-warnings',
    '--inspect=5858',
    '--experimental-worker',
    '--experimental-wasm-threads',
    '--unhandled-rejections=strict',
    path.join(dirname, '../dist/electron/main.cjs')
  ]

  if (process.platform !== 'linux') {
    args.push('--remote-debugging-port=9223', '--experimental-wasm-bulk-memory')
  }

  // detect yarn or npm and process commandline args accordingly
  if (process.env.npm_execpath?.endsWith('yarn.js')) {
    args = args.concat(process.argv.slice(3))
  } else if (process.env.npm_execpath?.endsWith('npm-cli.js')) {
    args = args.concat(process.argv.slice(2))
  }

  electronProc = spawn('electron', args, {
    stdio:  ['inherit', 'inherit', 'inherit'],
    shell: process.platform === 'win32'
  })
  electronProc.stdout?.on('data', data => { consoleLog('Electron', data, 'blue') })
  electronProc.stderr?.on('data', data => { consoleLog('Electron', data, 'red') })
  electronProc.on('close', () => { if (!manualRestart) process.exit() })
}

function consoleLog(proc: string, data: any, color?: string) {
  let log = ''
  log += chalk[color ? color : 'yellow'](`┏ ${proc} Process ${new Array(process.stdout.columns - 12 - proc.length).join('-')} ┓\n\n`)
  if (typeof data === 'object') {
    (proc == 'Electron' ? data.toString() : data.toString({ colors: true, chunks: false }))
      .split(/\r?\n/).forEach((line: string) => {
        // line = line.replace(/(.{})/g, '$1\n')
        log += `| ${line}\n`
      })
  } else {
    log += `${data}\n`
  }

  if (color) {
    log = chalk[color](log)
  }

  log += chalk[color ? color : 'yellow'](`┗ ${new Array(process.stdout.columns - 3).join('-')} ┛`) + '\n'
  console.log(log)
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

  try {
    let localIPv4 = WebpackDevServer.internalIPSync('v4')
    console.log("test", localIPv4)
    await Promise.all([
      startDevServer(webConfig.init(localIPv4), 9081),
      startDevServer(rendererConfig.init(localIPv4), 9080),
      startMain()
    ])

    startElectron()
  } catch (err) {
    console.error(err)
  }
}

start()