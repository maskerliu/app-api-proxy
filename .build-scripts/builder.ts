'use strict'

import { BaseConfig } from './webpack.base.config'

process.env.NODE_ENV = 'production'

import chalk from 'chalk'
import { deleteSync } from 'del'
import Multispinner from 'multispinner'
import webpack from 'webpack'
import mainConfig from './webpack.main.config.bck.js'
import rendererConfig from './webpack.renderer.config.js'
import webConfig from './webpack.web.config.js'

const doneLog = chalk.bgGreen.white(' DONE ') + ' '
const errorLog = chalk.bgRed.white(' ERROR ') + ' '
const okayLog = chalk.bgBlue.white(' OKAY ') + ' '


const __DEV__ = false

function run() {
  if (process.env.BUILD_TARGET === 'clean') clean()
  else if (process.env.BUILD_TARGET === 'web') web()
  else build()
}

function clean() {
  deleteSync(['build/*', '!build/icons', '!build/icons/icon.*'])
  console.log(`\n${doneLog}\n`)
  process.exit()
}

function build() {
  greeting()

  deleteSync(['dist/electron/*', '!.gitkeep'])
  deleteSync(['dist/web/*', '!.gitkeep'])

  const tasks = ['main', 'renderer', 'web']
  const spinner = new Multispinner(tasks, {
    preText: 'building',
    postText: 'process'
  })

  let results = ''
  spinner.on('success', () => {
    process.stdout.write('\x1B[2J\x1B[0f')
    console.log(`\n\n${results}`)
    console.log(`${okayLog}take it away ${chalk.yellow('`electron-builder`')}\n`)
    process.exit()
  })

  pack(mainConfig).then(result => {
    results += result + '\n\n'
    spinner.success('main')
  }).catch(err => {
    spinner.error('main')
    console.log(`\n  ${errorLog}failed to build main process`)
    console.error(`\n${err}\n`)
    process.exit(1)
  })

  pack(rendererConfig).then(result => {
    results += result + '\n\n'
    spinner.success('renderer')
  }).catch(err => {
    spinner.error('renderer')
    console.log(`\n  ${errorLog}failed to build renderer process`)
    console.error(`\n${err}\n`)
    process.exit(1)
  })

  pack(webConfig).then(result => {
    results += result + '\n\n'
    spinner.success('web')
  }).catch(err => {
    spinner.error('web')
    console.log(`\n  ${errorLog}failed to build web process`)
    console.error(`\n${err}\n`)
    process.exit(1)
  })
}

async function pack(c: BaseConfig) {

  let config = await c.init()

  config.mode = 'production'
  webpack(config, (err: any, stats) => {
    if (err) {
      throw err.stack || err
    } else if (stats.hasErrors()) {
      let err = ''

      stats.toString({ chunks: false, colors: true })
        .split(/\r?\n/)
        .forEach(line => { err += `    ${line}\n` })

      throw err
    } else {
      return stats.toString({ chunks: false, colors: true })
    }
  })
}

function web() {
  deleteSync(['dist/web/*', '!.gitkeep'])
  webConfig.mode = 'production'
  webpack(webConfig, (err, stats) => {
    if (err || stats.hasErrors()) console.log(err)

    console.log(stats.toString({
      chunks: false,
      colors: true
    }))

    process.exit()
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