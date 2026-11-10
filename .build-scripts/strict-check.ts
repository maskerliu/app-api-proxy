'use strict'

import path from 'path'
import ts from 'typescript'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG = 'tsconfig.strict.json'

// 已收口清单：这些路径前缀下 strictNullChecks 必须零错误。
// 每清完一个目录就把前缀加进来，未加入的路径只统计不拦，避免一次性铺开 200 处。
const CLEAN_PATHS = [
  'src/main/service/mock.migration.ts',
  'src/renderer/common',
]

const parsed = ts.readConfigFile(path.join(ROOT, CONFIG), ts.sys.readFile)
if (parsed.error != null) {
  console.error(`[strict] ${CONFIG} 读取失败：${ts.flattenDiagnosticMessageText(parsed.error.messageText, ' ')}`)
  process.exit(1)
}

const config = ts.parseJsonConfigFileContent(parsed.config, ts.sys, ROOT)
const program = ts.createProgram({ rootNames: config.fileNames, options: config.options })

function fileOf(diagnostic: ts.Diagnostic): string {
  if (diagnostic.file == null) return '<未知位置>'
  return path.relative(ROOT, diagnostic.file.fileName).split(path.sep).join('/')
}

function isClean(file: string): boolean {
  return CLEAN_PATHS.some(prefix => file === prefix || file.startsWith(`${prefix}/`))
}

const blocked: string[] = []
const pending = new Map<string, number>()
for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
  if (diagnostic.category !== ts.DiagnosticCategory.Error) continue
  const file = fileOf(diagnostic)
  const message = `TS${diagnostic.code} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`
  if (isClean(file)) {
    blocked.push(`  ${file}: ${message}`)
    continue
  }
  const dir = file.split('/').slice(0, 3).join('/')
  pending.set(dir, (pending.get(dir) ?? 0) + 1)
}

const rest = [...pending.entries()].sort((a, b) => b[1] - a[1])
const total = rest.reduce((sum, [, count]) => sum + count, 0)

console.log(`[strict] 已收口 ${CLEAN_PATHS.length} 项，未收口共 ${total} 处：`)
for (const [dir, count] of rest) console.log(`  ${String(count).padStart(4)} ${dir}`)

if (blocked.length > 0) {
  console.error(`\n[strict] 已收口路径仍有 ${blocked.length} 处 null 相关错误：`)
  blocked.forEach(line => console.error(line))
  process.exit(1)
}

console.log('[strict] 已收口路径全部干净')
