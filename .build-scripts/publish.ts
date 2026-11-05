'use strict'

import crypto from 'crypto'
import fs from 'fs'
import minimist from 'minimist'
import path from 'path'
import { Writable } from 'stream'
import { pipeline } from 'stream/promises'
import YAML from 'yaml'
import { createGunzip, createGzip } from 'zlib'
import pkg from '../package.json'
import { getLocalIPs } from './misc'

const VIRTUAL_IFACE = /vethernet|hyper-v|vmware|virtualbox|wsl|docker|tailscale|zerotier|virtual/i

const BUILD_DIR = 'build'
const RES_DIR = path.join(BUILD_DIR, 'res')
const VERSION_DIR = path.join(BUILD_DIR, pkg.version)

type Platform = 'win32' | 'darwin' | 'linux'

interface ArtifactMeta {
  version: string
  releaseDate: string
  files: Array<{ url?: string }>
}

interface ReleaseTarget {
  platform: Platform
  arch: string
  appDir: string | null
  asar: string | null
}

interface ReleaseResult {
  platform: Platform
  arch: string
  data: VersionData
}

interface VersionData {
  forceUpdate: boolean
  fullUpdate: boolean
  updateUrl: string
  message: string
  version: string
  sha512: string
  releaseDate: string
}

const META_FILES: Record<Platform, string> = {
  win32: 'latest.yml',
  darwin: 'latest-mac.yml',
  linux: 'latest-linux.yml'
}

const INSTALLER_EXT: Record<Platform, string> = {
  win32: '.exe',
  darwin: '.zip',
  linux: '.appimage'
}

// electron-builder 解包目录与产物平台的对应关系，universal 会拆成 x64/arm64 两个更新入口
const UNPACKED_DIRS: ReadonlyArray<{ dir: string; platform: Platform; arch: string }> = [
  { dir: 'win-unpacked', platform: 'win32', arch: 'x64' },
  { dir: 'win-ia32-unpacked', platform: 'win32', arch: 'ia32' },
  { dir: 'win-arm64-unpacked', platform: 'win32', arch: 'arm64' },
  { dir: 'linux-unpacked', platform: 'linux', arch: 'x64' },
  { dir: 'linux-arm64-unpacked', platform: 'linux', arch: 'arm64' },
  { dir: 'mac', platform: 'darwin', arch: 'x64' },
  { dir: 'mac-x64', platform: 'darwin', arch: 'x64' },
  { dir: 'mac-arm64', platform: 'darwin', arch: 'arm64' },
  { dir: 'mac-universal', platform: 'darwin', arch: 'universal' }
]

const argv = minimist(process.argv.slice(2), {
  boolean: ['force'],
  default: { force: true, port: 4000 }
})

const full = argv.target === 'full' || argv.full === true
const forceUpdate = argv.force !== false

// 取对外可达的局域网 IPv4，供其他设备访问更新包
function lanAddress(): string {
  const ips = getLocalIPs().filter(it => !it.internal)
  const candidates = ips.filter(it => !VIRTUAL_IFACE.test(it.name))
  const picked = candidates.find(it => it.address.startsWith('192.168.'))
    ?? candidates.find(it => it.address.startsWith('10.'))
    ?? candidates.find(it => /^172\.(1[6-9]|2\d|3[01])\./.test(it.address))
    ?? candidates[0]
  if (picked == null) {
    console.warn('未找到局域网 IPv4 地址，updateUrl 回退到 127.0.0.1')
    return '127.0.0.1'
  }
  return picked.address
}

function resolveBaseUrl(): string {
  const custom = argv['update-url'] ?? argv.url
  const base = typeof custom === 'string' && custom.trim()
    ? custom.trim()
    : `http://${lanAddress()}:${Number(argv.port) || 4000}`
  return base.replace(/\/+$/, '')
}

function toUrlPath(file: string): string {
  return path.relative(BUILD_DIR, file)
    .split(path.sep)
    .map(encodeURIComponent)
    .join('/')
}

