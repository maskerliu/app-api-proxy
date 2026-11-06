export type SnippetLang = 'curl' | 'javascript' | 'python' | 'android'

export interface SnippetOptions {
  proxyUrl: string
  targetHost: string
  uid: string
  path: string
}

export interface SnippetItem {
  lang: SnippetLang
  label: string
  mode: string
  code: string
}

function quote(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

export function buildSnippets(options: SnippetOptions): SnippetItem[] {
  const proxyUrl = `${options.proxyUrl}${options.path}`
  const server = options.proxyUrl.replace(/\/_proxy$/, '')
  const targetHost = options.targetHost || 'https://api.example.com'
  const uid = options.uid || '<YOUR_UID>'

  return [
    {
      lang: 'curl',
      label: 'cURL',
      mode: 'sh',
      code: [
        `curl -X GET '${quote(proxyUrl)}' \\`,
        `  -H 'x-mock-host: ${quote(targetHost)}' \\`,
        `  -H 'x-mock-uid: ${quote(uid)}'`,
      ].join('\n'),
    },
    {
      lang: 'javascript',
      label: 'JavaScript',
      mode: 'javascript',
      code: [
        `fetch('${quote(proxyUrl)}', {`,
        '  headers: {',
        `    'x-mock-host': '${quote(targetHost)}',`,
        `    'x-mock-uid': '${quote(uid)}',`,
        '  },',
        '})',
        '  .then(res => res.text())',
        '  .then(console.log)',
      ].join('\n'),
    },
    {
      lang: 'python',
      label: 'Python',
      mode: 'python',
      code: [
        'import requests',
        '',
        'resp = requests.get(',
        `    "${proxyUrl}",`,
        '    headers={',
        `        "x-mock-host": "${targetHost}",`,
        `        "x-mock-uid": "${uid}",`,
        '    },',
        ')',
        'print(resp.status_code, resp.text)',
      ].join('\n'),
    },
    {
      lang: 'android',
      label: 'Android',
      mode: 'kotlin',
      code: [
        'import okhttp3.*',
        '',
        '// 自动把请求改写到代理，并带上 x-mock-host / x-mock-uid',
        'class MockProxyInterceptor(',
        `    private val server: String = "${server}",`,
        `    private val mockHost: String = "${targetHost}",`,
        `    private val uid: String = "${uid}"`,
        ') : Interceptor {',
        '',
        '    override fun intercept(chain: Interceptor.Chain): Response {',
        '        val origin = chain.request()',
        '        val proxyUrl = server + "/_proxy" + origin.url.encodedPath +',
        '            (origin.url.encodedQuery?.let { "?$it" } ?: "")',
        '',
        '        return chain.proceed(',
        '            origin.newBuilder()',
        '                .url(proxyUrl)',
        '                .header("x-mock-host", mockHost)',
        '                .header("x-mock-uid", uid)',
        '                .build()',
        '        )',
        '    }',
        '}',
        '',
        'val client = OkHttpClient.Builder()',
        '    .addInterceptor(MockProxyInterceptor())',
        '    .build()',
      ].join('\n'),
    },
  ]
}
