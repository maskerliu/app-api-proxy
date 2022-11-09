
import webpack, { Configuration } from 'webpack'

const { DefinePlugin } = webpack

export abstract class BaseConfig implements Configuration {

  devtool: Configuration['devtool'] = 'eval-cheap-module-source-map'
  target: Configuration['target'] = 'web'
  mode: Configuration["mode"] = "production"
  node: Configuration['node'] = {}
  plugins: Configuration['plugins'] = []

  init(localServer?: string) {
    this.plugins.push(new DefinePlugin({ __DEV__: process.env.NODE_ENV !== 'production' }))
    if (process.env.NODE_ENV === 'production') {
      this.devtool = false
    }

    return this
  }
}