import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { describe, it } from 'node:test'

// R4C-19 的单例与进度那一半：这里验的是「谁持有 AbortController、槽位什么时候交还、进度从哪份状态出」，
// 与库无关，所以用一个会停在写库那一步等命令的假写源。真库上的取消与回滚效果见 test/migration/pack-import-cancel.test.ts。

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'electron') {
      return {
        url: 'data:text/javascript,export const app={getPath:()=>process.env.TMPDIR||"/tmp",getVersion:()=>"0.0.0"};export const BrowserWindow={getFocusedWindow:()=>undefined}',
        shortCircuit: true,
      }
    }
    if (specifier === 'vant') {
      return { url: 'data:text/javascript,export const showNotify=()=>{}', shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})

const { MockPackService } = await import('@main/service/mock.pack.service')
const { MockError } = await import('@shared/mock.errors')
const { MOCK_PACK_FORMAT, MOCK_PACK_VERSION } = await import('@shared/mock.pack')
const { makeMatch } = await import('./fixtures')

const ok = { statusCode: 200, headers: {}, body: '{"ok":true}', bodyType: 'json', delayMs: 0 }

function packText(count = 2) {
  return JSON.stringify({
    format: MOCK_PACK_FORMAT, version: MOCK_PACK_VERSION,
    rules: [{
      id: 'rule_1', name: '单例', desc: '',
      records: Array.from({ length: count }, (_, i) => ({
        id: null, name: `记录 ${i}`, match: makeMatch({ path: `/v1/singleton/${i}`, enabled: false }),
        response: { ...ok, body: `{"i":${i}}` }, variants: [], activeVariantId: null
      }))
    }]
  })
}

interface Gate { promise: Promise<void>, resolve: () => void }
function gate(): Gate {
  let resolve!: () => void
  const promise = new Promise<void>(r => { resolve = r })
  return { promise, resolve }
}

/** 编排链上要过好几个 await 才走到写库那一步，用例等「第 n 次写出现在假源里」这件事，不等自己数 ticks */
async function waitFor(predicate: () => boolean, label: string) {
  for (let round = 0; round < 2000; round++) {
    if (predicate()) return
    await new Promise<void>(resolve => setImmediate(resolve))
  }
  throw new Error(`等不到：${label}`)
}

/**
 * 停在写库那一步等命令的假写源：`before` 放行才决定「写」还是「因取消不写」，
 * `after` 放行才算落完——两个闸门合起来能把「取消落在批与批之间」这个位置摆进断言。
 */
function newFakeSource() {
  const state = {
    writes: [] as Array<{ ruleId: string; count: number; signal?: AbortSignal }>,
    gates: [] as Array<{ before: Gate, after: Gate }>,
    deleted: [] as string[],
    ruleSeq: 0
  }
  const source: any = {
    listRules: async () => [],
    getRule: async (ruleId: string) => ({ _id: ruleId, name: '目标', desc: '' }),
    countRecords: async () => 0,
    iterateRecords: async () => {},
    listRecordSummaries: async () => [],
    save: async () => `rule_${++state.ruleSeq}`,
    delete: async (ruleId: string) => { state.deleted.push(ruleId); return true },
    importRecords: async (ruleId: string, records: any[], options: any) => {
      const pair = { before: gate(), after: gate() }
      state.gates.push(pair)
      state.writes.push({ ruleId, count: records.length, signal: options?.signal })
      await pair.before.promise
      if (options?.signal?.aborted === true) {
        return {
          outcomes: records.map((_: any, index: number) => ({
            index, status: 'failed', id: null, reason: 'packWriteAborted'
          })),
          created: [], updated: [], aborted: true
        }
      }
      options?.onBatch?.(1, 1)
      await pair.after.promise
      const created = records.map((_: any, index: number) => `rec_${ruleId}_${index}`)
      return {
        outcomes: created.map((id: string, index: number) => ({ index, status: 'created', id })),
        created, updated: [], aborted: false
      }
    }
  }
  return { source, state }
}

