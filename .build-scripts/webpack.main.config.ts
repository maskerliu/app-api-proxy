'use strict'

import path from 'path'
import { fileURLToPath } from 'url'
import webpack, { Configuration } from 'webpack'
import { BaseConfig } from './webpack.base.config.js'

import config from '../build.config.json' assert { type: "json" }
import pkg from '../package.json' assert { type: "json" }

const { DefinePlugin, HotModuleReplacementPlugin, NoEmitOnErrorsPlugin } = webpack

const dirname = path.dirname(fileURLToPath(import.meta.url))

class MainConfig extends BaseConfig {

  target: Configuration['target'] = 'electron-main'
  entry: Configuration['entry'] = { main: path.join(dirname, '../src/main/index.ts') }
  externals: Configuration['externals'] = [...Object.keys(pkg.dependencies)]

  module: Configuration['module'] = {
    rules: [
      {
        test: /\.ts$/,
        loader: 'ts-loader',
        exclude: /node_modules/,
        options: {
          transpileOnly: true
        }
      },
      {
        test: /\.node$/,
        loader: 'node-loader',
      }
    ]
  }

  node: Configuration['node'] = {}

  output: Configuration['output'] = {
    filename: '[name].js',
    library: { type: 'commonjs2' },
    path: path.join(dirname, '../dist/electron')
  }

  plugins: Configuration['plugins'] = [
    new NoEmitOnErrorsPlugin(),
  ]

  resolve: Configuration['resolve'] = {
    alias: {

    },
    extensions: ['.js', '.ts', '.json', '.node']
  }

  init() {
    super.init()

    this.node = {
      __dirname: process.env.NODE_ENV !== 'production',
      __filename: process.env.NODE_ENV !== 'production'
    }

    this.plugins.push(new DefinePlugin({
      'process.env.NODE_ENV': `"${this.mode}"`,
      'process.env.BUILD_CONFIG': `'${JSON.stringify({ port: config.port })}'`
    }))

    if (process.env.NODE_ENV !== 'production') {
      this.plugins.push(new HotModuleReplacementPlugin())
    }

    return this
  }
}

export default new MainConfig()