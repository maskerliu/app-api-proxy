// 完整请求路径表：主进程路由与渲染层调用共用同一份字符串，调用点不再拼 AppMock 前缀。
// AppMock 只是 express 的挂载前缀（决定 body parser 作用域），不出现在业务调用点。
const APPMOCK = '/_appmock'

export const API_URL = {
    AppMock: APPMOCK,
    SearchMockRules: `${APPMOCK}/searchMockRules`,
    GetMockRuleDetail: `${APPMOCK}/getMockRuleDetail`,
    GetActiveMockRule: `${APPMOCK}/getActiveMockRule`,
    SaveMockRule: `${APPMOCK}/saveMockRule`,
    DeleteMockRule: `${APPMOCK}/deleteMockRule`,
    SaveMockRecord: `${APPMOCK}/saveMockRecord`,
    DeleteMockRecord: `${APPMOCK}/deleteMockRecord`,
    GetMockRecords: `${APPMOCK}/getMockRecords`,
    GetMockRecord: `${APPMOCK}/getMockRecord`,
    GetMockRecordByUrl: `${APPMOCK}/getMockRecordByUrl`,
    MATCH_MOCK_RECORD: `${APPMOCK}/matchMockRecord`,
    ANALYZE_MOCK_MATCH: `${APPMOCK}/analyzeMockMatch`,
    GET_MOCK_MIGRATION_REPORT: `${APPMOCK}/getMockMigrationReport`,
    REVERT_MOCK_MATCH: `${APPMOCK}/revertMockMatch`,
    GET_MOCK_MATCH_WARNINGS: `${APPMOCK}/getMockMatchWarnings`,
    GetServerConfig: `${APPMOCK}/getServerConfig`,
    SaveProxyConfig: `${APPMOCK}/saveProxyConfig`,
    GetProxyConfig: `${APPMOCK}/getProxyConfig`,
    GetSocketConnections: `${APPMOCK}/getSocketConnections`,
    GetAllPushClients: `${APPMOCK}/getAllPushClients`,
    Health: `${APPMOCK}/health`,
    Diagnose: `${APPMOCK}/diagnose`,
    MockRegister: `${APPMOCK}/register`,
    Sse: `${APPMOCK}/sse`,
    Broadcast: `${APPMOCK}/sse/broadcast`,

    Proxy: '/_proxy',
    CorsMediaProxy: '/corsMediaProxy'
}
