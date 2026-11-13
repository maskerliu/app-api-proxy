import { defineStore } from 'pinia'
import { ConfigProviderTheme, ConfigProviderThemeVars, showNotify } from 'vant'
import type { LocalServerConfig } from '@shared/base.models'
import type { MockStatusBroadcast } from '@shared/mock.models'
import { ProxyMock, getServerConfig, updateBaseDomain, updateClientUID, updateUpdateServer } from '@shared'
import { API_URL } from '@shared/api.const'
import { PushClient } from '../common/PushClient'
import { $t } from '../../lang'

export { ProxyRecordStore } from './ProxyRecords'

let pushClient: PushClient = null

const GRAYS = ['#333333', '#646566', '#969799', '#c8c9cc', '#dcdee0', '#ebedf0', '#f2f3f5', '#f5f6f8']

// Vant 组件的行高、控件高度与内边距默认是写死的 px/rem，不随全局字号变化；而全站业务尺寸都按
// calc(var(--van-font-size-md) * N) 缩放，字号调到 10（md=14px）时缩放的内容就长进这些恒定盒子里，表现为拥挤与裁切。
// 因此凡属「结构尺寸」的一律写成 calc(var(--van-font-size-md) * K)：K 按项目约定保留 1 位小数，取值以默认字号 9
// （md=13px）为锚点，即 13*K ≈ 原像素值，于是字号 9 的观感不变，只有小字号收紧、大字号放宽。
// ConfigProvider 以 theme-vars-scope="global" 把这些值原样写到 :root，calc 引用的 --van-font-size-md 在同一元素上，
// 使用时才求值，因此不需要随字号重算；Proxy 顶部类型筛选组的 --van-checkbox-size: 16px 是本地覆盖，不受影响。
// 圆角、边框不在此列：装饰性常量，且牵动既有的卡片对齐与弹窗固定高度约定。
// dialogButtonHeight 是例外：弹窗按钮区改成右对齐描边按钮后，它必须落在行内控件那一档，
// 否则同一屏里弹窗按钮和表单按钮两种高度；40px 是移动端拇指区。
// cellGroupInsetPadding 单独处理：它刻意保持恒定 5px（卡片外缘要与面板沟道严格对齐），
// 但与面板侧的 margin: 5px / calc(100% - var(--app-card-gutter) * 2) 是同一个数，所以让 Vant 这侧也读全局 token，
// 避免出现两处各自写死的 5px。
const BASE_THEME_VARS: ConfigProviderThemeVars = {
  dialogButtonHeight: 'var(--app-control-height)',
  floatingBubbleSize: '2.5rem',
  // 客户端卡片内边距
  gridItemContentPadding: 'calc(var(--van-font-size-md) * 0.6)',
  popoverRadius: 'var(--van-radius-sm)',
  // 开关/单选/复选的图标热区，同时决定 label 的行高
  switchSize: 'calc(var(--van-font-size-md) * 1.5)',
  radioSize: 'calc(var(--van-font-size-md) * 1.2)',
  checkboxSize: 'calc(var(--van-font-size-md) * 1.2)',
  cellGroupInsetPadding: 'var(--app-card-gutter, 5px)',
  cellGroupInsetTitlePadding: '5px 20px',
  collapseItemContentPadding: '0px',
  tagPadding: '2px 5px',
  tagRadius: '5px',
  tagLineHeight: 'calc(var(--van-font-size-md) * 1.2)',
  cellLineHeight: 'calc(var(--van-font-size-md) * 1.9)',
  cellLabelLineHeight: 'calc(var(--van-font-size-md) * 1.3)',
  cellVerticalPadding: 'calc(var(--van-font-size-md) * 0.6)',
  cellHorizontalPadding: 'calc(var(--van-font-size-md) * 1.2)',
  buttonMiniHeight: 'calc(var(--van-font-size-md) * 1.8)',
  buttonSmallHeight: 'calc(var(--van-font-size-md) * 2.5)',
  searchInputHeight: 'calc(var(--van-font-size-md) * 2.6)',
  popupRoundRadius: '8px',
  popupCloseIconMargin: '23px',
  borderWidth: '1.4px',
  radiusMd: '8px',
  dialogRadius: '8px',
  floatingBubbleBackground: '#f04b1e',
  // 导航条高度对齐全站控件基准 md*2.2；标签文字行高按它自己的字号（设置值 + 5）
  tabsLineHeight: 'calc(var(--van-font-size-md) * 2.2)',
  tabLineHeight: 'calc(var(--van-tab-font-size) * 1.4)',
}

const FONT_SIZE_MIN = 7
const FONT_SIZE_MAX = 10
const FONT_SIZE_DEFAULT = 9
// 正文字号在设置值基础上的偏移，AceEditor 等需要显式 px 的地方复用该值
const FONT_SIZE_MD_OFFSET = 4

export { FONT_SIZE_MIN, FONT_SIZE_MAX, FONT_SIZE_MD_OFFSET }

interface MockStatusState {
  ruleId: string
  ruleName: string
  enabled: boolean
}

