'use strict'

import crypto from 'crypto'
import fs, { createReadStream, createWriteStream, readFileSync, writeFileSync } from 'fs'
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
  let test = createWriteStream('./build/res/tmp')
  await pipeline(check, createGunzip(), test)
  fs.rmSync('./build/res/tmp')
  return digest
}

function uncompress(sourceDir: string, destDir: string) {
  let source = createReadStream(sourceDir)
  let dest = createWriteStream(destDir)
  source.pipe(createGunzip()).pipe(dest)
}

async function buildIncrementRelease() {
  let asarPath = ''
  switch (process.platform) {
    case 'win32':
      asarPath = `build/${pkg.version}/win-unpacked/resources/app.asar`
      break
    case 'darwin':
      asarPath = `build/${pkg.version}/${pkg.name}.app/Contents/Resources/app.asar`
      break
    case 'linux':
      break
  }

  let digest = await compress(asarPath, `build/res/app-${process.platform}-${process.arch}-${pkg.version}.gz`)
  let file = readFileSync(`build/${pkg.version}/latest.yml`, 'utf8')
  let lst = YAML.parse(file)
  let versionData = readFileSync(`build/version.json`, 'utf-8')
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
  writeFileSync(`build/version-${process.platform}-${process.arch}.json`, JSON.stringify(resp), 'utf8')
}

async function buildFullRelease() {
  let installerPath = ''
  switch (process.platform) {
    case 'win32':
      installerPath = `${pkg.version}/${pkg.name}\ Setup\ ${pkg.version}.exe`
      break
    case 'darwin':
      installerPath = `${pkg.version}/${pkg.name}-${pkg.version}-${process.arch}-mac.zip`
      break
    case 'linux':
      break
  }

  // let digest = await compress(installerPath, `build/res/app-${process.platform}-${process.arch}-${pkg.version}.gz`)
  let file = readFileSync(`build/${pkg.version}/latest.yml`, 'utf8')
  let lst = YAML.parse(file)
  let versionData = readFileSync(`build/version.json`, 'utf-8')
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
  writeFileSync(`build/version-${process.platform}-${process.arch}.json`, JSON.stringify(resp), 'utf8')
}


if (process.env.BUILD_TARGET === 'full') buildFullRelease()
else buildIncrementRelease()

// uncompress(`build/res/app-${pkg.version}.gz`, `build/res/app-${pkg.version}.asar`)