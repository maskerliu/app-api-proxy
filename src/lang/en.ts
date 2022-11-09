export default {
  common: {
    done: 'Done',
    cancel: 'Cancel',
    delete: 'Delete',
    save: 'Save',
    searchPlaceholder: 'keyword for search'
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
    server: 'Server',
    port: 'Server Port',
    proxySocketPort: 'Socket Port',
    apiDefineServer: 'API Define Server',
    statRuleServer: 'Stat Rule Server',
    dataProxyServer: 'Data Proxy Server',
    mqttBroker: 'MQTT Broker',
    boardcast: {
      onlineClient: 'Online Client',
      placeholder: 'please enter message',
      btnSend: 'Send'
    }
  }
}