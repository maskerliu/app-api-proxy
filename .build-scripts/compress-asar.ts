'use strict'

import { createReadStream, createWriteStream, readFileSync, writeFileSync } from 'fs'
import YAML from 'yaml'
import { createGunzip, createGzip } from 'zlib'
import pkg from '../package.json'

function compress(sourceDir: string, destDir: string) {
  let source = createReadStream(sourceDir)
  let dest = createWriteStream(destDir)
  source.pipe(createGzip()).pipe(dest)
}

function uncompress(sourceDir: string, destDir: string) {
  let source = createReadStream(sourceDir)
  let dest = createWriteStream(destDir)
  source.pipe(createGunzip()).pipe(dest)
}

compress(`build/${pkg.version}/win-unpacked/resources/app.asar`, `build/res/app-${pkg.version}.gz`)

let file = readFileSync(`build/${pkg.version}/latest.yml`, 'utf8')
let lst = YAML.parse(file)
let versionData = readFileSync(`build/version.json`, 'utf-8')
let resp = JSON.parse(versionData)
resp.data.updateUrl = `http://127.0.0.1:4000/res/app-${pkg.version}.gz`
resp.data.message = `更新到${pkg.version}吧！！！`
resp.data.version = pkg.version
writeFileSync(`build/version.json`, JSON.stringify(resp), 'utf8')

// uncompress(`build/res/app-${pkg.version}.gz`, `build/res/app-${pkg.version}.asar`)