
import chalk from 'chalk'
import { ChildProcess, exec, spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import webpack from 'webpack'
import WebpackDevServer from 'webpack-dev-server'
import pkg from '../package.json' with { type: "json" }
import { getLocalIPs } from './misc'
import { BaseConfig } from './webpack.base.config.js'
import mainConfig from './webpack.main.config'
import rendererConfig from './webpack.renderer.config'

const Run_Mode_DEV = 'development'
const dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.NODE_ENV = Run_Mode_DEV
process.env.BUILD_CONFIG = JSON.stringify(pkg.config)

let electronProc: ChildProcess | null = null
let manualRestart = false
let rendererDevServer: WebpackDevServer | null = null

function enableDevCache(config: BaseConfig) {
  config.cache = {
    type: 'filesystem',
    name: `${config.name}-dev`,
    cacheDirectory: path.join(dirname, '../node_modules/.cache/webpack'),
    buildDependencies: { config: [fileURLToPath(import.meta.url)] },
  }
}

function startDevServer(config: BaseConfig, host: string, port: number): Promise<void> {
  return new Promise<void>(async (resolve, reject) => {
    config.mode = Run_Mode_DEV
    enableDevCache(config)
    const compiler = webpack(config) as webpack.Compiler

    compiler.hooks.done.tap(config.name as string, (stats) => {
      if (stats?.hasErrors()) {
        console.error(config.name, stats.toString({ colors: true, errors: true }))
      }
    })

    let serverConfig: WebpackDevServer.Configuration = {
      host, port, hot: true,
      liveReload: true,
      allowedHosts: 'all',
      compress: true,
      client: { logging: 'none', overlay: false, progress: true },
      static: [{ directory: path.join(dirname, '../src/'), publicPath: '/' }],
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'unsafe-none',
      },
      setupMiddlewares(middlewares, devServer) {
        devServer.middleware?.waitUntilValid(() => { resolve() })
        return middlewares
      },
    }

    if (pkg.config.protocol == 'https') {
      serverConfig.server = {
        type: 'https',
        options: {
          key: fs.readFileSync(path.join(dirname, '../cert/server.key')),
          cert: fs.readFileSync(path.join(dirname, '../cert/server.crt')),
          requestCert: true,
          rejectUnauthorized: false
        }
      }
    }

    const server = new WebpackDevServer(serverConfig, compiler)
    if (config.name == 'renderer') rendererDevServer = server

    try {
      await server.start()
      resolve()
    } catch (err) {
      console.error(config.name, chalk.redBright(`fail to start ${config.target} server`, err))
      reject(err)
    }
  })
}

function startMain(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    mainConfig.mode = Run_Mode_DEV
    enableDevCache(mainConfig)
    const compiler = webpack(mainConfig) as webpack.Compiler

    compiler.hooks.watchRun.tapAsync('watch-run', (_, done) => done())

    compiler.watch({}, (err, stats) => {
      if (err) {
        console.error('main', err)
        reject(err)
        return
      }

      if (stats?.hasErrors()) {
        console.error('main', stats.toString({ colors: true, errors: true }))
        return
      }

      if (electronProc && electronProc.kill()) {
        manualRestart = true

        if (process.platform === 'win32') {
          const pid = electronProc.pid
          exec('TASKKILL /F /IM electron.exe', (err) => {
            if (err) console.error(chalk.bgRed.white(err))
            else console.log(chalk.bgRedBright.whiteBright(`    kill pid: ${pid} success!`.padEnd(process.stdout.columns - 20, ' ')))
            electronProc = null
            startElectron()
            manualRestart = false
          })
        } else {
          process.kill(electronProc.pid!)
          electronProc = null
          startElectron()
          setTimeout(() => {
            manualRestart = false
            rendererDevServer?.sockets?.forEach(socket => socket?.emit('reload'))
          }, 5000)
        }
      }
      resolve()
    })
  })
}

function startElectron() {
  let args = [
    path.join(dirname, '../dist/electron/main.cjs')
  ]

  if (process.platform !== 'linux') {
    // args.push('--remote-debugging-port=9223', '--experimental-wasm-bulk-memory')
  } else {
    args.push('--no-sandbox')
  }

  args.push('--unhandled-rejections=strict')

  // detect yarn or npm and process commandline args accordingly
  if (process.env.npm_execpath?.endsWith('yarn.js')) {
    args = args.concat(process.argv.slice(3))
  } else if (process.env.npm_execpath?.endsWith('npm-cli.js')) {
    args = args.concat(process.argv.slice(2))
  }

  electronProc = spawn('electron', args, {
    detached: false,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  })

  electronProc.on('close', (code, signal) => {
    console.log(chalk.bgYellow.blue(`    Electron Process Closed[${signal}]`.padEnd(process.stdout.columns - 20, ' ')))
    if (!manualRestart) process.exit()
  })
}

async function start() {
  console.log(chalk.bgGreen.yellowBright('    getting ready...'.padEnd(process.stdout.columns - 20, ' ')))

  let ips = getLocalIPs()
  let localIPv4 = ips[0]?.address ?? '127.0.0.1'

  await Promise.all([
    startDevServer(rendererConfig.init(localIPv4), 'localhost', 9080),
    startMain()
  ])

  startElectron()
}

try {
  await start()
} catch (err) {
  console.log(err)
}
