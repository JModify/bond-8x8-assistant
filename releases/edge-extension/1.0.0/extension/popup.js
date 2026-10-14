/* Toolbar controls use only packaged extension code and the permitted 8x8 host. */
;(() => {
  'use strict'
  const api = globalThis.chrome
  const C = globalThis.SDAExtension
  const element = (id) => document.getElementById(id)
  let target = null
  let busy = false
  let updatesConfigured = false
  async function send (message) {
    const response = await api.runtime.sendMessage({ channel: C.channel, ...message })
    if (!response || response.error) throw new Error(response?.error || 'The assistant did not respond. Try again.')
    return response
  }
  function controls () {
    element('enabled').disabled = busy
    element('activate').disabled = busy || !target
    element('reload').disabled = busy || !target
    element('open-site').disabled = busy
    element('update').disabled = busy || !updatesConfigured
  }
  async function refresh () {
    const [state, active, sites] = await Promise.all([
      send({ operation: 'status' }),
      api.tabs.query({ active: true, currentWindow: true }),
      api.tabs.query({ url: C.match })
    ])
    const current = active.find((tab) => C.isSite(tab.url))
    target = current || sites.find((tab) => tab.id === state.owner?.tabId) || sites[0] || null
    element('enabled').checked = state.enabled
    element('version').textContent = 'v' + state.version
    const running = !!state.owner && state.enabled
    element('badge').textContent = !state.enabled ? 'Off' : running ? 'Running' : 'Ready'
    element('badge').dataset.state = !state.enabled ? 'off' : running ? 'active' : 'ready'
    element('status').textContent = !state.enabled
      ? 'Turn on automatic startup to use the assistant.'
      : running
        ? state.owner.tabId === current?.id ? 'Your assistant is running on this 8x8 tab.' : 'Your assistant is running on another 8x8 tab.'
        : 'Open 8x8 to start the assistant, or show it on an existing tab.'
    element('activate').textContent = current ? 'Show assistant on this tab' : 'Show assistant on 8x8'
    element('saved').textContent = `${state.savedCalls} ${state.savedCalls === 1 ? 'call note' : 'call notes'} saved in this browser.`
    updatesConfigured = state.updatesConfigured
    if (updatesConfigured) element('updates').textContent = 'Edge checks for signed extension updates automatically.'
    controls()
  }
  async function perform (operation) {
    if (busy) return
    busy = true
    controls()
    element('feedback').textContent = ''
    try { await operation(); await refresh() } catch (error) {
      element('feedback').textContent = error.message
    } finally { busy = false; controls() }
  }
  element('enabled').onchange = () => perform(() => send({ operation: 'enabled', enabled: element('enabled').checked }))
  element('activate').onclick = () => perform(() => send({ operation: 'activate', tabId: target.id }))
  element('open-site').onclick = () => perform(() => send({ operation: 'open-site' }))
  element('reload').onclick = () => perform(() => send({ operation: 'reload', tabId: target.id }))
  element('update').onclick = () => perform(async () => {
    const result = await send({ operation: 'update' })
    element('feedback').textContent = result.status === 'update_available'
      ? 'An update is available. Edge will install it when the extension can restart safely.'
      : result.status === 'throttled' ? 'Edge checked recently. Try again later.' : 'No update is available.'
  })
  // A rejected storage read never pretends the assistant is empty or ready.
  perform(refresh)
})()
