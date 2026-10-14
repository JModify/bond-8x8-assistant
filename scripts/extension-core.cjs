/* Keep script releases independent from the core frozen into a released extension. */
const HEADER = '/* Generated from Service-Desk-8x8-Assistant.js. Run npm run build:extension. */\n'
const STARTUP = `
;(() => {
  const runtime = window.__itsCallAssistRuntime
  if (!runtime) return
  runtime.ready.then(() => {
    if (!runtime.active || window.__itsCallAssist) return
    startServiceDeskAssistant()
    runtime.onStarted()
  }).catch((error) => runtime.reportStartError(error))
})()
`
function asFunction (source) {
  // Replace only the outer IIFE; CSS, TXT templates and the complete body stay unchanged.
  if (!/^;\(\(\) => \{$/m.test(source) || !/\}\)\(\)\s*$/.test(source)) throw new Error('The core entry point could not be packaged.')
  return source.replace(/^;\(\(\) => \{$/m, 'function startServiceDeskAssistant () {').replace(/\}\)\(\)\s*$/, '}\n')
}
function packagedSource (bundle) {
  if (!bundle.startsWith(HEADER) || !bundle.endsWith(STARTUP)) throw new Error('The packaged core wrapper is not recognised.')
  const body = bundle.slice(HEADER.length, -STARTUP.length)
  if (!/^function startServiceDeskAssistant \(\) \{$/m.test(body) || !/\}\n$/.test(body)) throw new Error('The packaged core is incomplete.')
  // Recover the original snippet text for hash validation without evaluating any code.
  return body.replace(/^function startServiceDeskAssistant \(\) \{$/m, ';(() => {').replace(/\}\n$/, '})()\n')
}
function compile (source) { return HEADER + asFunction(source) + STARTUP }
module.exports = { asFunction, packagedSource, compile }
