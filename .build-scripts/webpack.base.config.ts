
import path from 'path'
import { fileURLToPath } from 'url'
import webpack, { Configuration } from 'webpack'

const { DefinePlugin } = webpack

export abstract class BaseConfig implements Configuration {

  target: Configuration['target'] = 'web'
  mode: Configuration["mode"] = "production"

  plugins: Configuration['plugins'] = []

  init(localServer?: string) {
    this.plugins.push(new DefinePlugin({ __DEV__: process.env.NODE_ENV !== 'production' }))
    return this
  }
}