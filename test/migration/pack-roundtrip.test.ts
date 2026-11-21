import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { registerHooks } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { MOCK_PACK_FORMAT, MOCK_PACK_VERSION } from '@shared/mock.pack'
import { makeMatch } from '../unit/fixtures'

// R4C-31 的往返那半边：PRD 4.4.8 的 AC-R4-01 写的是「导出再导入到新机器，记录/变体/匹配规则/当前变体完全一致」，
// 而「一致」只有靠第二轮导出的包和第一轮逐字段对得上才证得出来——只看导入回执对得上，
// 可能只是「两边都按同一个错法读写」。
//
// 「新机器」在这一条里是**近似**：`MockRepo` 在 import 时就把 `MOCK_MIGRATION_USER_DATA` 读死了，
// 一个进程挂不了两个库，所以这里用「删掉源场景再以新建模式导入」当作干净库。
// 代价说清楚：这样库里的场景 ID 与名称都撞不上，于是这条用例覆盖不到 D4 的 ID 重生成与
// R4C-18 的名称避让——那两条各有 `pack-import-service.test.ts` / `pack-import-write.test.ts` 的用例钉着，
// 不是没人管，是不在这条断言里。
//
// Q3 把这条拆成两半（决策原文在任务拆分表头）：新建模式取包内原值、合并覆盖取库内原值，
// 所以时间戳有两个相反的期望，必须分成两条用例，不能合成一条「往返一致」糊过去。

const DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'mock-pack-roundtrip-'))
mkdirSync(path.join(DATA_DIR, 'biz_storage'), { recursive: true })
process.env.MOCK_MIGRATION_USER_DATA = DATA_DIR

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'electron') {
      return {
        url: 'data:text/javascript,export const app={getPath:()=>process.env.MOCK_MIGRATION_USER_DATA}',
        shortCircuit: true,
      }
    }
    return nextResolve(specifier, context)
  },
})

const { MockRepo } = await import('@main/repository/mock.repo')
const { assembleMockPack, importMockPack } = await import('@main/service/mock.pack.service')

const repo = new MockRepo() as any
await repo.init()

/** 时间戳全部给死：往返要断的就是「这两个数跟着包走了一圈没变」，用 `Date.now()` 就断不出来了 */
const T0 = Date.UTC(2026, 10, 15, 2, 30, 0)
const DAY = 86_400_000
/** 1x1 PNG 的 base64：二进制那档要证明 base64 文本在往返里没被当字符串改写过 */
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

function seed(id: string, name: string, match: any, response: any, extra: any = {}) {
  return {
    id, ruleId: '', name, url: '', match,
    response: { statusCode: 200, headers: {}, body: '', bodyType: 'text', delayMs: 0, ...response },
    variants: [], activeVariantId: null,
    createdAt: T0 + DAY, updatedAt: T0 + 2 * DAY,
    ...extra,
  }
}

/**
 * 三条覆盖三种最容易在往返里走丢的形状：变体与当前变体、base64 二进制正文 + 录制头、
 * query 必配（`allowExtra:false`）加请求头条件。每条的时间戳都不同，顺序因此也是可断的。
 */
function sourceSeeds() {
  return [
    seed('rec_variant', '订单详情-含两个变体',
      makeMatch({ method: 'GET', host: 'api.demo.com', path: '/v1/orders/detail', enabled: true }),
      {
        statusCode: 200, headers: { 'content-type': 'application/json;charset=utf-8' },
        body: '{"code":0,"data":{"orderNo":"SO20261115001","amount":199.00}}', bodyType: 'json', delayMs: 80,
      },
      {
        source: {
          method: 'GET', url: 'https://api.demo.com/v1/orders/detail?token=real-secret',
          statusCode: 200, headers: { authorization: 'Bearer real-token', 'x-device-id': 'PAD-0001' },
        },
        variants: [
          { id: 'var_ok', name: '正常', statusCode: 200, headers: {}, body: '{"code":0}', bodyType: 'json', delayMs: 0 },
          { id: 'var_401', name: '未授权', statusCode: 401, headers: {}, body: '{"code":401}', bodyType: 'json', delayMs: 0 },
        ],
        activeVariantId: 'var_401',
        createdAt: T0 + DAY, updatedAt: T0 + 7 * DAY,
      }),
    seed('rec_binary', '站点图标-二进制 base64',
      makeMatch({ method: 'GET', host: 'cdn.demo.com', path: '/assets/logo.png', enabled: true }),
      { statusCode: 200, headers: { 'content-type': 'image/png' }, body: PNG_BASE64, bodyType: 'binary', bodyEncoding: 'base64' },
      { createdAt: T0 + 2 * DAY, updatedAt: T0 + 4 * DAY }),
    seed('rec_query', '订单列表-query 必配且带请求头条件',
      makeMatch({
        method: 'POST', host: '', path: '/v1/orders', enabled: true,
        conditions: [{ key: 'page', op: 'equals', value: '2', ignoreCase: false }],
        allowExtra: false, headerConditions: [{ name: 'x-channel', op: 'equals', value: 'app', ignoreCase: false }],
      }),
      {
        statusCode: 200, headers: { 'content-type': 'application/xml' },
        body: '<?xml version="1.0"?><list total="2"/>', bodyType: 'xml',
      },
      { createdAt: T0 + 3 * DAY, updatedAt: T0 + 3 * DAY }),
  ]
}

