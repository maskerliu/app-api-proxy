import { importMockPack, previewMockPack } from '@shared'
import type { MockPackImportOptions, MockPackImportResult, MockPackPreviewResult } from '@shared/mock.pack'

/**
 * 导入弹窗的输入源（PRD v1.3 10 节：把「选文件」换成「取远端」，预览/结果两态、冲突三档、跳转与
 * 计数口径一概不动）。弹窗只认这三个成员，不知道背后是一个 File、一段远端字节还是一个 URL。
 *
 * 两个方法都收完整的导入选项：预览的数字随模式与目标场景变（quota、冲突数、建议名都是），
 * 远端侧同样得按这两种口径各读一次，不能在源里提前把数字算好。
 */
export interface MockImportSource {
  /** 文件行那一栏显示的名字：本地是文件名，远端是「哪几个场景」 */
  label: string
  preview(options: MockPackImportOptions): Promise<MockPackPreviewResult>
  import(options: MockPackImportOptions): Promise<MockPackImportResult>
}

/**
 * 本地文件：走 8884 那两个 multipart 端点，`silentError` 是弹窗既有的口径——
 * 包级失败就地在那一行下面说明，不弹 toast（用户要对着同一行改完再试一次）。
 */
export function fileImportSource(file: File): MockImportSource {
  return {
    label: file.name,
    // 那两个 formPost 的返回带 `| undefined`，讲的是「服务端答非所问、连回执都没有」这一种退化态；
    // 弹窗只有「拿到预览」与「失败」两态，这里照既有口径当作拿到，不替它另造一条文案
    preview: options => previewMockPack(file, options, { silentError: true }) as Promise<MockPackPreviewResult>,
    import: options => importMockPack(file, options, { silentError: true }) as Promise<MockPackImportResult>,
  }
}
