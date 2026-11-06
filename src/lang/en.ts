
export default {
  common: {
    done: 'Done',
    cancel: 'Cancel',
    delete: 'Delete',
    save: 'Save',
    upload: 'Upload',
    loading: 'Loading...',
    searchPlaceholder: 'keyword for search',
    searchNoMatch: 'no match rule found',
    copy: 'Copy',
    copyFailed: 'Copy failed, please copy manually'
  },
  proxy: {
    setDelay: 'requst delay',
    filterPlaceholder: 'filter with keyword',
    scanQrCode: 'scan QrCode to visit:',
    waitingRegister: 'connecting push channel, please wait...',
    requestHeader: 'Request Headers',
    requestParams: 'Request Parameters',
    requestBody: 'Request Body',
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
      update: 'Save Changes',
      delete: {
        title: 'Warning',
        confirm: 'are you sure to delete this record?'
      },
    },
    editor: {
      statusCode: 'Status Code',
      delay: 'Delay',
      headers: 'Response Headers',
      addHeader: 'Add Header',
      headerKey: 'Header Name',
      headerValue: 'Value',
      noHeaders: 'No headers',
      body: 'Response Body',
      format: 'Format',
      compact: 'Compact',
      binaryTip: 'Binary response only shows its size ({size}); text editing is not supported yet',
      bodySize: 'Size: {size}',
      invalidJson: 'Invalid JSON; it will be returned as plain text',
      bodyTooLarge: 'Response body exceeds 2MB',
      name: 'Name',
      namePlaceholder: 'Record name',
      path: 'Path',
      pathPlaceholder: '/v1/users',
      unsaved: 'Unsaved',
      unsavedTitle: 'Unsaved Changes',
      unsavedConfirm: 'The current record has unsaved changes. Discard them and continue?',
      save: 'Save',
      saveSuccess: 'Record saved',
      saveFailed: 'Failed to save record',
      saveConflict: 'The record was modified elsewhere. Refresh and try again.',
      noRecord: 'Select a record on the left, or click + to create one',
      newRecord: 'New Record',
      selectRuleFirst: 'Select a mock rule first',
      tab: {
        response: 'Response',
        variants: 'Variants',
        raw: 'Raw'
      },
      addVariant: 'Add Variant',
      duplicateVariant: 'Duplicate',
      noVariants: 'No variants yet',
      variantName: 'Variant Name',
      variantCount: '{count} variants',
      active: 'Active',
      activeHint: 'Active',
      deleteVariant: 'Delete Variant',
      selectVariant: 'Select a variant to edit',
      copySuffix: 'copy',
      rawHint: 'Edit the full record JSON directly, then apply and save',
      rawApply: 'Apply',
      rawInvalid: 'Invalid record JSON; nothing applied',
      validation: {
        statusRange: 'Status code must be between 100 and 599',
        headerName: 'Invalid header name',
        headerValue: 'Header value must not contain line breaks',
        bodyTooLarge: 'Response body exceeds 2MB',
        urlEmpty: 'Request path is required',
        variantLimit: 'At most 20 variants',
        variantIdMissing: 'Active variant does not exist',
        delayRange: 'Delay must be between 0 and 60000ms',
        bodyType: 'Invalid body type',
        bodyEncoding: 'Invalid body encoding'
      }
    }
  },
  settings: {
    help: {
      title: 'Onboarding & Diagnostics',
      onboarding: 'Onboarding',
      diagnostic: 'Diagnostics'
    },
    sys: {
      title: 'System Info',
      protocol: 'Protocol',
      server: 'Server',
      port: 'Server Port',
      porterror: "Port has been used",
      serverDomain: 'Server Domain',
      proxySocketPort: 'Socket Port',
      updateServer: 'App Update Server',
      apiDefineServer: 'API Define Server',
      statRuleServer: 'Stat Rule Server',
      dataProxyServer: 'Data Proxy Server',
      mqttBroker: 'MQTT Broker',
      theme: 'Theme',
      fontsize: 'FontSize',
      lang: 'locales',
      version: 'Version',
      restart: 'restart',
      cancelUpdate: 'Cancel Update',
      noNewVersion: 'No New Version'
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
  },
  onboarding: {
    title: 'Onboarding',
    subtitle: 'Route real requests through the proxy and verify that mocking works',
    skip: 'Skip',
    prev: 'Back',
    next: 'Next',
    finish: 'Get Started',
    step: {
      service: 'Service',
      client: 'Connect Client',
      verify: 'Verify',
      mock: 'First Mock'
    },
    service: {
      title: 'Proxy service is ready',
      desc: 'Send requests to the proxy address and use headers to specify the real host and client identity.',
      protocol: 'Protocol',
      ip: 'Address',
      port: 'Port',
      status: 'Status',
      uptime: 'Uptime',
      running: 'Running',
      portInvalid: 'The service port is unavailable. Change it in Settings and restart.',
      refresh: 'Check Again',
      copy: 'Copy Proxy URL',
      copied: 'Proxy URL copied',
      failed: 'Failed to load service status'
    },
    client: {
      title: 'Connect from a device or code',
      desc: 'Scan the QR code to register a device, or use a snippet below with the desktop UID.',
      qrcode: 'Scan to register a device',
      registerUrl: 'Register URL',
      targetHost: 'Target Host',
      targetHostPlaceholder: 'https://api.example.com',
      snippet: 'Code Snippet',
      copySnippet: 'Copy Code',
      snippetCopied: 'Code copied',
      waitingUid: 'Waiting for desktop UID…',
      note: 'Windows may ask for firewall permission on first launch. Allow private/public network access, otherwise devices cannot connect.'
    },
    verify: {
      title: 'Verify the connection',
      desc: 'After sending a request, the latest requests and UID status will appear here.',
      waiting: 'Waiting for requests…',
      received: 'Request received',
      empty: 'No request yet. Try a snippet from the previous step.',
      latest: 'Latest Request',
      unknownUid: 'Unknown UID detected',
      unknownUidTip: 'The request UID is not online. Make sure the x-mock-uid header matches the desktop UID.',
      currentUid: 'Desktop UID',
      copyUid: 'Copy UID',
      uidCopied: 'UID copied',
      refresh: 'Refresh'
    },
    mock: {
      title: 'Create your first Mock',
      desc: 'Return fixed JSON for a path and verify that the mock is hit.',
      ruleName: 'Rule Name',
      path: 'Request Path',
      body: 'Response JSON',
      create: 'Create & Enable',
      creating: 'Creating…',
      useLatest: 'Use Latest Request',
      created: 'Mock created and enabled',
      testing: 'Waiting for a hit…',
      hit: 'Mock hit',
      retry: 'Wait Again',
      invalidJson: 'Response body is not valid JSON',
      invalidPath: 'Request path must start with /',
      createFailed: 'Failed to create mock',
      curlTip: 'Verify the mock with:'
    }
  },
  diagnostic: {
    title: 'Diagnostics',
    desc: 'Inspect service health, recent requests and errors, and test whether a target is reachable.',
    back: 'Back',
    refresh: 'Refresh',
    report: 'Copy Report',
    reportCopied: 'Diagnostic report copied (masked)',
    reportFailed: 'Failed to copy report',
    service: 'Service',
    address: 'Address',
    clients: 'Online Clients',
    viewers: 'Desktop',
    devices: 'Devices',
    activeMocks: 'Active Mock Rules',
    uptime: 'Uptime',
    unknownUid: 'Requests with Unknown UID',
    unknownUidEmpty: 'No abnormal requests',
    errors: 'Recent Errors',
    errorsEmpty: 'No errors',
    requests: 'Recent Requests',
    requestsEmpty: 'No requests',
    mockHit: 'Mock Hit',
    uidKnown: 'Registered',
    uidUnknown: 'Unknown',
    target: 'Diagnose Target',
    targetPlaceholder: 'https://your-api.com/health',
    start: 'Diagnose',
    diagnosing: 'Diagnosing…',
    reachable: 'Reachable',
    unreachable: 'Unreachable',
    emptyTarget: 'Please enter a target address',
    entry: 'Diagnostics',
    step: {
      dns: 'DNS',
      tcp: 'TCP',
      tls: 'TLS',
      http: 'HTTP'
    }
  }
}