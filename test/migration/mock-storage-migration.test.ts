import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { registerHooks } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import PouchDB from 'pouchdb-node'
import { Container } from 'inversify'

// 真实落库的迁移回归：仓库层、迁移 runner 与 IoC 装配一起启动，
// 守住批 5 拆分的两条底线——schema v4 幂等、迁移前整库备份。

const DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'mock-migration-'))
mkdirSync(path.join(DATA_DIR, 'biz_storage'), { recursive: true })
process.env.MOCK_MIGRATION_USER_DATA = DATA_DIR

// 服务模块会经 constants.ts 引用 electron，测试环境用最小 app 替身把 userData 指到临时目录
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

const { IOC_TYPES } = await import('@main/constants')
const { MockRepo } = await import('@main/repository/mock.repo')
const { MockMigrationRunner } = await import('@main/service/mock.migration.runner')
const { MIGRATION_REPORT_ID, RECORD_TYPE, SCHEMA_VERSION } = await import('@main/repository/mock.docs')

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = path.resolve(HERE, '../fixtures/mock-v3/records.json')
const RULE_DB = path.join(DATA_DIR, 'biz_storage', 'Mock.Rules')
const BACKUP_DB = `${RULE_DB}.v${SCHEMA_VERSION}.bak`

const fixtureDocs = (): any[] => JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')).docs
const SEEDED = fixtureDocs().map(({ _rev, ...doc }: any) => doc)

/** 一次应用启动：容器装配 + repo.init()（建索引）+ runner.run()（备份并迁移） */
async function startApp() {
  const container = new Container({ defaultScope: 'Singleton' })
  container.bind(IOC_TYPES.MockRepo).to(MockRepo)
  container.bind(IOC_TYPES.MockMigration).to(MockMigrationRunner)
  const repo = container.get(IOC_TYPES.MockRepo) as any
  const runner = container.get(IOC_TYPES.MockMigration) as any
  await repo.init()
  await runner.run()
  return { repo, runner }
}

async function recordDocs(fetch: (options: any) => Promise<any>): Promise<any[]> {
  const page = await fetch({ include_docs: true })
  return page.rows.map((row: any) => row.doc).filter((doc: any) => doc?.type === RECORD_TYPE)
}

// 先落入 v3 记录库，再启动应用，等价于旧版本数据库上的首次升级
const raw = new PouchDB(RULE_DB)
await raw.bulkDocs(SEEDED)
await raw.close()

const { repo, runner } = await startApp()

describe('Mock 存储升级迁移（真实 PouchDB）', () => {
  it('启动后 meta 升到 v4，闸门解除', async () => {
    const meta = await repo.getMeta()
    assert.equal(meta.version, SCHEMA_VERSION)
    assert.equal(meta.mockSchemaVersion, 1)
    assert.equal(meta.migrationStatus, 'completed')
    assert.equal(meta.migrationPending, false)
    assert.equal(repo.isMigrationPending(), false)
  })

  it('记录补齐 match 与指纹，异常与重复项按原因停用', async () => {
    const docs = new Map((await recordDocs(options => repo.readDocs(options))).map(doc => [doc._id, doc]))
    assert.equal(docs.size, SEEDED.length)

    for (const [id, doc] of docs) {
      if (id === 'rec_broken') {
        assert.equal(doc.matchInvalid, 'urlInvalid', `${id} 应标记 URL 无法解析`)
        assert.equal(doc.match, undefined, `${id} 不应写入无效条件`)
        continue
      }
      assert.ok(doc.match != null, `${id} 缺少 match`)
      assert.ok(typeof doc.matchFingerprint === 'string' && doc.matchFingerprint.length > 0,
        `${id} 缺少指纹`)
    }

    for (const id of ['rec_ping_old', 'rec_a1', 'rec_user_10086']) {
      assert.equal(docs.get(id).matchInvalid, 'duplicateAfterMigration', `${id} 重复项未停用`)
      assert.equal(docs.get(id).match.enabled, false, `${id} 重复项仍参与匹配`)
    }
  })

  it('迁移只改匹配字段，响应、变体与兼容记录原样保留', async () => {
    const docs = new Map((await recordDocs(options => repo.readDocs(options))).map(doc => [doc._id, doc]))
    for (const origin of SEEDED) {
      const doc = docs.get(origin._id)
      assert.deepEqual(doc.response, origin.response, `${origin._id} 响应被改写`)
      assert.deepEqual(doc.variants, origin.variants ?? [], `${origin._id} 变体被改写`)
      assert.equal(doc.name, origin.name ?? '', `${origin._id} 名称被改写`)
      assert.equal(doc.ruleId, origin.ruleId, `${origin._id} 归属规则被改写`)
      assert.equal(doc.createdAt, origin.createdAt, `${origin._id} 创建时间被改写`)
      if (origin.record != null) {
        assert.deepEqual(doc.record, origin.record, `${origin._id} 兼容字段被改写`)
      }
    }
  })

  it('迁移前整库备份落到 .v4.bak，备份内仍是无 match 的原始记录', async () => {
    assert.ok(existsSync(BACKUP_DB), `缺少备份目录 ${BACKUP_DB}`)
    const backup = new PouchDB(BACKUP_DB)
    const docs = await recordDocs(options => backup.allDocs(options))
    await backup.close()

    assert.equal(docs.length, SEEDED.length)
    for (const doc of docs) {
      assert.equal(doc.match, undefined, `${doc._id} 备份不应含迁移结果`)
      assert.equal(doc.matchFingerprint, undefined, `${doc._id} 备份不应含指纹`)
    }
  })

  it('迁移报告落库，逐条记录可复核且无写入错误', async () => {
    const report = await runner.getMigrationReport()
    assert.equal(report.status, 'completed')
    assert.equal(report.totalRecords, SEEDED.length)
    assert.equal(report.processedRecords, SEEDED.length)
    // 重复项停用会额外追加一条复核条目，因此只断言每条记录都能查到
    const itemIds = new Set(report.items.map((it: any) => it.recordId))
    for (const doc of SEEDED) {
      assert.ok(itemIds.has(doc._id), `${doc._id} 报告缺条目`)
    }
    assert.deepEqual(report.errors, [])
    assert.ok((await repo.getDoc(MIGRATION_REPORT_ID)) != null, '报告文档未落库')
  })

  it('再次启动不重写任何记录文档，也不重复备份（幂等）', async () => {
    const revisionOf = async () =>
      (await recordDocs(options => repo.readDocs(options))).map(doc => `${doc._id}#${doc._rev}`).sort()
    const before = await revisionOf()

    await startApp()

    assert.deepEqual(await revisionOf(), before, '二次启动改写了记录文档')
    const meta = await repo.getMeta()
    assert.equal(meta.version, SCHEMA_VERSION)
    assert.equal(meta.backupVersion, SCHEMA_VERSION, '二次启动重复备份')
  })

  after(async () => {
    // Windows 下 leveldb 句柄未释放会 EBUSY：先关当前库，仍删不掉就交给系统临时目录回收
    try {
      await repo.pouchdb.close()
    } catch (err) { }
    try {
      rmSync(DATA_DIR, { recursive: true, force: true })
    } catch (err) { }
  })
})
