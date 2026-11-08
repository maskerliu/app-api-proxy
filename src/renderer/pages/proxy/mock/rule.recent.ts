const RECENT_RULE_KEY = 'mock.lastRuleId'

export function readRecentRuleId(): string {
  try {
    return window.localStorage.getItem(RECENT_RULE_KEY) ?? ''
  } catch (err) {
    return ''
  }
}

export function rememberRule(ruleId: string): void {
  if (ruleId == null || ruleId === '') return
  try {
    window.localStorage.setItem(RECENT_RULE_KEY, ruleId)
  } catch (err) {
    // 隐私模式等场景写不进去，不影响录制
  }
}
