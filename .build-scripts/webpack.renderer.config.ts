'use strict'

import HtmlWebpackPlugin from 'html-webpack-plugin'
import path from 'path'
import { fileURLToPath } from 'url'
import { VueLoaderPlugin } from 'vue-loader'
import webpack, { Configuration } from 'webpack'
import pkg from '../package.json'
import { BaseConfig } from './webpack.base.config.js'

const { DefinePlugin, LoaderOptionsPlugin, NoEmitOnErrorsPlugin } = webpack

const dirname = path.dirname(fileURLToPath(import.meta.url))

class RendererConfig extends BaseConfig {

  devtool: Configuration['devtool'] = 'eval-source-map'
  target: Configuration['target'] = 'electron-renderer'
  entry: Configuration['entry'] = { renderer: path.join(dirname, '../src/renderer/index.ts') }
  externals: Configuration['externals'] = [...Object.keys(pkg.dependencies)]
  optimization: Configuration['optimization'] = {}

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

  node: Configuration['node'] = {}

  plugins: Configuration['plugins'] = [
    new VueLoaderPlugin(),
    new NoEmitOnErrorsPlugin(),
    new DefinePlugin({
      __IS_WEB__: false,
      __VUE_OPTIONS_API__: false,
      __VUE_PROD_DEVTOOLS__: false,
    }),
  ]

  output: Configuration['output'] = {
    filename: '[name].js',
    library: { type: 'commonjs2' },
    path: path.join(dirname, '../dist/electron'),
  }

  resolve: Configuration['resolve'] = {
    alias: {
      '@': path.join(dirname, '../src/renderer'),
      'vue$': 'vue/dist/vue.esm-browser.js',
      'vuex': 'vuex/dist/vuex.esm-browser.js',
    },
    extensions: ['.js', '.ts', '.vue', '.json', '.css']
  }

  init(localServer?: string) {
    super.init()

    this.node = {
      __dirname: process.env.NODE_ENV !== 'production',
      __filename: process.env.NODE_ENV !== 'production'
    }

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
        new DefinePlugin({ SERVER_BASE_URL: `'http://${localServer}:8885'` }),
        new DefinePlugin({ '__static': `'${path.join(dirname, '../static').replace(/\\/g, '\\\\')}'` }),
      )
    } else {
      this.devtool = false
      this.plugins.push(new LoaderOptionsPlugin({ minimize: true }))
      this.output.publicPath = './'
      this.optimization = {
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
            }
          }
        },
      }
    }

    return this
  }
}

export default new RendererConfig()