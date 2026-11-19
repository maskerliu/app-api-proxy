import { showNotify } from 'vant'
import { MOCK_PACK_FILE_ACCEPT, MOCK_PACK_MAX_FILE_BYTES, MockPackKind } from '@shared/mock.pack'
import { $t } from '../../lang'

/**
 * 选一个规则包或 HAR 文件，两种部署形态共用同一把通道：渲染层只交出 `File` 句柄，字节由浏览器
 * 分块读盘再 multipart 上传，主进程从不按「客户端给的路径」去开文件。
 * 改传路径看着省一次上传，实际是给本机服务开一个任意文件读的口子，而 Web 部署形态下同一个端点
 * 还要服务远端浏览器；Electron 里点 `<input type="file">` 弹的本来就是系统选择框，省不下体验。
 *
 * 返回 `null` 表示「什么都不必做」：用户取消，或文件大到传上去只会被传输层切断。后者在这里就把
 * 提示给出——multipart 硬上限只比 50MB 多 1MB 余量，越过它用户拿到的是断掉的请求，不是「超过 50MB」这句话。
 */
export function pickPackFile(kind: MockPackKind): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = MOCK_PACK_FILE_ACCEPT[kind]
    input.style.display = 'none'

    // 取消给的是 undefined 而不是 null：这个文件在 check:strict 的收口清单里，null 过不去
    const finish = (file?: File) => {
      input.remove()
      if (file == null) {
        resolve(null)
        return
      }
      if (file.size > MOCK_PACK_MAX_FILE_BYTES) {
        showNotify({ type: 'warning', message: $t('mock.pack.packTooLarge'), duration: 2000 })
        resolve(null)
        return
      }
      resolve(file)
    }

    // 每次重新造 input：复用同一个节点选同一个文件不会再次触发 change
    input.addEventListener('change', () => finish(input.files?.[0]))
    // 取消只能靠 cancel 事件（Chromium 107+）。不接它，Promise 会一直悬着，调用方的 loading 转不停
    input.addEventListener('cancel', () => finish(undefined))

    document.body.appendChild(input)
    input.click()
  })
}
