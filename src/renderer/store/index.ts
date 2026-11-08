import { defineStore } from 'pinia'
import { ConfigProviderTheme, ConfigProviderThemeVars, showNotify } from 'vant'
import type { LocalServerConfig } from '@shared/base.models'
import type { MockStatusBroadcast } from '@shared/mock.models'
import { ProxyMock, getServerConfig, updateBaseDomain, updateClientUID, updateUpdateServer } from '@shared'
import { API_URL } from '@shared/api.const'
import { PushClient } from '../common'

export { ProxyRecordStore } from './ProxyRecords'

let pushClient: PushClient = null

const GRAYS = ['#333333', '#646566', '#969799', '#c8c9cc', '#dcdee0', '#ebedf0', '#f2f3f5', '#f5f6f8']

const BASE_THEME_VARS: ConfigProviderThemeVars = {
  dialogButtonHeight: '40px',
  floatingBubbleSize: '2.5rem',
  gridItemContentPadding: '8px',
  popoverRadius: 'var(--van-radius-sm)',
  switchSize: '1.2rem',
  radioSize: '1rem',
  checkboxSize: '1rem',
  cellGroupInsetPadding: '5px',
  cellGroupInsetTitlePadding: '5px 20px',
  collapseItemContentPadding: '0px',
  tagPadding: '2px 5px',
  tagRadius: '5px',
  cellVerticalPadding: '8px',
  cellHorizontalPadding: '15px',
  popupRoundRadius: '8px',
  popupCloseIconMargin: '23px',
  borderWidth: '1.4px',
  radiusMd: '8px',
  dialogRadius: '8px',
  floatingBubbleBackground: '#f04b1e',
  tabsLineHeight: '1.8rem',
  tabLineHeight: '1rem',
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
      this.registerUrl = `${protocol}://${ip || '127.0.0.1'}:${port}${API_URL.AppMock}${API_URL.MockRegister}/${this.uid}`
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
        showNotify({ message: '保存接入状态失败', type: 'warning', duration: 1200 })
      }
    },
  }
})
