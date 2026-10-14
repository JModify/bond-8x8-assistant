/* Shared constants contain no caller data, credentials or remotely executed code. */
;(() => {
  'use strict'
  const settingsKeys = [
    'service-desk-8x8-preferences-v5', 'service-desk-8x8-sounds-v4',
    'service-desk-8x8-statistics-v1', 'service-desk-8x8-short-breaks-v1'
  ]
  globalThis.SDAExtension = Object.freeze({
    channel: 'service-desk-8x8-extension-v1',
    site: 'https://vcc-au2.8x8.com/',
    match: 'https://vcc-au2.8x8.com/*',
    settingsKeys,
    historyKey: 'service-desk-8x8-call-history-v1',
    metaKey: 'extension-history-v1',
    checkpointKey: 'extension-editor-v1',
    ownerKey: 'extension-owner-v1',
    enabledKey: 'extension-enabled-v1',
    recordKey: (key) => 'extension-call:' + key,
    isSite: (url) => {
      try {
        const value = new URL(url)
        return value.protocol === 'https:' && value.hostname === 'vcc-au2.8x8.com'
      } catch { return false }
    }
  })
})()