function readJson(file: string): any {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

// 保留 version.json 已有的外层字段（code/msg），只替换 data
function releaseShell(): any {
  const prev = readJson(path.join(BUILD_DIR, 'version.json'))
  const shell = prev && typeof prev === 'object' ? { ...prev } : {}
  delete shell.data
  if (typeof shell.code !== 'number') shell.code = 8000
  return shell
}

function metaOf(platform: Platform): ArtifactMeta {
  const file = path.join(VERSION_DIR, META_FILES[platform])
  let parsed: any = {}
  if (fs.existsSync(file)) parsed = YAML.parse(fs.readFileSync(file, 'utf8')) ?? {}
  else console.warn(`未找到 ${META_FILES[platform]}，releaseDate 使用当前时间`)

  const releaseDate = parsed.releaseDate instanceof Date
    ? parsed.releaseDate.toISOString()
    : parsed.releaseDate ?? new Date().toISOString()
  return {
    version: parsed.version ?? pkg.version,
    releaseDate,
    files: Array.isArray(parsed.files) ? parsed.files : []
  }
}

function findAsar(appDir: string): string | null {
  const picked = [
    path.join(appDir, 'resources', 'app.asar'),
    path.join(appDir, 'Contents', 'Resources', 'app.asar')
  ].find(it => fs.existsSync(it))
  if (picked != null) return picked

  for (const name of fs.readdirSync(appDir)) {
    if (!name.endsWith('.app')) continue
    const file = path.join(appDir, name, 'Contents', 'Resources', 'app.asar')
    if (fs.existsSync(file)) return file
  }
  return null
}

function collectTargets(): ReleaseTarget[] {
  const targets = new Map<string, ReleaseTarget>()
  for (const item of UNPACKED_DIRS) {
    const appDir = path.join(VERSION_DIR, item.dir)
    if (!fs.existsSync(appDir)) continue

    const asar = findAsar(appDir)
    const arches = item.arch === 'universal' ? ['x64', 'arm64'] : [item.arch]
    for (const arch of arches) {
      const key = `${item.platform}-${arch}`
      const prev = targets.get(key)
      if (prev?.asar != null && asar == null) continue
      targets.set(key, { platform: item.platform, arch, appDir, asar })
    }
  }

  if (targets.size > 0) return [...targets.values()]

  const platform = process.platform as Platform
  if (!(platform in META_FILES)) throw new Error(`不支持的平台：${process.platform}`)
  return [{ platform, arch: process.arch, appDir: null, asar: null }]
}

function resolveInstaller(platform: Platform, meta: ArtifactMeta): string | null {
  const ext = INSTALLER_EXT[platform]
  const names = [
    ...meta.files.map(it => it?.url).filter(Boolean),
    ...(fs.existsSync(VERSION_DIR) ? fs.readdirSync(VERSION_DIR) : [])
  ]
  for (const name of names) {
    const base = path.basename(String(name))
    if (!base.toLowerCase().endsWith(ext)) continue
    const file = path.join(VERSION_DIR, base)
    if (fs.existsSync(file)) return file
  }
  return null
}

function sha512File(file: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const hash = crypto.createHash('sha512')
    fs.createReadStream(file)
      .on('data', (chunk: any) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('base64')))
      .on('error', reject)
  })
}

async function compress(source: string, dest: string): Promise<string> {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  await pipeline(fs.createReadStream(source), createGzip(), fs.createWriteStream(dest))
  // 解压校验一次，避免产出损坏的增量包
  await pipeline(fs.createReadStream(dest), createGunzip(), new Writable({ write(_chunk, _encoding, callback) { callback() } }))
  return sha512File(dest)
}

function writeVersionFile(platform: Platform, arch: string, shell: any, data: VersionData) {
  const file = path.join(BUILD_DIR, `version-${platform}-${arch}.json`)
  fs.writeFileSync(file, JSON.stringify({ ...shell, data }, null, '\t'), 'utf8')
  return file
}

async function main() {
  const baseUrl = resolveBaseUrl()
  const shell = releaseShell()
  const targets = collectTargets()

  console.log(`\n发布模式: ${full ? '全量' : '增量'}    版本: ${pkg.version}`)
  console.log(`更新地址: ${baseUrl}\n`)

  const results: ReleaseResult[] = []

  for (const target of targets) {
    const meta = metaOf(target.platform)
    if (meta.version !== pkg.version) {
      console.warn(`[警告] ${META_FILES[target.platform]} 版本 ${meta.version} 与 package.json 版本 ${pkg.version} 不一致`)
    }

    let data: VersionData
    let artifact: string

    if (full) {
      if (target.platform === 'linux') {
        console.warn(`[跳过] linux-${target.arch}：客户端暂不支持全量更新`)
        continue
      }
      const installer = resolveInstaller(target.platform, meta)
      if (installer == null) {
        console.warn(`[跳过] ${target.platform}-${target.arch}：未找到 ${INSTALLER_EXT[target.platform]} 安装包`)
        continue
      }
      artifact = installer
      data = {
        forceUpdate,
        fullUpdate: true,
        updateUrl: `${baseUrl}/${toUrlPath(installer)}`,
        message: typeof argv.message === 'string' ? argv.message : `快更新到${meta.version}吧！！！`,
        version: meta.version,
        sha512: await sha512File(installer),
        releaseDate: meta.releaseDate
      }
    } else {
      if (target.asar == null) {
        console.warn(`[跳过] ${target.platform}-${target.arch}：未找到 app.asar`)
        continue
      }
      artifact = path.join(RES_DIR, `app-${target.platform}-${target.arch}-${meta.version}.gz`)
      data = {
        forceUpdate,
        fullUpdate: false,
        updateUrl: `${baseUrl}/${toUrlPath(artifact)}`,
        message: typeof argv.message === 'string' ? argv.message : `快更新到${meta.version}吧！！！`,
        version: meta.version,
        sha512: await compress(target.asar, artifact),
        releaseDate: meta.releaseDate
      }
    }

    const versionFile = writeVersionFile(target.platform, target.arch, shell, data)
    results.push({ platform: target.platform, arch: target.arch, data })
    console.log(`[完成] ${target.platform}-${target.arch}`)
    console.log(`       包: ${path.relative(process.cwd(), artifact)}`)
    console.log(`       版本文件: ${path.relative(process.cwd(), versionFile)}`)
    console.log(`       地址: ${data.updateUrl}\n`)
  }

  if (results.length === 0) {
    throw new Error(full
      ? '没有可发布的全量更新产物，请确认已执行 yarn pkg 且平台支持全量更新'
      : '没有可发布的增量更新产物，请确认已执行 yarn pkg')
  }

  const hostResult = results.find(it => it.platform === process.platform && it.arch === process.arch) ?? results[0]
  fs.writeFileSync(
    path.join(BUILD_DIR, 'version.json'),
    JSON.stringify({ ...shell, data: hostResult.data }, null, '\t'),
    'utf8'
  )
  console.log(`[完成] version.json -> ${hostResult.platform}-${hostResult.arch}`)
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
})
