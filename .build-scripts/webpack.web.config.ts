'use strict'

import HtmlWebpackPlugin from 'html-webpack-plugin'
import NodePolyfillPlugin from 'node-polyfill-webpack-plugin'
import path from 'path'
import { fileURLToPath } from 'url'
import { VueLoaderPlugin } from 'vue-loader'
import webpack, { Configuration } from 'webpack'
// import { BundleAnalyzerPlugin } from 'webpack-bundle-analyzer'
import pkg from '../package.json' assert { type: "json" }
import { BaseConfig } from './webpack.base.config'

const { DefinePlugin, LoaderOptionsPlugin, NoEmitOnErrorsPlugin } = webpack

const dirname = path.dirname(fileURLToPath(import.meta.url))

let whiteListedModules = ['axios']

class WebConfig extends BaseConfig {

  name: Configuration['name'] = 'web'
  devtool: Configuration['devtool'] = 'cheap-module-source-map'
  target: Configuration['target'] = 'web'
  entry: Configuration['entry'] = { web: path.join(dirname, '../src/renderer/index.ts') }
  externals: Configuration['externals'] = [...Object.keys(pkg.dependencies).filter(d => !whiteListedModules.includes(d))]
  ignoreWarnings = [/Failed to parse source map/]

  module: Configuration['module'] = {
    rules: [
      {
        test: /\.ts/,
        enforce: 'pre',
        use: ['source-map-loader']
      },
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
        test: /\.js/,
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
        test: /\.ts?$/,
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
        test: /\.(png|jpe?g|gif|svg)$/i,
        loader: 'url-loader',
        type: 'asset/resource',
        options: {
          limit: 1000,
          name: 'imgs/[hash][name].[ext]'
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
    // asyncWebAssembly: true,
    // syncWebAssembly: true
  }

  plugins: Configuration['plugins'] = [
    new webpack.ProvidePlugin({
      Buffer: ['buffer', 'Buffer'],
    }),
    new VueLoaderPlugin(),
    new NoEmitOnErrorsPlugin(),
    new NodePolyfillPlugin(),
    new DefinePlugin({
      __IS_WEB__: true,
      __VUE_OPTIONS_API__: false,
      __VUE_PROD_DEVTOOLS__: false,
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false
    }),
  ]

  output: Configuration['output'] = {
    filename: '[name].js',
    path: path.join(dirname, '../dist/web'),
  }

  resolve: Configuration['resolve'] = {
    alias: {
      '@': path.join(dirname, '../src/renderer'),
      // 'vue$': 'vue/dist/vue.esm-browser.js',
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
      })
    )

    if (process.env.NODE_ENV !== 'production') {
      this.plugins.push(new DefinePlugin({
        SERVER_BASE_URL: `'${pkg.config.protocol}://${localServer}:${pkg.config.port}'`,
      }))

      this.plugins.push(
        // new BundleAnalyzerPlugin({
        //   analyzerMode: 'server',
        //   analyzerHost: '127.0.0.1',
        //   analyzerPort: 9088,
        //   reportFilename: 'report.html',
        //   defaultSizes: 'parsed',
        //   openAnalyzer: true,
        //   generateStatsFile: false,
        //   statsFilename: 'stats.json',
        //   statsOptions: null,
        //   logLevel: 'info'
        // }),
      )
    } else {
      this.plugins?.push(
        // new CopyWebpackPlugin({
        //   patterns: [{
        //     from: path.join(dirname, '../static/favicon.ico'),
        //     to: path.join(dirname, '../dist/web/static/favicon.ico'),
        //   }]
        // }),
        new LoaderOptionsPlugin({ minimize: true }),
      )
      this.output!.publicPath = './'
    }

    return this
  }
}

export default new WebConfig()