async function newScene(name: string, records: any[]): Promise<string> {
  const ruleId = await repo.save({ name, desc: '' })
  await repo.importRecords(ruleId, records, { preserveTimestamps: true })
  return ruleId
}

async function readAll(ruleId: string): Promise<any[]> {
  const items: any[] = []
  await repo.iterateRecords(ruleId, (record: any) => { items.push(record) })
  return items
}

/**
 * 两轮包之间**设计内**的差只有这五处，其余字段一律要求逐字节相同：
 * `exportedAt` 是导出时刻；场景 ID 与场景时间戳由新建场景那一步现给（D4 只管记录级 ID，
 * 场景级时间戳压根不进 `importMockPackAsNewRules`）；记录 ID 重新分配；
 * `match.enabled` 被钉成 false（RK6）；`match.derivation` 整块换成导入那一份。
 * 后三条在下面各有一条独立断言——裁剪是为了让深比较聚焦，不是为了把回归一起裁掉。
 */
function comparable(text: string) {
  const pack = JSON.parse(text)
  assert.equal(pack.format, MOCK_PACK_FORMAT)
  assert.equal(pack.version, MOCK_PACK_VERSION)
  delete pack.exportedAt
  for (const rule of pack.rules) {
    delete rule.id
    delete rule.createdAt
    delete rule.updatedAt
    for (const record of rule.records) {
      delete record.id
      delete record.match.derivation
      record.match.enabled = false
    }
  }
  return pack
}

function recordsOf(text: string): any[] {
  return JSON.parse(text).rules[0].records
}

function stamps(records: any[]): Array<[string, number, number]> {
  return records.map(it => [it.name, it.createdAt, it.updatedAt])
}

