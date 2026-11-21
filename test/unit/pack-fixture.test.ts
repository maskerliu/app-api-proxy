import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import { ProxyMock } from '@shared/proxy.models'
import type { MockMatchRule } from '@shared/mock.models'
import {
  MOCK_PACK_FORMAT, MOCK_PACK_MAX_FILE_BYTES, MOCK_PACK_VERSION,
  readMockPackText, validateMockPackRecords,
} from '@shared/mock.pack'
import type { MockPackRecord } from '@shared/mock.pack'

// 读侧三阶段的服务层串法（`readMockPack`）要经 constants.ts 引用 electron，
// 与 pack-validate.test.ts 同一套最小替身：只在共享层手拼一遍就测不到「端点看到的那条链」。
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'electron') {
      return {
        url: 'data:text/javascript,export const app={getPath:()=>process.env.TMPDIR||"/tmp",getVersion:()=>"0.0.0"}',
        shortCircuit: true,
      }
    }
    return nextResolve(specifier, context)
  },
})

const { readMockPack } = await import('@main/service/mock.pack.service')

const FIXTURE_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/mock-pack/v1.json')
const text = readFileSync(FIXTURE_PATH, 'utf8')
const bytes = Buffer.byteLength(text, 'utf8')
const read = readMockPack(text)

/** fixture 的基准时刻：包里不许出现 `Date.now()` 现造的时间戳，理由见倒数第二条用例 */
const T0 = Date.UTC(2026, 10, 15, 2, 30, 0)
const MINUTE = 60_000

const SCENE_TOTAL = 3
const RECORD_TOTAL = 15

function everyRecord(): MockPackRecord[] {
  return read.pack.rules.flatMap(rule => rule.records)
}