export const CommonStore = defineStore('Common', {
  state: () => {
    return {
      inited: false,
      uid: '',
      theme: 'light' as ConfigProviderTheme,
      themeVars: { ...BASE_THEME_VARS },
      fontSize: FONT_SIZE_DEFAULT,
      lang: 'zh-CN',
      showDebugPanel: false,
      showQrCode: false,
      registerUrl: '',
      clientInfos: [] as Array<ProxyMock.ClientInfo>,
      serverConfig: {} as LocalServerConfig,
      onboarded: false,
      // 多窗口同步的全局 Mock 开关状态
      mockStatus: { ruleId: '', ruleName: '', enabled: false } as MockStatusState
    }
  },
  actions: {
    async init(config?: LocalServerConfig) {
      this.inited = false

      const wrapTheme = window.localStorage.getItem('theme')
      this.theme = wrapTheme != null ? wrapTheme as ConfigProviderTheme : 'light'
      this.updateTheme()

      const wrapLang = window.localStorage.getItem('lang')
      this.lang = wrapLang != null ? wrapLang : 'zh-CN'

      this.fontSize = this.normalizeFontSize(window.localStorage.getItem('fontSize'))
      this.updateFontSize()

      pushClient = new PushClient()

      if (config) {
        updateBaseDomain(`${config.protocol}://${config.ip}:${config.port}`)
      } else if (__DEV__) {
        updateBaseDomain(SERVER_BASE_URL)
      }

      try {
        this.serverConfig = config ? config : await getServerConfig()
        // 网页端没有本地配置文件，用 localStorage 记住接入状态
        this.onboarded = this.serverConfig.onboarded === true
          || (window.isWeb && window.localStorage.getItem('onboarded') === '1')
        this.updateServerConfig()
      } catch (err) {
        showNotify(err)
      }

      this.inited = true
    },
    updateTheme() {
      window.localStorage.setItem('theme', this.theme)
      window.mainApi?.setAppTheme(this.theme)

      const isDark = this.theme == 'dark'
      const grays = {}
      for (let i = 0; i < GRAYS.length; i++) {
        grays[`gray${i + 1}`] = isDark ? GRAYS[i] : GRAYS[7 - i]
      }
      this.themeVars = Object.assign({}, this.themeVars, grays)
    },
    normalizeFontSize(value: string | number): number {
      const size = typeof value == 'number' ? value : parseInt(value ?? '')
      return Number.isFinite(size) ? Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, size)) : FONT_SIZE_DEFAULT
    },
    updateFontSize() {
      this.fontSize = this.normalizeFontSize(this.fontSize)
      window.localStorage.setItem('fontSize', `${this.fontSize}`)
      this.themeVars = Object.assign({}, this.themeVars, {
        fontSizeXs: `${this.fontSize}px`,
        fontSizeSm: `${this.fontSize + 2}px`,
        fontSizeMd: `${this.fontSize + FONT_SIZE_MD_OFFSET}px`,
        fontSizeLg: `${this.fontSize + 6}px`,
        tagFontSize: `${this.fontSize}px`,
        tabFontSize: `${this.fontSize + 5}px`,
      })
    },
    updateLang(lang: string) {
      this.lang = lang
      window.localStorage.setItem('lang', lang)
    },
    updateShowQrCode(show: boolean) {
      this.showQrCode = show
    },
    sendMessage(params: ProxyMock.PushMsg<any>) {
      pushClient.send(params)
    },
    updateServerConfig(config?: LocalServerConfig) {
      this.serverConfig = config ? config : this.serverConfig
      updateUpdateServer(this.serverConfig.updateServer)
      const ip = this.serverConfig.ip || '127.0.0.1'
      if (this.serverConfig.protocol && this.serverConfig.port != null) {
        updateBaseDomain(`${this.serverConfig.protocol}://${ip}:${this.serverConfig.port}`)
      }
      updateClientUID(this.uid)
      this.buildRegisterUrl()

      if (window.isWeb) {
        pushClient.start(`${this.serverConfig.protocol}://${ip}:${this.serverConfig.port}`)
      } else {
        pushClient.start(`${this.serverConfig.protocol}://localhost:${this.serverConfig.port}`)
      }
    },
    // 注册成功后使用服务端分配的 uid，旧 uid 不再复用
    applyUid(uid: string) {
      if (uid == null || uid.length === 0) return
      this.uid = uid
      updateClientUID(uid)
      this.buildRegisterUrl()
    },
    buildRegisterUrl() {
      const { protocol, ip, port } = this.serverConfig ?? {} as LocalServerConfig
      if (!this.uid || !protocol || port == null) {
        this.registerUrl = ''
        return
      }
      this.registerUrl = `${protocol}://${ip || '127.0.0.1'}:${port}${API_URL.MockRegister}/${this.uid}`
    },
    updateClientInfos(clientInfos: Array<ProxyMock.ClientInfo>) {
      this.clientInfos = [...clientInfos]
    },
    // 其他窗口切换 Mock 后同步本地展示状态
    updateMockStatus(status: MockStatusBroadcast) {
      if (status == null) return
      this.mockStatus = {
        ruleId: status.enabled ? (status.ruleId ?? '') : '',
        ruleName: status.enabled ? (status.ruleName ?? '') : '',
        enabled: status.enabled === true,
      }
    },
    async markOnboarded() {
      this.onboarded = true
      this.serverConfig = { ...this.serverConfig, onboarded: true }
      if (window.isWeb) {
        window.localStorage.setItem('onboarded', '1')
        return
      }
      try {
        // 只更新接入标记，不重启服务/推送连接
        await window.mainApi?.updateBizConfig(JSON.stringify(this.serverConfig))
      } catch (err) {
        showNotify({ message: $t('common.saveOnboardFailed'), type: 'warning', duration: 1200 })
      }
    },
  }
})
