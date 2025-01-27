export default {
  common: {
    done: '确定',
    cancel: '取消',
    delete: '删除',
    save: '保存',
    upload: '上传',
    searchPlaceholder: '请输入搜索关键词',
    searchNoMatch: '未找到符合的规则'
  },
  proxy: {
    setDelay: '延时时长',
    filterPlaceholder: '筛选关键字',
    scanQrCode: '扫描二维码访问：',
    requestHeader: '请求头',
    requestParams: '请求参数',
    requestBody: '请求体',
    responseHeader: '响应头',
    responseBody: '响应数据',
    preview: '预览'
  },
  mock: {
    rule: {
      title: '规则详情',
      name: '规则名',
      desc: '规则描述',
      delete: {
        title: '警告⚠️',
        confirm: '确定要删除规则[ {rule} ]吗?'
      },
    },
    record: {
      delete: {
        title: '警告⚠️',
        confirm: '确认要删除这条请求数据？'
      },
    }
  },
  settings: {
    sys: {
      title: '系统信息',
      server: '服务IP地址',
      protocol: 'Http协议',
      serverDomain: '服务域名',
      port: '代理Http服务端口',
      porterror: "端口已被占用，请更换",
      updateServer: '应用更新服务地址',
      proxySocketPort: '代理长连服务端口',
      apiDefineServer: 'API定义服务地址',
      statRuleServer: '埋点规则服务地址',
      dataProxyServer: '代理数据服务地址',
      mqttBroker: 'MQTT服务地址',
      theme: '主题',
      lang: '语言',
      version: '版本',
      restart: '重启',
      noNewVersion: '当前已是最新版本',
    },
    boardcast: {
      onlineClient: '在线Client',
      placeholder: '请输入内容',
      btnSend: '发送'
    },
    games: {
      title: '游戏资源管理',
      upload: '上传游戏',
      name: '游戏名',
      author: '厂商',
      version: '版本',
      desc: '简介',
      icon: '图标',
      snap: '预览图',
      res: '资源包'
    },
    resources: {
      title: '静态资源管理',
      upload: '上传文件',
      manage: '远程资源管理'
    }
  },
  debug: {
    common: {
      title: 'Common',
      versionCheck: 'Check Version',
      devTools: 'Developer Tools',
    },
    virtualClient: {
      title: 'Virtual Client'
    }
  }
}