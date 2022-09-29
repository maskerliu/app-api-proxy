import { defineStore } from 'pinia'
import { MockRule } from "../../common/models/DataModels"


export const useMockRuleStore = defineStore('MockRules', {
  state: () => {
    return {
      showEdit: false,
      showDelete: false,
      curRule: null as MockRule,
      curRuleId: null,
    }
  },
  actions: {
    
  }
})