function newService() {
  const { source, state } = newFakeSource()
  const service = new MockPackService()
  ;(service as any).mockRepo = source
  return { service, state }
}

/** 放行第 n 次写并等它跑完，用例不必自己数闸门 */
async function letWriteFinish(state: ReturnType<typeof newFakeSource>['state'], which = 0) {
  await waitFor(() => state.gates.length > which, `第 ${which + 1} 次写库`)
  state.gates[which].before.resolve()
  state.gates[which].after.resolve()
}

describe('导入单例（R4C-19：并发导入互相写同一个库）', () => {
  it('第一个没结束 → 第二个立刻拿 packImportInProgress，不排队也不并行', async () => {
    const { service, state } = newService()
    const first = service.import(packText(), { mode: 'new' })
    // 槽位在第一个 await 之前就占住了，所以这里不用等它进写库那一步
    await assert.rejects(() => service.import(packText(), { mode: 'new' }),
      (err: any) => err instanceof MockError && err.code === 'packImportInProgress',
      '重复请求要报错，不能像更新那条一样静默忽略：弹窗挂在「等一个不存在的取消按钮」上比报错难交代')
    assert.equal(state.writes.length, 1, '被拒的那次不许碰库')

    await letWriteFinish(state)
    assert.equal((await first).created.length, 2)

    const second = service.import(packText(1), { mode: 'new' })
    await waitFor(() => state.writes.length === 2, '第二次写库')
    await assert.rejects(() => service.import(packText(), { mode: 'new' }),
      (err: any) => err.code === 'packImportInProgress', '结束即交还槽位，但跑起来的这一次该重新挡住并发')
    await letWriteFinish(state, 1)
    assert.equal((await second).created.length, 1)
  })

  it('抛错同样交还槽位：包级闸门没过不算占着不放', async () => {
    const { service, state } = newService()
    await assert.rejects(() => service.import('{ oops', { mode: 'new' }),
      (err: any) => err.code === 'packFormatUnknown')

    const next = service.import(packText(1), { mode: 'new' })
    await assert.rejects(() => service.import(packText(), { mode: 'new' }),
      (err: any) => err.code === 'packImportInProgress', '坏包那次没占住，这一次是真在跑')
    await letWriteFinish(state)
    assert.equal((await next).created.length, 1)
  })

  it('cancelImport 只在有任务时为真，信号递到写库收到的那个 signal 上', async () => {
    const { service, state } = newService()
    assert.equal(service.cancelImport(), false, '没有任务时不许假装取消成功')

    const running = service.import(packText(), { mode: 'new' })
    await waitFor(() => state.writes.length === 1, '写库收到 signal')
    assert.equal(service.cancelImport(), true)
    assert.equal(state.writes[0].signal?.aborted, true)

    state.gates[0].before.resolve()
    const result = await running
    assert.equal(result.aborted, true)
    assert.deepEqual([result.created.length, result.failed.length], [0, 2])
    assert.deepEqual(state.deleted, ['rule_1'], '零写入的新建场景要回收掉')
    assert.equal(service.cancelImport(), false, '取消完这次，槽位是空的')
  })
})

describe('进度读数（按批次，不按字节）', () => {
  it('没在跑 → running:false；跑起来 → 当前场景的批次号；跑完 → 归零', async () => {
    const { service, state } = newService()
    assert.deepEqual(service.getImportProgress(), { running: false, written: 0, total: 0 })

    const running = service.import(packText(), { mode: 'new' })
    await waitFor(() => state.writes.length === 1, '写库开始')
    assert.deepEqual(service.getImportProgress(), { running: true, written: 0, total: 0 },
      '一批都没写完时读数停在 0，不许拿批数当进度')

    state.gates[0].before.resolve()
    await waitFor(() => service.getImportProgress().written === 1, '第一批的读数')
    assert.deepEqual(service.getImportProgress(), { running: true, written: 1, total: 1 },
      'onBatch 的读数要读得到，形式就是分子/分母那一对')

    state.gates[0].after.resolve()
    await running
    assert.deepEqual(service.getImportProgress(), { running: false, written: 0, total: 0 })
  })
})
