'use strict'

import { BaseConfig } from './webpack.base.config'



import chalk from 'chalk'
import { deleteSync } from 'del'
import Multispinner from 'multispinner'
import webpack from 'webpack'
import mainConfig from './webpack.main.config.js'
import rendererConfig from './webpack.renderer.config.js'
import webConfig from './webpack.web.config.js'

const Run_Mode_PROD = 'production'
const doneLog = chalk.bgGreen.white(' DONE ') + ' '
const errorLog = chalk.bgRed.white(' ERROR ') + ' '
const okayLog = chalk.bgBlue.white(' OKAY ') + ' '

process.env.NODE_ENV = Run_Mode_PROD
function run() {
  if (process.env.BUILD_TARGET === 'clean') clean()
  else build()
}

function clean() {
  deleteSync(['build/*', '!build/icons', '!build/icons/icon.*'])
  console.log(`\n${doneLog}\n`)
  process.exit()
}

async function build() {
  greeting()

  deleteSync(['dist/electron/*', '!.gitkeep'])
  deleteSync(['dist/web/*', '!.gitkeep'])

  const tasks = [mainConfig.target, rendererConfig.target, webConfig.target]
  const spinner = new Multispinner(tasks, { preText: 'building', postText: 'process' })

  let results = ''
  spinner.on('success', () => {
    process.stdout.write('\x1B[2J\x1B[0f')
    console.log(`\n\n${results}`)
    console.log(`${okayLog}take it away ${chalk.yellow('`electron-builder`')}\n`)
    process.exit()
  })

  let task = [mainConfig, rendererConfig, webConfig]

  task.forEach(async (config) => {
    try {
      let result = await pack(config)
      results += result + '\n\n'
      spinner.success(config.target)
    } catch (err) {
      spinner.error(config.target)
      console.log(`\n  ${errorLog} failed to build ${config.target} process`)
      console.error(`\n${err}\n`)
      process.exit(1)
    }
  })
}

function pack(config: BaseConfig): Promise<string> {
  return new Promise((resolve, reject) => {
    config.init().mode = Run_Mode_PROD
    webpack(config, (err, stats) => {
      if (err) {
        reject(err.stack || err)
      } else if (stats.hasErrors()) {
        let err = ''
        // stats.toString({ chunks: false, colors: true })
        //   .split(/\r?\n/)
        //   .forEach(line => { err += `    ${line}\n` })
        reject(err)
      } else {
        resolve(stats.toString({ chunks: false, colors: true }))
      }
    })
  })
}

function greeting() {
  const cols = process.stdout.columns
  let text: String | boolean = ''

  if (cols > 85) text = 'lets-build'
  else if (cols > 60) text = 'lets-|build'
  else text = false

  console.log(chalk.green('\n  lets-build'))
  console.log()
}

run()