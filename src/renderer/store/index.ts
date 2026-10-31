import { defineStore } from 'pinia'
import { ConfigProviderTheme, ConfigProviderThemeVars, showNotify } from 'vant'
import type { LocalServerConfig } from '@shared/base.models'
import { ProxyMock, getServerConfig, updateBaseDomain, updateClientUID } from '@shared'
import { generateUid, PushClient } from '../common'

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
  tagFontSize: '0.6rem',
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
  tabFontSize: '0.9rem',
  tabLineHeight: '1rem',
}

export const CommonStore = defineStore('Common', {
  state: () => {
    return {
      inited: false,
      uid: '',
      theme: 'light' as ConfigProviderTheme,
      themeVars: { ...BASE_THEME_VARS },
      fontSize: 9,
      lang: 'zh-CN',
      showDebugPanel: false,
      showQrCode: false,
      registerUrl: '',
      clientInfos: [] as Array<ProxyMock.ClientInfo>,
      serverConfig: {} as LocalServerConfig
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

      this.fontSize = parseInt(window.localStorage.getItem('fontSize') || '9')
      this.updateFontSize()

      pushClient = new PushClient()

      if (config) {
        updateBaseDomain(`${config.protocol}://${config.ip}:${config.port}`)
      } else if (__DEV__) {
        updateBaseDomain(SERVER_BASE_URL)
      }

      try {
        this.serverConfig = config ? config : await getServerConfig()
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
    updateFontSize() {
      window.localStorage.setItem('fontSize', `${this.fontSize}`)
      this.themeVars = Object.assign({}, this.themeVars, {
        fontSizeXs: `${this.fontSize}px`,
        fontSizeSm: `${this.fontSize + 2}px`,
        fontSizeMd: `${this.fontSize + 4}px`,
        fontSizeLg: `${this.fontSize + 6}px`,
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
    publishMessage(message: string) {
      // here just mock a device to send a fake monitor data for test

    },
    updateServerConfig(config?: LocalServerConfig) {
      this.uid = window.localStorage.getItem('uid')
      if (this.uid == null) {
        this.uid = generateUid()
        window.localStorage.setItem('uid', this.uid)
      }

      this.serverConfig = config ? config : this.serverConfig
      const ip = this.serverConfig.ip || '127.0.0.1'
      if (this.serverConfig.protocol && this.serverConfig.port != null) {
        updateBaseDomain(`${this.serverConfig.protocol}://${ip}:${this.serverConfig.port}`)
      }
      updateClientUID(this.uid)

      this.registerUrl = `${this.serverConfig.protocol}://${ip}:${this.serverConfig.port}/appmock/register/${this.uid}`
      if (window.isWeb) {
        pushClient.start(`${this.serverConfig.protocol}://${ip}:${this.serverConfig.port}`, this.uid)
      } else {
        pushClient.start(`${this.serverConfig.protocol}://localhost:${this.serverConfig.port}`, this.uid)
      }
    },
    updateClientInfos(clientInfos: Array<ProxyMock.ClientInfo>) {
      this.clientInfos = [...clientInfos]
    },
  }
})
