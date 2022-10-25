
import { mapWritableState } from 'pinia'
import type { PropType } from 'vue'
import { defineComponent } from 'vue'
import { ProxyRequestRecord, ProxyStatRecord } from '../../../common/models'

import { useProxyRecordStore } from '../../store/ProxyRecords'


export default defineComponent({

  props: {
    source: { type: Object as PropType<ProxyRequestRecord>, required: true }
  },
  computed: {
    ...mapWritableState(useProxyRecordStore, ['curRecordId'])
  },
  methods: {

  }
})
