'use strict'

import chalk from 'chalk'
import { deleteSync } from 'del'
import minimist from 'minimist'
import Spinnies from 'spinnies'
import webpack from 'webpack'
import pkg from '../package.json' assert { type: "json" }
import { BaseConfig } from './webpack.base.config'
import mainConfig from './webpack.main.config'
import rendererConfig from './webpack.renderer.config'
import webConfig from './webpack.web.config'

const Run_Mode_PROD = 'production'

process.env.NODE_ENV = Run_Mode_PROD
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true'
process.env.DEBUG = 'electron-builder'

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

async function build() {
  greeting()
  deleteSync([`build/${pkg.version}/*`])
  deleteSync(['dist/electron/*', 'dist/web/*', '!.gitkeep'])

  let spinner = { interval: 80, frames: ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷'] }
  let spinnies = new Spinnies({ color: 'blue', succeedColor: 'green', spinner })
  addSpinnerTask(spinnies, mainConfig)
  addSpinnerTask(spinnies, webConfig)
  addSpinnerTask(spinnies, rendererConfig)
}

async function addSpinnerTask(spinnies: Spinnies, config: BaseConfig) {
  spinnies.add(config.name, { text: `  build ${config.name}...` })
  try {
    let result = await pack(config)
    spinnies.succeed(config.name, { text: `  ${result}` })
  } catch (err) {
    spinnies.fail(config.name, { text: `  ${err}` })
  }
}

function pack(config: BaseConfig): Promise<string> {
  return new Promise((resolve, reject) => {
    config.init().mode = Run_Mode_PROD
    webpack(config, (err, stats) => {
      if (err) {
        reject(err.stack || err)
      } else if (stats.hasErrors()) {
        let err = ''
        stats.toString({ chunks: true, colors: true })
          .split(/\r?\n/)
          .forEach(line => { err += `    ${line}\n` })
        reject(err)
      } else {
        resolve(`${config.name} build success`)
        // resolve(stats.toString({ chunks: false, colors: true}))
      }
    })
  })
}

function renderer() {
  deleteSync(['dist/electron/*', '!.gitkeep'])
  rendererConfig.init().mode = Run_Mode_PROD
  pack(rendererConfig)
}

function web() {
  deleteSync(['dist/web/*', '!.gitkeep'])
  webConfig.init().mode = Run_Mode_PROD
  pack(webConfig)
}

function greeting() {
  console.log(chalk.bgGreen.white('    lets-build'.padEnd(process.stdout.columns, ' ')))
}

run()