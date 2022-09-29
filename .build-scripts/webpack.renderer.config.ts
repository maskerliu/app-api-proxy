'use strict'

import CopyWebpackPlugin from 'copy-webpack-plugin'
import HtmlWebpackPlugin from 'html-webpack-plugin'
import path from 'path'
import { fileURLToPath } from 'url'
import { VueLoaderPlugin } from 'vue-loader'
import webpack, { Configuration } from 'webpack'
import pkg from '../package.json'
import { BaseConfig } from './webpack.base.config.js'


const { DefinePlugin, LoaderOptionsPlugin, NoEmitOnErrorsPlugin, HotModuleReplacementPlugin, NormalModuleReplacementPlugin } = webpack

let dirname = path.dirname(fileURLToPath(import.meta.url)) + '/'
let whiteListedModules = ['vue']

class RendererConfig extends BaseConfig {


  devtool: Configuration['devtool'] = 'eval-source-map'
  target: Configuration['target'] = 'electron-renderer'
  entry: Configuration['entry'] = { renderer: path.join(dirname, '../src/renderer/index.ts') }
  externals: Configuration['externals'] = [...Object.keys(pkg.dependencies || {}).filter(d => !whiteListedModules.includes(d)),]
  mode: Configuration['mode'] = 'production'

  module: Configuration['module'] = {
    rules: [
      {
        test: /\.vue$/,
        loader: 'vue-loader'
      },
      {
        test: /\.less$/,
        use: ['vue-style-loader', 'less-loader']
      },
      {
        test: /\.css$/,
        use: ['vue-style-loader', 'css-loader']
      },
      {
        test: /\.tsx?$/,
        loader: 'ts-loader',
        exclude: /node_modules/,
        options: {
          transpileOnly: true
        }
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

  node: Configuration['node'] = {
    __dirname: process.env.NODE_ENV !== 'production',
    __filename: process.env.NODE_ENV !== 'production'
  }

  plugins: Configuration['plugins'] = [
    new VueLoaderPlugin(),
    new NoEmitOnErrorsPlugin(),
    new HotModuleReplacementPlugin(),
    new NormalModuleReplacementPlugin(
      /^node:/,
      (resource) => {
        resource.request = resource.request.replace(/^node:/, '')
      },
    ),
    new HtmlWebpackPlugin({
      filename: 'index.html',
      template: path.resolve(dirname, '../src/index.ejs'),
      minify: {
        collapseWhitespace: true,
        removeAttributeQuotes: true,
        removeComments: true
      },
      nodeModules: false
    }),
    new DefinePlugin({
      __VUE_OPTIONS_API__: true,
      __VUE_PROD_DEVTOOLS__: true,
    }),
  ]

  output: Configuration['output'] = {
    filename: '[name].js',
    library: {
      type: 'commonjs2'
    },
    path: path.join(dirname, '../dist/electron')
  }

  resolve: Configuration['resolve'] = {
    alias: {
      '@': path.join(dirname, '../src/renderer'),
      'vue$': 'vue/dist/vue.esm-browser.js',
      'vuex': 'vuex/dist/vuex.esm-browser.js',
    },
    extensions: ['.js', '.ts', '.vue', '.json', '.css']
  }

  init(localServer: string) {

    if (this.plugins == null) this.plugins = []

    if (process.env.NODE_ENV !== 'production') {
      this.plugins.push(

      )
      this.plugins.push(
        new DefinePlugin({
          'process.env.SERVER_BASE_URL': `'http://${localServer}:8885'`
        }),
        new DefinePlugin({
          '__static': `'${path.join(dirname, '../static').replace(/\\/g, '\\\\')}'`
        }),
        // new BundleAnalyzerPlugin({
        //     analyzerMode: 'server',
        //     analyzerHost: '127.0.0.1',
        //     analyzerPort: 9089,
        //     reportFilename: 'report.html',
        //     defaultSizes: 'parsed',
        //     openAnalyzer: true,
        //     generateStatsFile: false,
        //     statsFilename: 'stats.json',
        //     statsOptions: null,
        //     logLevel: 'info'
        // }),
      )
    } else {

      this.devtool = false

      this.plugins.push(new LoaderOptionsPlugin({ minimize: true }))

      this.plugins.push(new CopyWebpackPlugin({
        patterns: [
          {
            from: path.join(dirname, '../static/icon.ico'),
            to: path.join(dirname, '../dist/electron/static/icon.ico'),
          },
          {
            from: path.join(dirname, '../static/icon_*.png'),
            to: path.join(dirname, '../dist/electron/static'),
          }
        ],
      }))
    }

    return this
  }
}

export default new RendererConfig()