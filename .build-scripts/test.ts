'use strict'

import { spawnSync } from 'child_process'
import { globSync } from 'fs'
import minimist from 'minimist'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TSX_ARGS = ['--import', 'tsx']

const targets: Record<string, string> = {
  clean: '常规单测（默认）',
  unit: '常规单测',
  bench: '匹配性能基准',
  migration: 'v3 迁移回归',
  all: '单测 + 迁移 + 基准',
}

function runNode(args: string[], label: string): number {
  console.log(`\n[test] ${label}`)
  const result = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit', env: process.env })
  if (result.error != null) {
    console.error(result.error)
    return 1
  }
  return result.status ?? 1
}

function testFiles(pattern: string): string[] {
  return globSync(pattern, { cwd: ROOT }).map(file => path.resolve(ROOT, file)).sort()
}

function runUnit(): number {
  const files = testFiles('test/unit/**/*.test.ts')
  if (files.length === 0) {
    console.error('[test] 未找到 test/unit/**/*.test.ts')
    return 1
  }
  return runNode([...TSX_ARGS, '--test', ...files], `单测 ${files.length} 个文件`)
}

function runMigration(): number {
  const files = testFiles('test/migration/**/*.test.ts')
  if (files.length === 0) {
    console.error('[test] 未找到 test/migration/**/*.test.ts')
    return 1
  }
  return runNode([...TSX_ARGS, '--test', ...files], `迁移回归 ${files.length} 个文件`)
}

// 基准单独起进程：--expose-gc 必须在启动时生效
function runBench(): number {
  const file = path.resolve(ROOT, 'test/bench/matcher.bench.ts')
  return runNode(['--expose-gc', ...TSX_ARGS, file], '匹配基准')
}

function main() {
  const argv = minimist(process.argv.slice(2), { string: ['target'] })
  const target = String(argv.target ?? 'clean')

  if (targets[target] == null && target !== 'all') {
    console.error(`[test] 未知 target: ${target}`)
    console.error(`[test] 可选: ${Object.keys(targets).join(', ')}`)
    process.exit(1)
  }

  let status = 0
  if (target === 'bench') {
    status = runBench()
  } else if (target === 'migration') {
    status = runMigration()
  } else {
    status = runUnit()
    if (status === 0 && target === 'all') status = runMigration()
    if (status === 0 && target === 'all') status = runBench()
  }

  console.log(status === 0 ? '\n[test] 全部通过' : '\n[test] 存在失败用例')
  process.exit(status)
}

main()