describe('往返·新建模式：导出→导入→再导出逐字段一致（AC-R4-01 / Q3 前半）', () => {
  it('删掉源场景当作另一台机器，第二轮的包与第一轮只差那五处设计内差异', async () => {
    const ruleId = await newScene('往返源场景', sourceSeeds())
    const first = await assembleMockPack(repo, { scope: 'rule', ruleId } as any)
    assert.deepEqual([first.ruleCount, first.recordCount], [1, 3])

    await repo.delete(ruleId)
    const result = await importMockPack(repo, first.content, { mode: 'new' } as any)
    assert.deepEqual([result.created.length, result.updated.length, result.skipped.length, result.failed.length], [3, 0, 0, 0])
    assert.equal(result.ruleIds.length, 1)

    const second = await assembleMockPack(repo, { scope: 'rule', ruleId: result.ruleIds[0] } as any)
    assert.deepEqual(comparable(second.content), comparable(first.content),
      '导出→导入→再导出不是恒等：除五处设计内差异外，字段、顺序、嵌套结构都得相同')

    // 顺序也一致：库里三条按 createdAt 排，往返若把顺序打乱，深比较的数组顺序先红
    assert.deepEqual(recordsOf(second.content).map((it: any) => it.name),
      recordsOf(first.content).map((it: any) => it.name), '往返把记录顺序换了，界面列表跟着换')

    // 时间戳单拎出来断：这是 Q3 新建模式那一半的字面要求，不该埋在整包比较里
    assert.deepEqual(stamps(recordsOf(second.content)), stamps(recordsOf(first.content)),
      '新建模式取包内原值，写入时刻不参与（R4C-16）')
    assert.deepEqual(stamps(recordsOf(first.content)), [
      ['订单详情-含两个变体', T0 + DAY, T0 + 7 * DAY],
      ['站点图标-二进制 base64', T0 + 2 * DAY, T0 + 4 * DAY],
      ['订单列表-query 必配且带请求头条件', T0 + 3 * DAY, T0 + 3 * DAY],
    ], '第一轮导出的就该是库里那三个时刻：后面那句「包值保留」才有参照')
  })

  it('被裁掉的那几处差异各自钉住：ID 全换、一条都没启用、derivation 认账给导入', async () => {
    const ruleId = await newScene('往返源场景 B', sourceSeeds())
    const first = await assembleMockPack(repo, { scope: 'rule', ruleId } as any)
    await repo.delete(ruleId)
    const result = await importMockPack(repo, first.content, { mode: 'new' } as any)
    const second = await assembleMockPack(repo, { scope: 'rule', ruleId: result.ruleIds[0] } as any)

    const before = recordsOf(first.content)
    const after = recordsOf(second.content)
    assert.deepEqual([...new Set(after.map((it: any) => it.name))].sort(),
      [...new Set(before.map((it: any) => it.name))].sort())
    assert.ok(after.every((it: any) => typeof it.id === 'string' && it.id.startsWith('rec_')),
      '新建模式的记录 ID 由仓库重新分配，包内那份不带进库（D4）')
    assert.equal(after.filter((it: any) => before.some((x: any) => x.id === it.id)).length, 0,
      '一条 ID 都不该沿用')
    assert.ok(after.every((it: any) => it.match.enabled === false), '风险表 RK6：往返一圈不许把请求劫持回来')
    assert.ok(after.every((it: any) => it.match.derivation.source === 'import'),
      '派生信息认账给导入：包里写的 manual/har 不保留，其余派生字段照搬')
    assert.deepEqual(after.find((it: any) => it.name === '订单详情-含两个变体').match.derivation.autoIgnoredKeys, [],
      'autoIgnoredKeys 不是被顺手清掉的：这条本来就没有')
  })

  it('往返不带回凭证：默认脱敏的头值第二轮仍是 ***（AC-R4-02 的往返半边）', async () => {
    const ruleId = await newScene('往返源场景 C', sourceSeeds())
    const first = await assembleMockPack(repo, { scope: 'rule', ruleId } as any)
    assert.equal(JSON.parse(first.content).rules[0].records
      .find((it: any) => it.name === '订单详情-含两个变体').source.headers.authorization, '***')

    await repo.delete(ruleId)
    const result = await importMockPack(repo, first.content, { mode: 'new' } as any)
    const second = await assembleMockPack(repo, { scope: 'rule', ruleId: result.ruleIds[0] } as any)
    const back = recordsOf(second.content).find((it: any) => it.name === '订单详情-含两个变体')
    assert.equal(back.source.headers.authorization, '***',
      '库里存回真实凭证，再导出一次就把脱敏洗掉了')
    assert.equal(back.source.headers['x-device-id'], 'PAD-0001', '非敏感录制头不该被一起抹掉')
    assert.equal(back.source.url, 'https://api.demo.com/v1/orders/detail?token=real-secret',
      'URL 原样留着：脱敏只管头，`includeSource` 那条另有开关（AC-R4-14 的 `-raw` 档）')
  })
})

