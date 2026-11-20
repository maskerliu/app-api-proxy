'use strict'

import chalk from 'chalk'
import minimist from 'minimist'
import Spinnies from 'spinnies'
import webpack from 'webpack'
import pkg from '../package.json' with { type: "json" }
import { purge } from './purge'
import { BaseConfig } from './webpack.base.config'
import mainConfig from './webpack.main.config'
import rendererConfig from './webpack.renderer.config'
import webConfig from './webpack.web.config'

const Run_Mode_PROD = 'production'

process.env.NODE_ENV = Run_Mode_PROD
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true'
process.env.DEBUG = 'electron-builder'

const spinner = { interval: 80, frames: ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷'] }
const spinnies = new Spinnies({ color: 'blue', succeedColor: 'green', spinner })

export function run() {
  let argv = minimist(process.argv.slice(2))
  if (argv['target'] == 'clean') clean()
  else if (argv['target'] == 'web') web()
  else build(argv['target'] == 'pkg')
}

function clean() {
  console.log('cleaning...')
  const residual = [
    ...purge([`build/${pkg.version}/*`]),
    ...purge(['dist/electron/*', 'dist/web/*', '!.gitkeep']),
  ]
  if (residual.length > 0) {
    console.error(`\n${chalk.bgRed.white(' FAIL ')} 仍有 ${residual.length} 项删不掉，请先退出占用进程\n`)
    process.exit(1)
  }
  console.log(`\n${chalk.bgGreen.white(' DONE ') + ' '}\n`)
  process.exit()
}

// packaging 为真时（yarn pkg）产物目录必须清空，否则 electron-builder 写 app.asar 时还会撞同一把锁
function build(packaging: boolean) {
  greeting()
  const stale = purge([`build/${pkg.version}/*`])
  // webpack 只写 dist/，dist 清不干净也照样往下跑
  purge(['dist/electron/*', 'dist/web/*', '!.gitkeep'])
  if (packaging && stale.length > 0) {
    console.error(`\n${chalk.bgRed.white(' FAIL ')} build/${pkg.version} 还占着，打包会在 electron-builder 阶段重蹈同一个 EBUSY。按上面的 HOLDER 退出占用进程后重试。\n`)
    process.exit(1)
  }

  addSpinnerTask(mainConfig)
  addSpinnerTask(webConfig)
  addSpinnerTask(rendererConfig)
}

function addSpinnerTask(config: BaseConfig) {
  spinnies.add(config.name as string, { text: `  build ${config.name}...` })
  pack(config)
}

function pack(config: BaseConfig) {
  const startTime = Date.now()
  config.init().mode = Run_Mode_PROD
  const compiler = webpack(config)
  compiler.run((err, stats) => {
    const cost = (Date.now() - startTime) / 1000
    if (err) {
      spinnies.fail(config.name as string, { text: `  ${err}` })
    } else if (stats?.hasErrors()) {
      stats.toString({ chunks: true, colors: true })
        .split(/\r?\n/)
        .forEach(line => console.error(`    ${line}`))
      spinnies.fail(config.name as string, { text: `  ${config.name} build fail, cost ${cost}s` })
    } else {
      spinnies.succeed(config.name as string, { text: `  ${config.name} build success, cost ${cost}s` })
    }
    compiler.close(() => { })
  })
}

function web() {
  purge(['dist/web/*', '!.gitkeep'])
  addSpinnerTask(webConfig)
}

function greeting() {
  console.log(chalk.bgGreen.white('    lets-build'.padEnd(process.stdout.columns, ' ')))
}

run()
