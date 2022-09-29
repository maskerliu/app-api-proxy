'use strict'

import CopyWebpackPlugin from 'copy-webpack-plugin'
import HtmlWebpackPlugin from 'html-webpack-plugin'
import path from 'path'
import { fileURLToPath } from 'url'
import { VueLoaderPlugin } from 'vue-loader'
import webpack, { Configuration } from 'webpack'
import { BaseConfig } from './webpack.base.config.js'

const { DefinePlugin, LoaderOptionsPlugin } = webpack

let dirname = path.dirname(fileURLToPath(import.meta.url)) + '/'

class WebConfig extends BaseConfig {
  devtool: Configuration['devtool'] = 'eval-source-map'
  target: Configuration['target'] = 'web'
  entry: Configuration['entry'] = { web: path.join(dirname, '../src/web/index.ts') }
  externals: Configuration['externals'] = {}
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

  plugins: Configuration['plugins'] = [
    new VueLoaderPlugin(),
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
      'process.env.IS_WEB': 'true',
    }),
  ]

  output: Configuration['output'] = {
    filename: '[name].js',
    path: path.join(dirname, '../dist/web')
  }

  resolve: Configuration['resolve'] = {
    alias: {
      '@': path.join(dirname, '../src/renderer'),
      'vue$': 'vue/dist/vue.esm-browser.js',
      'vuex': 'vuex/dist/vuex.esm-browser.js',
    },
    extensions: ['.ts', '.js', '.vue', '.json', '.css', '.node']
  }

  init(localServer: String) {

    if (this.plugins == null) this.plugins = []

    if (process.env.NODE_ENV == 'production') {
      this.devtool = false
      this.plugins.push(
        new CopyWebpackPlugin({
          patterns: [
            {
              from: path.join(dirname, '../static/favicon.ico'),
              to: path.join(dirname, '../dist/web/static/favicon.ico'),
            }
          ]
        })
      )

      this.plugins.push(new DefinePlugin({ 'process.env.NODE_ENV': "'production'" }))
      this.plugins.push(new LoaderOptionsPlugin({ minimize: true }))
    } else {

      this.plugins.push(
        new DefinePlugin({
          'process.env.SERVER_BASE_URL': `'http://${localServer}:8885'`
        }),
        // new BundleAnalyzerPlugin({
        //     analyzerMode: 'server',
        //     analyzerHost: '127.0.0.1',
        //     analyzerPort: 9088,
        //     reportFilename: 'report.html',
        //     defaultSizes: 'parsed',
        //     openAnalyzer: true,
        //     generateStatsFile: false,
        //     statsFilename: 'stats.json',
        //     statsOptions: null,
        //     logLevel: 'info'
        // }),
      )
    }

    return this
  }
}

export default new WebConfig()
