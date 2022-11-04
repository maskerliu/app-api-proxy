'use strict'

import CopyWebpackPlugin from 'copy-webpack-plugin'
import HtmlWebpackPlugin from 'html-webpack-plugin'
import NodePolyfillPlugin from 'node-polyfill-webpack-plugin'
import path from 'path'
import { fileURLToPath } from 'url'
import { VueLoaderPlugin } from 'vue-loader'
import webpack, { Configuration } from 'webpack'
import { BundleAnalyzerPlugin } from 'webpack-bundle-analyzer'
import config from '../build.config.json' assert { type: "json" }
import pkg from '../package.json' assert { type: "json" }
import { BaseConfig } from './webpack.base.config.js'

const { DefinePlugin, LoaderOptionsPlugin, NoEmitOnErrorsPlugin } = webpack

const dirname = path.dirname(fileURLToPath(import.meta.url))

let whiteListedModules = ['mqtt', 'axios']

class WebConfig extends BaseConfig {

  target: Configuration['target'] = 'web'
  entry: Configuration['entry'] = { web: path.join(dirname, '../src/web/index.ts') }
  externals: Configuration['externals'] = [...Object.keys(pkg.dependencies).filter(d => !whiteListedModules.includes(d))]


  module: Configuration['module'] = {
    rules: [
      {
        test: /\.vue$/,
        loader: 'vue-loader',
        options: {
          reactivityTransform: true
        }
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

  plugins: Configuration['plugins'] = [
    new VueLoaderPlugin(),
    new NoEmitOnErrorsPlugin(),
    new NodePolyfillPlugin(),
    new DefinePlugin({
      __IS_WEB__: true,
      __VUE_OPTIONS_API__: false,
      __VUE_PROD_DEVTOOLS__: false,
    }),
  ]

  output: Configuration['output'] = {
    filename: '[name].js',
    path: path.join(dirname, '../dist/web'),
  }

  resolve: Configuration['resolve'] = {
    alias: {
      '@': path.join(dirname, '../src/renderer'),
      'vue$': 'vue/dist/vue.esm-browser.js',
      'vuex': 'vuex/dist/vuex.esm-browser.js',
    },
    extensions: ['.ts', '.js', '.vue', '.json', '.css', '.node']
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
        jsoneditor: {
          name: 'jsoneditor',
          test: /[\\/]node_modules[\\/]jsoneditor[\\/]/,
          priority: 20,
        },
        echarts: {
          name: 'echarts',
          test: /[\\/]node_modules[\\/]echarts[\\/]/,
          priority: 20,
        }
      }
    },
  }

  init(localServer?: String) {
    super.init()

    this.plugins.push(new HtmlWebpackPlugin({
      filename: 'index.html',
      template: path.resolve(dirname, '../src/index.ejs'),
      minify: {
        collapseWhitespace: true,
        removeAttributeQuotes: true,
        removeComments: true
      },
      nodeModules: process.env.NODE_ENV !== 'production' ? path.resolve(dirname, '../node_modules') : false
    }))

    if (process.env.NODE_ENV !== 'production') {
      this.plugins.push(
        new DefinePlugin({ SERVER_BASE_URL: `'http://${localServer}:${config.port}'` }),
        new BundleAnalyzerPlugin({
          analyzerMode: 'server',
          analyzerHost: '127.0.0.1',
          analyzerPort: 9088,
          reportFilename: 'report.html',
          defaultSizes: 'parsed',
          openAnalyzer: true,
          generateStatsFile: false,
          statsFilename: 'stats.json',
          statsOptions: null,
          logLevel: 'info'
        }),
      )
    } else {
      this.plugins.push(
        new CopyWebpackPlugin({
          patterns: [{
            from: path.join(dirname, '../static/favicon.ico'),
            to: path.join(dirname, '../dist/web/static/favicon.ico'),
          }]
        }),
        new LoaderOptionsPlugin({ minimize: true }),
      )
      this.output.publicPath = './'
    }
    
    return this
  }
}

export default new WebConfig()
