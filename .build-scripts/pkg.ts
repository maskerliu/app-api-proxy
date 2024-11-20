"use strict"

import builder, { Arch, Platform, Configuration } from 'electron-builder'

/**
* @see https://www.electron.build/configuration
*/
const options: Configuration = {
  productName: 'app-api-proxy',
  appId: 'com.github.maskerliu.AppApiProxy',
  protocols: {
    name: "AppApiProxy",
    // Don't forget to set `MimeType: "x-scheme-handler/deeplink"` for `linux.desktop` entry!
    schemes: [
      "appmock"
    ]
  },
  files: [
    'dist/**/*',
    '!**/node_modules/**/*.map',
    '!**/node_modules/.github/*',
    '!**/node_modules/**/*.md',
    '!**/node_modules/**/LICENSE',
    '!**/node_modules/**/android-*/*',
    '!**/node_modules/**/linux-*/*',
    '!**/node_modules/**/win32-ia32/*',
    '!**/node_modules/**/deps/*'
  ],
  extraFiles: [],
  extraResources: [],
  electronLanguages: ['en-US', 'zh-CN'],
  // "store” | “normal” | "maximum". - For testing builds, use 'store' to reduce build time significantly.
  compression: "normal",
  removePackageScripts: true,
  pkg: { installLocation: '/Applications' },
  nodeGypRebuild: false,
  buildDependenciesFromSource: false,
  directories: {
    output: 'build',
    buildResources: 'build/installer/resources'
  },
  afterSign: async (context) => {
    // Mac releases require hardening+notarization: https://developer.apple.com/documentation/xcode/notarizing_macos_software_before_distribution
    // if (!isDebug && context.electronPlatformName === 'darwin') {
    //   await notarizeMac(context)
    // }
  },
  artifactBuildStarted: (context) => {
    // identifyLinuxPackage(context)
  },
  afterAllArtifactBuild: (buildResult) => {
    return []
    // return stampArtifacts(buildResult)
  },
  // force arch build if using electron-rebuild
  beforeBuild: async (context) => {
    const { appDir, electronVersion, arch } = context
    // await electronRebuild.rebuild({ buildPath: appDir, electronVersion, arch })
    return false
  },
  // extraFiles: [
  //   {
  //     from: "build/Release",
  //     to: nodeAddonDir,
  //     filter: "*.node"
  //   }
  // ],

  win: {
    icon: '../icons/icon.ico',
    target: [{ target: 'nsis', arch: ['x64'] }]
  },
  nsis: {
    deleteAppDataOnUninstall: true,
  },

  mac: {
    icon: '../icons/icon.icns',
    target: [{ target: 'dmg', arch: ['universal'] }],
    hardenedRuntime: true,
    gatekeeperAssess: true,
    extendInfo: {
      NSAppleEventsUsageDescription: 'Let me use Apple Events.',
      NSCameraUsageDescription: 'Let me use the camera.',
      NSScreenCaptureDescription: 'Let me take screenshots.',
    }
  },
  dmg: {
    background: 'installer/mac/dmg-background.png',
    iconSize: 100,
    contents: [
      {
        x: 255,
        y: 85,
        type: 'file'
      },
      {
        x: 253,
        y: 325,
        type: 'link',
        path: '/Applications'
      }
    ],
    window: {
      width: 500,
      height: 500
    }
  },

  linux: {
    desktop: {
      StartupNotify: 'false',
      Encoding: 'UTF-8',
      MimeType: 'x-scheme-handler/AppApipiProxy'
    },
    target: ['AppImage', 'rpm', 'deb', 'pacman']
  },
  deb: {
    priority: 'optional',
    afterInstall: 'installer/linux/after-install.tpl'
  },
  rpm: {
    fpm: ['--before-install', 'installer/linux/before-install.tpl'],
    afterInstall: 'installer/linux/after-install.tpl'
  }
}

let targets: Map<Platform, Map<Arch, Array<string>>>
let excludefiles = []
switch (process.platform) {
  case 'win32':
    excludefiles = [
      '!**/node_modules/**/drawin-*/*',
      '!**/node_modules/**/linux-*/*',
    ]
    targets = Platform.WINDOWS.createTarget()
    break
  case 'darwin':
    excludefiles = [
      '!**/node_modules/**/win32-*/*',
      '!**/node_modules/**/linux-*/*',
    ]
    targets = Platform.MAC.createTarget()
    break
  case 'linux':
    excludefiles = [
      '!**/node_modules/**/win32-*/*',
      '!**/node_modules/**/drawin-*/*',
    ]
    targets = Platform.LINUX.createTarget()
    break
}

options.files = [...(options.files as []), ...excludefiles]

// Promise is returned
builder.build({
  targets,
  config: options
}).then((result) => {
  console.log(JSON.stringify(result, null, '\t'))
}).catch((error) => {
  console.error(error)
})