'use strict'

import crypto from 'crypto'
import fs, { createReadStream, createWriteStream, readFileSync, writeFileSync } from 'fs'
import minimist from 'minimist'
import path from 'path'
import { pipeline } from 'stream/promises'
import YAML from 'yaml'
import { createGunzip, createGzip } from 'zlib'
import pkg from '../package.json'

async function compress(sourceDir: string, destDir: string) {
  let hash = crypto.createHash('sha512')
  let source = createReadStream(sourceDir)
  let dest = createWriteStream(destDir)
  let digest = ''
  await pipeline(source, createGzip(), dest)

  let check = createReadStream(destDir)
  check.on('data', (chunk: any) => hash.update(chunk))
  check.on('end', () => { digest = hash.digest('base64') })
  let tmp = path.join('build', 'res', 'tmp')
  let test = createWriteStream(tmp)
  await pipeline(check, createGunzip(), test)
  fs.rmSync(tmp)
  return digest
}

async function uncompress(sourceDir: string, destDir: string) {
  let source = createReadStream(sourceDir)
  let dest = createWriteStream(destDir)
  await pipeline(source, createGunzip(), dest)
}

async function buildIncrementRelease(asarPath: string, ymlName: string) {
  let digest = await compress(asarPath,
    path.join('build', 'res', `app-${process.platform}-${process.arch}-${pkg.version}.gz`))
  let file = readFileSync(path.join('build', pkg.version, ymlName), 'utf8')
  let lst = YAML.parse(file)
  let versionData = readFileSync(path.join('build', 'version.json'), 'utf-8')
  let resp = JSON.parse(versionData)
  resp.data = {
    forceUpdate: true,
    fullUpdate: false,
    updateUrl: `http://127.0.0.1:4000/res/app-${process.platform}-${process.arch}-${lst.version}.gz`,
    message: `快更新到${lst.version}吧！！！`,
    version: lst.version,
    sha512: digest,
    releaseDate: lst.releaseDate
  }
  writeFileSync(path.join('build', `version-${process.platform}-${process.arch}.json`),
    JSON.stringify(resp, null, '\t'), 'utf8')
}

async function buildFullRelease(installerPath: string, ymlName: string) {
  let file = readFileSync(path.join('build', pkg.version, ymlName), 'utf8')
  let lst = YAML.parse(file)
  let versionData = readFileSync(path.join('build', 'version.json'), 'utf-8')
  let resp = JSON.parse(versionData)
  resp.data = {
    forceUpdate: true,
    fullUpdate: true,
    updateUrl: `http://127.0.0.1:4000/${installerPath}`,
    message: `快更新到${lst.version}吧！！！`,
    version: lst.version,
    sha512: lst.sha512,
    releaseDate: lst.releaseDate
  }

  writeFileSync(path.join('build', `version-${process.platform}-${process.arch}.json`),
    JSON.stringify(resp, null, '\t'), 'utf8')
}

let argv = minimist(process.argv.slice(2))

let asarPath = ''
let ymlName = ''
let installerPath = ''
switch (process.platform) {
  case 'win32':
    asarPath = path.join('build', pkg.version, 'win-unpacked', 'resources', 'app.asar')
    installerPath = `${pkg.version}/${pkg.name}-Setup-${pkg.version}.exe`
    ymlName = 'latest.yml'
    break
  case 'darwin':
    asarPath = path.join('build', pkg.version, `${pkg.name}.app`, 'Contents', 'Resources', 'app.asar')
    installerPath = `${pkg.version}/${pkg.name}-${pkg.version}-${process.arch}-mac.zip`
    ymlName = 'latest-mac.yml'
    break
  case 'linux':
    installerPath = `${pkg.version}/${pkg.name}-${pkg.version}.AppImage`
    asarPath = path.join('build', pkg.version, 'linux-unpacked', 'resources', 'app.asar')
    ymlName = 'latest-linux.yml'
    break
}

if (argv['target'] == 'full') buildFullRelease(installerPath, ymlName)
else buildIncrementRelease(asarPath, ymlName)

// uncompress(`build/res/app-${process.platform}-${process.arch}-${pkg.version}.gz`, `build/res/app-${pkg.version}.asar`)