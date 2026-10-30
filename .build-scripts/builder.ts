'use strict'

import chalk from 'chalk'
import { deleteSync } from 'del'
import minimist from 'minimist'
import Spinnies from 'spinnies'
import webpack from 'webpack'
import pkg from '../package.json' with { type: "json" }
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
  if (argv['target'] == 'web') web()
  else build()
}

function clean() {
  console.log('cleaning...')
  deleteSync([`build/${pkg.version}/*`])
  deleteSync(['dist/electron/*', 'dist/web/*', '!.gitkeep'])
  console.log(`\n${chalk.bgGreen.white(' DONE ') + ' '}\n`)
  process.exit()
}

function build() {
  greeting()
  deleteSync([`build/${pkg.version}/*`])
  deleteSync(['dist/electron/*', 'dist/web/*', '!.gitkeep'])

  addSpinnerTask(mainConfig)
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
  deleteSync(['dist/web/*', '!.gitkeep'])
  addSpinnerTask(webConfig)
}

function greeting() {
  console.log(chalk.bgGreen.white('    lets-build'.padEnd(process.stdout.columns, ' ')))
}

run()
