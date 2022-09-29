
import { Configuration } from 'webpack'

export abstract class BaseConfig implements Configuration {
  target: Configuration['target'] = 'web'
  mode: Configuration["mode"] = "production"

  init(localServer?: string) {
    return this
  }
}