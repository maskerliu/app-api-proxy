import { inject, injectable } from 'inversify'
import 'reflect-metadata'
import type { MockPackImportOptions, MockPackImportResult, MockPackPreviewOptions, MockPackPreviewResult } from '@shared/mock.pack'
import type {
  MockShareBackupEstimate, MockShareBackupProgress, MockShareBackupResult, MockShareCheckResult,
  MockShareConfig, MockShareRemoteOverview,
} from '@shared/mock.share'
import { IOC_TYPES } from '../constants'
import { cancelShareBackup, estimateShareBackup, readShareRemoteOverview, readShareUrlPack, requireShareDirectoryChannel, requireShareUrl, restoreShareScenes, runShareBackup, shareBackupProgress } from './mock.share'
import { CommonService } from './common.service'
import type { MockPackWriteSource } from './mock.pack.service'
import { MockPackService } from './mock.pack.service'

/**
 * 云共享的装配层（PRD C1–C4 / S-A6）：把「配置 → 通道 → 执行器 → 结果」串起来，本身没有逻辑。
 *
 * 唯一算得上决定的地方是恢复落库走 `MockPackService`：那一层的 `withImportTask` 就是 11.1
 * 「与导入互斥」的落点，绕过去自己调 `importMockPack` 等于把云恢复放到那把锁的外面。
 */
@injectable()
export class MockShareService {

  @inject(IOC_TYPES.MockRepo)
  private mockRepo: MockPackWriteSource
  @inject(IOC_TYPES.CommonService)
  private commonService: CommonService
  @inject(IOC_TYPES.MockPackService)
  private mockPackService: MockPackService

  /** 缺省即关闭：配置文件里没这一段时不新建通道，也就不产生任何对外请求（C6） */
  private config(): MockShareConfig {
    return this.commonService.serverConfig.mockShare ?? { channel: 'off' }
  }

  async check(): Promise<MockShareCheckResult> {
    const config = this.config()
    if (config.channel === 'url') {
      // 订阅那边没有清单可探，能说的只有「这个地址答了，认得出是包正文，这么大」。
      // 代价是把整个包取回来一次——与「读取并预览」同量，本期不为此另造一套只探不回的形状（已登记）。
      const payload = await readShareUrlPack(requireShareUrl(config))
      return { channel: 'url', bytes: payload.bytes }
    }
    const overview = await this.overview()
    const result: MockShareCheckResult = {
      channel: 'dir',
      bytes: overview.bytes,
      scenes: overview.scenes.length,
      records: overview.records,
    }
    if (overview.createdAt != null) result.createdAt = overview.createdAt
    if (overview.device != null) result.device = overview.device
    return result
  }

  /** 备份与恢复都只经这一句拿通道：关闭 / 没填目录 / 拿只读订阅去备份，在碰到 fs 之前就被抛回 */
  private directoryChannel() {
    return requireShareDirectoryChannel(this.config())
  }

  async estimate(): Promise<MockShareBackupEstimate> {
    return estimateShareBackup(this.mockRepo, this.directoryChannel())
  }

  async backup(onProgress?: (progress: MockShareBackupProgress) => void): Promise<MockShareBackupResult> {
    return runShareBackup(this.mockRepo, this.directoryChannel(), onProgress)
  }

  cancel(): boolean {
    return cancelShareBackup()
  }

  /** 进度读数：渲染层重新挂载时用它接回一个正在跑的任务，不必等下一次推送 */
  progress(): MockShareBackupProgress | null {
    return shareBackupProgress()
  }

  async overview(): Promise<MockShareRemoteOverview> {
    return readShareRemoteOverview(this.directoryChannel())
  }

  /**
   * 恢复的正文：订阅通道没有场景可勾，一次取回一个包；目录通道按勾选的 key 在读侧合并成一个包（C3-6）。
   * 文本在这里只在主进程手里过一遍，交给渲染层的是预览结果或导入结果——和导出反方向的同一条理由。
   */
  private async packText(keys: string[]): Promise<string> {
    const config = this.config()
    if (config.channel === 'url') return (await readShareUrlPack(requireShareUrl(config))).text
    return (await restoreShareScenes(this.directoryChannel(), keys)).text
  }

  /** 预览不落库（C3-1 / C4-5）：闸门与计数口径全沿用 R4，这里不解释包内容 */
  async preview(keys: string[], options: MockPackPreviewOptions): Promise<MockPackPreviewResult> {
    return this.mockPackService.preview(await this.packText(keys), options)
  }

  async import(keys: string[], options: MockPackImportOptions): Promise<MockPackImportResult> {
    return this.mockPackService.import(await this.packText(keys), options)
  }
}
