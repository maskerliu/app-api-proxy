export default {
  common: {
    done: 'Done',
    cancel: 'Cancel',
    delete: 'Delete',
    save: 'Save',
    upload: 'Upload',
    searchPlaceholder: 'keyword for search',
    searchNoMatch: 'no match rule found'
  },
  proxy: {
    setDelay: 'requst delay',
    filterPlaceholder: 'filter with keyword',
    scanQrCode: 'scan QrCode to visit:',
    requestHeader: 'Request Headers',
    requestParams: 'Request Parameters',
    responseHeader: 'Response Headers',
    responseBody: 'Response Body',
    preview: 'Preview'
  },
  mock: {
    rule: {
      title: 'Mock Rule Info',
      name: 'Rule Name',
      desc: 'Rule Desc',
      delete: {
        title: 'Warning',
        confirm: 'are you sure to delete rule[ {rule} ]?'
      },
    },
    record: {
      delete: {
        title: 'Warning',
        confirm: 'are you sure to delete this record?'
      },
    }
  },
  iot: {
    device: {
      name: 'Name',
      address: 'Address',
      delete: {
        title: 'Warning',
        confirm: 'Are you sure to remove the device [{deviceId}]？',
        confirm1: 'After remove from system, the data of device will not collect, please be careful to do this！！！'
      }
    }
  },
  settings: {
    sys: {
      title: 'System Info',
      server: 'Server',
      port: 'Server Port',
      serverDomain: 'Server Domain',
      proxySocketPort: 'Socket Port',
      apiDefineServer: 'API Define Server',
      statRuleServer: 'Stat Rule Server',
      dataProxyServer: 'Data Proxy Server',
      mqttBroker: 'MQTT Broker',
      theme: 'Theme',
      version: 'Version'
    },
    boardcast: {
      onlineClient: 'Online Client',
      placeholder: 'please enter message',
      btnSend: 'Send'
    },
    games: {
      title: 'Game Bundle Manager',
      upload: 'Upload Game',
      name: 'Name',
      author: 'Author',
      version: 'Version',
      desc: 'Description',
      icon: 'Icon',
      snap: 'Previews',
      res: 'Game Bundle'
    },
    resources: {
      title: 'Manage Remote Static Resources',
      upload: 'Upload File',
      manage: 'Remote Resource Manage'
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