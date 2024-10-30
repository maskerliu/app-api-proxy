'use strict'

import CopyWebpackPlugin from 'copy-webpack-plugin'
import path from 'path'
import { fileURLToPath } from 'url'
import webpack, { Configuration } from 'webpack'
import { BaseConfig } from './webpack.base.config'

import config from '../build.config.json' assert { type: "json" }
import pkg from '../package.json' assert { type: "json" }

const { DefinePlugin, HotModuleReplacementPlugin, NoEmitOnErrorsPlugin } = webpack

const dirname = path.dirname(fileURLToPath(import.meta.url))

class MainConfig extends BaseConfig {

  devtool: string | false = process.env.NODE_ENV !== 'production' ? "cheap-module-source-map" : false
  name: Configuration['name'] = 'main'
  target: Configuration['target'] = 'electron-main'
  entry: Configuration['entry'] = {
    main: path.join(dirname, '../src/main/index.ts'),
    preload: path.join(dirname, '../src/main/Preload.ts')
  }
  externals: Configuration['externals'] = [...Object.keys(pkg.dependencies)]

  module: Configuration['module'] = {
    rules: [
      {
        test: /\.ts/,
        loader: 'source-map-loader'
      },
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

  node: Configuration['node'] = {
    __dirname: false,
    __filename: false
  }

  output: Configuration['output'] = {
    filename: '[name].cjs',
    library: { type: 'commonjs2' },
    path: path.join(dirname, '../dist/electron')
  }

  plugins: Configuration['plugins'] = [
    new NoEmitOnErrorsPlugin(),
  ]

  resolve: Configuration['resolve'] = {
    alias: {
      './': path.join(dirname, '../src/main'),
    },
    extensions: ['.ts', '.js', '.json', '.node']
  }

  init() {
    super.init()

    this.node = {
      // __dirname: process.env.NODE_ENV !== 'production',
      // __filename: process.env.NODE_ENV !== 'production'
    }

    this.plugins?.push(new DefinePlugin({
      'process.env.NODE_ENV': `"${this.mode}"`,
      'process.env.BUILD_CONFIG': `'${JSON.stringify(config)}'`
    }))

    this.plugins?.push(
      new CopyWebpackPlugin({
        patterns: [{
          from: path.join(dirname, '../cert'),
          to: path.join(dirname, '../dist/electron/'),
        }]
      }),
      new CopyWebpackPlugin({
        patterns: [{
          from: path.join(dirname, '../icons'),
          to: path.join(dirname, '../build/icons/'),
        }]
      }),
    )

    if (process.env.NODE_ENV !== 'production') {
      this.plugins?.push(new HotModuleReplacementPlugin())
    } else {

    }

    return this
  }
}

export default new MainConfig()