import { MacUpdater } from 'electron-updater'
// Or NsisUpdater, AppImageUpdater

export default class AppUpdater {
    constructor() {
        const options = {
            requestHeaders: {
                // Any request headers to include here
            },
            provider: 'generic',
            url: 'https://example.com/auto-updates'
        }

        // const autoUpdater = new MacUpdater(options)
        // autoUpdater.addAuthHeader(`Bearer ${token}`)
        // autoUpdater.checkForUpdatesAndNotify()
    }
}
