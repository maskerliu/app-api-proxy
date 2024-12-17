'use strict'

import HtmlWebpackPlugin from 'html-webpack-plugin'
import NodePolyfillPlugin from 'node-polyfill-webpack-plugin'
import path from 'path'
import { fileURLToPath } from 'url'
import { VueLoaderPlugin } from 'vue-loader'
import webpack, { Configuration } from 'webpack'
import pkg from '../package.json' assert { type: "json" }
import { BaseConfig } from './webpack.base.config'

const { DefinePlugin, LoaderOptionsPlugin, NoEmitOnErrorsPlugin } = webpack

const dirname = path.dirname(fileURLToPath(import.meta.url))

let whiteListedModules = ['axios']

class RendererConfig extends BaseConfig {
  devtool: string | false = process.env.NODE_ENV !== 'production' ? "cheap-module-source-map" : false
  name: Configuration['name'] = 'renderer'
  // target: Configuration['target'] = 'electron-renderer'
  entry: Configuration['entry'] = { renderer: path.join(dirname, '../src/renderer/index.ts') }
  externals: Configuration['externals'] = [...Object.keys(pkg.dependencies).filter(d => !whiteListedModules.includes(d))]

  module: Configuration['module'] = {
    rules: [
      {
        test: /\.vue$/,
        loader: 'vue-loader',
        resolve: {
          fullySpecified: false,
        },
        options: {
          reactivityTransform: true
        }
      },
      {
        test: /\.css$/,
        use: ['vue-style-loader', 'css-loader']
      },
      {
        test: /\.tsx?$/,
        loader: 'ts-loader',
        exclude: /node_modules/,
        resolve: {
          fullySpecified: false,
        },
        options: {
          transpileOnly: true
        }
      },
      {
        test: /\.wasm$/,
        type: "asset/inline",
      },
      {
        test: /\.(png|jpe?g|gif|svg)(\?.*)?$/,
        loader: 'url-loader',
        options: {
          limit: 10000,
          name: 'imgs/[name].[ext]'
        }
      },
      {
        test: /\.(woff2?|eot|ttf|otf)(\?.*)?$/,
        loader: 'url-loader',
        options: {
          limit: 10000,
          name: 'fonts/[name].[ext]'
        }
      }
    ]
  }

  experiments: Configuration['experiments'] = {
    asyncWebAssembly: true,
    syncWebAssembly: true
  }

  plugins: Configuration['plugins'] = [
    new webpack.ProvidePlugin({
      Buffer: ['buffer', 'Buffer'],
    }),
    new VueLoaderPlugin(),
    new NoEmitOnErrorsPlugin(),
    new NodePolyfillPlugin(),
    new DefinePlugin({
      __IS_WEB__: false,
      __VUE_OPTIONS_API__: false,
      __VUE_PROD_DEVTOOLS__: false,
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false
    }),
  ]

  output: Configuration['output'] = {
    filename: '[name].js',
    path: path.join(dirname, '../dist/electron'),
  }

  resolve: Configuration['resolve'] = {
    alias: {
      '@': path.join(dirname, '../src/renderer'),
    },
    extensions: ['.js', '.ts', '.vue', '.json', '.css']
  }

  optimization: Configuration['optimization'] = {
    splitChunks: {
      chunks: 'all',
      cacheGroups: {
        vender: {
          name: 'vender',
          test: /[\\/]node_modules[\\/]/,
          priority: 10,
          chunks: 'initial'
        },
        vant: {
          name: "vant",
          priority: 20,
          test: /[\\/]node_modules[\\/]vant[\\/]/
        },
        echarts: {
          name: 'echarts',
          test: /[\\/]node_modules[\\/]echarts[\\/]/,
          priority: 20,
        }
      }
    },
  }

  init(localServer?: string) {
    super.init()

    this.node = {
      // __dirname: process.env.NODE_ENV !== 'production',
      // __filename: process.env.NODE_ENV !== 'production'
    }

    this.plugins?.push(
      new HtmlWebpackPlugin({
        filename: 'index.html',
        template: path.resolve(dirname, '../src/index.ejs'),
        minify: {
          collapseWhitespace: true,
          removeAttributeQuotes: true,
          removeComments: true
        },
        nodeModules: process.env.NODE_ENV !== 'production' ? path.resolve(dirname, '../node_modules') : false
      }),
      new DefinePlugin({
        SERVER_BASE_URL: `'${pkg.config.protocol}://localhost:${pkg.config.port}'`, PROTOCOL: `'${pkg.config.protocol}'`
      }),
    )

    if (process.env.NODE_ENV !== 'production') {
      this.plugins?.push(
        new DefinePlugin({ '__static': `'${path.join(dirname, '../static').replace(/\\/g, '\\\\')}'` }),
      )
    } else {
      this.plugins?.push(new LoaderOptionsPlugin({ minimize: true }))
      this.output!.publicPath = './'
    }

    return this
  }
}

export default new RendererConfig()