describe('往返·合并覆盖模式：内容换掉，时间戳与位置保持库内原值（AC-R4-12 / Q3 后半）', () => {
  /** 库里那条：与包里同指纹（同 method/host/path），但内容旧、名字旧、时刻是库里自己的 */
  function dbSeed() {
    return seed('rec_db', '库里那条-旧名字',
      makeMatch({ method: 'GET', host: 'api.demo.com', path: '/v1/orders/detail', enabled: true }),
      { statusCode: 200, headers: {}, body: '旧文本', bodyType: 'text', delayMs: 0 },
      { createdAt: T0 + 2 * DAY, updatedAt: T0 + 30 * DAY })
  }

  /** 包里那条：内容新、名字新、时刻是另一套；三条同场景的库导出而来 */
  function packSeed() {
    return seed('rec_pack', '包里那条-新名字',
      makeMatch({ method: 'GET', host: 'api.demo.com', path: '/v1/orders/detail', enabled: true }),
      {
        statusCode: 201, headers: { 'content-type': 'application/json;charset=utf-8' },
        body: '{"code":0,"revised":true}', bodyType: 'json', delayMs: 150,
      },
      { createdAt: T0 + 9 * DAY, updatedAt: T0 + 9 * DAY })
  }

  it('覆盖命中库里那条文档：内容替换、两个时刻都不动、列表位置不动', async () => {
    const sourceId = await newScene('覆盖来源', [packSeed()])
    // 库里三条，被覆盖的那条在中间：只看内容对不对，位置就没人管了
    const targetId = await newScene('覆盖目标', [
      seed('rec_before', '排在前面那条',
        makeMatch({ method: 'GET', host: 'api.demo.com', path: '/v1/before', enabled: true }),
        { body: 'before', bodyType: 'text' },
        { createdAt: T0 + DAY, updatedAt: T0 + DAY }),
      dbSeed(),
      seed('rec_after', '排在后面那条',
        makeMatch({ method: 'GET', host: 'api.demo.com', path: '/v1/after', enabled: true }),
        { body: 'after', bodyType: 'text' },
        { createdAt: T0 + 3 * DAY, updatedAt: T0 + 3 * DAY }),
    ])

    const pack = await assembleMockPack(repo, { scope: 'rule', ruleId: sourceId } as any)
    const before = await readAll(targetId)
    const dbId = before.find((it: any) => it.name === '库里那条-旧名字').id

    const result = await importMockPack(repo, pack.content,
      { mode: 'merge', targetRuleId: targetId, conflict: 'overwrite' } as any)
    assert.deepEqual([result.created.length, result.updated.length, result.skipped.length], [0, 1, 0],
      '覆盖是同一条文档改写，不是又塞一份进来')
    assert.deepEqual(result.updated, [dbId], '改的是库里那条的 ID：包内那个 rec_pack 指不回任何东西')

    const after = await readAll(targetId)
    assert.deepEqual(after.map((it: any) => it.id), before.map((it: any) => it.id),
      '「排序位置保持不变」：库里根本没有位置这一列，界面按 createdAt 排，读路顺序不动就是位置不动')
    const revised = after.find((it: any) => it.id === dbId)
    assert.equal(revised.name, '包里那条-新名字', '记录内容（含名称）整条替换')
    assert.deepEqual([revised.response.statusCode, revised.response.body, revised.response.delayMs], [201, '{"code":0,"revised":true}', 150])
    assert.deepEqual([revised.createdAt, revised.updatedAt], [T0 + 2 * DAY, T0 + 30 * DAY],
      'Q3：覆盖取库内原值，包内那两个时刻不参与')
    assert.notEqual(revised.updatedAt, T0 + 9 * DAY, '包值与库值必须真的是两个数，否则上一条断言是空的')

    // 再导出一次：包里那条的时刻仍是库内的原值（这条是「覆盖导入的包可以安心传下去」的依据）
    const reExported = await assembleMockPack(repo, { scope: 'rule', ruleId: targetId } as any)
    const row = recordsOf(reExported.content).find((it: any) => it.name === '包里那条-新名字')
    assert.deepEqual([row.createdAt, row.updatedAt], [T0 + 2 * DAY, T0 + 30 * DAY],
      '导出读的是库值而不是包值：否则第二轮覆盖会拿上一轮的包值继续盖')
  })

  it('覆盖顺带把已启用那条打回未启用：AC 没写这一格，实现确实这么做（待裁决，见任务拆分）', async () => {
    const sourceId = await newScene('覆盖来源 D', [packSeed()])
    const targetId = await newScene('覆盖目标 D', [dbSeed()])
    const pack = await assembleMockPack(repo, { scope: 'rule', ruleId: sourceId } as any)

    assert.equal((await readAll(targetId))[0].match.enabled, true, '库里那条本来是启用的')
    const result = await importMockPack(repo, pack.content,
      { mode: 'merge', targetRuleId: targetId, conflict: 'overwrite' } as any)
    assert.equal(result.updated.length, 1)

    const revised = (await readAll(targetId))[0]
    assert.equal(revised.match.enabled, false,
      'RK6 那条禁令不分新建/覆盖：写进去的 match 就是归一化后的那一份')
    assert.equal(result.enabled, false, '结果页说的「未启用」因此是真的')
  })
})