describe('导入 fixture 过得了读侧三阶段（test/fixtures/mock-pack/v1.json）', () => {
  it('包级闸门：字节数、format、version 与条数都在契约内', () => {
    assert.ok(bytes < MOCK_PACK_MAX_FILE_BYTES, `fixture ${bytes} 字节，别把它养成压线的体积`)
    const pack = readMockPackText(text, bytes)
    assert.equal(pack.format, MOCK_PACK_FORMAT)
    assert.equal(pack.version, MOCK_PACK_VERSION)
    assert.equal(pack.appVersion, '1.0.6')
    assert.equal(pack.rules.length, SCENE_TOTAL)
    assert.equal(pack.rules.reduce((sum, rule) => sum + rule.records.length, 0), RECORD_TOTAL)
    assert.ok(pack.rules.every(rule => rule.records.length > 0),
      '不留空场景：空场景「records 是空数组而不是缺字段」另有 pack-records.test.ts 钉')
  })

  it('条目级校验零失败——这份文件按定义就是「全绿可导入」', () => {
    const check = validateMockPackRecords(read.pack)
    assert.deepEqual(check.issues.map(it => `${it.code}:${it.field}@${it.ruleIndex}/${it.recordIndex}`), [])
    assert.equal(check.invalidCount, 0)
    assert.equal(check.valid.length, RECORD_TOTAL)
  })

  it('归一化后没有一条靠默认值补字段（notes 为空）', () => {
    assert.deepEqual(read.notes, [])
    assert.ok(read.prepared.every(it => it.defaulted.length === 0),
      '包里缺 id/name/时间戳才叫「补默认值」，这里出现就说明导出侧与包契约漂了')
    assert.equal(read.prepared.length, RECORD_TOTAL)
  })

  it('导入不劫持真实请求：每条都强制停用、来源印记是 import', () => {
    for (const { record } of read.prepared) {
      const match = record.match as MockMatchRule
      assert.equal(match.enabled, false, `「${record.name}」的启用位没被强制关掉`)
      assert.equal(match.derivation.source, 'import')
    }
  })

  it('指纹互不相同：同一个场景里自己撞自己的记录不该混进这份 fixture', () => {
    const digests = read.prepared.map(it => it.fingerprint)
    assert.equal(new Set(digests).size, RECORD_TOTAL)
    assert.ok(digests.every(it => typeof it === 'string' && it.length > 0))
  })

  it('脱敏真的落了包：明文凭证不存在，占位符存在', () => {
    assert.match(text, /\*\*\*/)
    for (const forbidden of ['Bearer eyJ', 'sid=abc123def456', 'eyJhbGciOiJIUzI1NiJ9.secret']) {
      assert.ok(!text.includes(forbidden), `fixture 里残留了真实形态的凭证片段 ${forbidden}`)
    }
  })

  it('覆盖矩阵：方法、路径档位、正文类型、状态码与变体都各有人踩过', () => {
    const records = everyRecord()
    const methods = new Set<string>()
    const pathTypes = new Set<MockMatchRule['pathType']>()
    const bodyTypes = new Set<ProxyMock.MockResponseDef['bodyType']>()
    const statusCodes = new Set<number>()
    for (const record of records) {
      methods.add(record.match?.method ?? '')
      pathTypes.add(record.match?.pathType ?? 'exact')
      bodyTypes.add(record.response.bodyType)
      statusCodes.add(record.response.statusCode)
    }
    assert.deepEqual([...methods].sort(), ['DELETE', 'GET', 'PATCH', 'POST', 'PUT'])
    assert.deepEqual([...pathTypes].sort(), ['exact', 'glob', 'prefix', 'regex'])
    assert.deepEqual([...bodyTypes].sort(), ['binary', 'json', 'text', 'xml'])
    assert.deepEqual([...statusCodes].sort((a, b) => a - b), [200, 201, 204, 404])
    assert.equal(pathTypes.size, 4, 'pathType 四档全覆盖，缺一档就说明这份 fixture 测不到那条分支')
    assert.equal(bodyTypes.size, 4, 'bodyType 四档全覆盖')
    assert.ok(records.some(it => it.response.delayMs === 1500), '慢响应档位')
    assert.ok(records.some(it => it.response.bodyEncoding === 'base64'), '二进制走 base64 编码')
    assert.ok(records.some(it => (it.variants?.length ?? 0) === 2
      && it.variants.some(variant => variant.id === it.activeVariantId)), '变体 + 可解析的 activeVariantId')
    assert.ok(records.some(it => it.match?.query.conditions.length === 2 && it.match?.query.allowExtra === false),
      'query 必配且不许多余参数')
    assert.ok(records.some(it => (it.match?.query.ignoreKeys.length ?? 0) === 2), '忽略键档位')
    assert.ok(records.some(it => (it.match?.headers.conditions.length ?? 0) === 1), '请求头条件')
    assert.ok(records.some(it => it.match?.priority === 20), '优先级')
    assert.ok(records.some(it => it.source?.headers?.authorization === '***'), '录制头里的凭证也脱敏')
    assert.ok(records.some(it => !!it.source?.url), '录制来源（含 url）')
  })

  it('时间戳钉在固定基准上：重导或手改都不该让整份文件无谓漂移', () => {
    const parsed = JSON.parse(text)
    assert.equal(parsed.exportedAt, T0 + 200 * MINUTE)
    const stamps: number[] = []
    for (const rule of parsed.rules) {
      for (const key of ['createdAt', 'updatedAt']) stamps.push(rule[key])
      for (const record of rule.records) {
        for (const key of ['createdAt', 'updatedAt']) stamps.push(record[key])
      }
    }
    assert.equal(stamps.length, SCENE_TOTAL * 2 + RECORD_TOTAL * 2)
    assert.ok(stamps.every(it => Number.isInteger(it) && it >= T0 && it <= T0 + 3 * 60 * MINUTE))
  })

  it('记录形状与包契约一一对应：没有 url / 指纹 / matchInvalid 这类派生值', () => {
    const keys = new Set(everyRecord().flatMap(it => Object.keys(it)))
    assert.deepEqual([...keys].sort(), [
      'activeVariantId', 'createdAt', 'id', 'match', 'name', 'response', 'source', 'updatedAt', 'variants',
    ])
    for (const forbidden of ['url', 'matchFingerprint', 'matchInvalid', 'ruleId']) {
      assert.ok(!keys.has(forbidden), `${forbidden} 是派生值，落包就等于给用户留下手改绕过查重的口子`)
    }
    assert.ok(everyRecord().every(it => typeof it.id === 'string' && it.id.startsWith('rec_')),
      '每条都带 id：合并模式的幂等重放靠它')
  })
})
