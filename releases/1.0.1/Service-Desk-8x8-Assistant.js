/* Service Desk 8x8 Assistant — v1.0.1
 * Run in the existing logged-in 8x8 tab: DevTools > Sources > Snippets >
 * New snippet. Paste this entire file, then press Ctrl+Enter.
 * Monitoring starts automatically. Select the G1 agents; Pause/Resume is optional.
 * Tick Me in G1 for your own availability, disposition and lunch reminders.
 * Browser audio may require a click in the page; normal interactions enable it.
 * No downloads, external requests, credentials, or second login are used.
 * Reads rendered queue/agent HTML; never changes your availability or answers calls.
 * Keep the three inbound queue rows and selected agents rendered in the sidebar.
 * Background browser throttling, page freezing, logout, closure and refresh
 * can delay/stop monitoring. Rerun after a refresh. Not a guaranteed alarm service.
 * In G2, assistance uses the break, waiting and coverage rules.
 * In G1, Me gets availability, disposition and lunch reminders.
 * Timings are configurable in Assistant Settings. Only one personal alarm runs.
 * G1 selections, assistant settings and sounds persist when storage is permitted.
 * Missing queue/group information hides the controls until it returns.
 * Pause freezes the display and alert checks. Only the Busy-start counter keeps running.
 * Statistics record observed Busy starts, not 8x8's complete historical call totals.
 */
(() => {
  'use strict';
  let root = window;
  try { if (window.top.location.origin === location.origin) root = window.top; } catch {}
  if (root.location.hostname !== 'vcc-au2.8x8.com') {
    throw new Error('Run this snippet in your existing vcc-au2.8x8.com tab.');
  }
  root.__itsCallAssist?.destroy();
  const doc = root.document;
  const VERSION = '1.0.1';
  const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();
  const normal = s => clean(s).toLowerCase();
  const QUEUE_CONFIG_KEY='service-desk-8x8-inbound-queues-v1';
  function validQueueNames(value) {
    return Array.isArray(value) && value.length===3 && value.every(name=>typeof name==='string' && clean(name))
      && new Set(value.map(clean)).size===3;
  }
  let QUEUES=[];
  try {
    const value=JSON.parse(root.localStorage.getItem(QUEUE_CONFIG_KEY) || 'null');
    if (validQueueNames(value)) QUEUES=value.map(clean);
  } catch {}
  if (!QUEUES.length && validQueueNames(root.__serviceDesk8x8Queues)) QUEUES=root.__serviceDesk8x8Queues.map(clean);
  function duration(text) {
    const s = normal(text);
    if (!s) return null;
    const parts = [...s.matchAll(/(\d+)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/g)];
    if (!parts.length || clean(s.replace(/\d+\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/g, ''))) return null;
    return parts.reduce((n, p) => n + Number(p[1]) * (p[2][0] === 'h' ? 3600 : p[2][0] === 'm' ? 60 : 1), 0);
  }
  function visible(node) {
    if (!node || !node.getClientRects().length) return false;
    const view = node.ownerDocument.defaultView;
    for (let n = node; n?.nodeType === 1; n = n.parentElement) {
      const css = view.getComputedStyle(n);
      if (n.hidden || css.display === 'none' || css.visibility === 'hidden' || css.visibility === 'collapse') return false;
    }
    return true;
  }
  function documents() {
    const found = [], seen = new Set();
    function walk(d) {
      if (!d || seen.has(d)) return;
      seen.add(d); found.push(d);
      for (const f of d.querySelectorAll('iframe,frame')) {
        try { if (visible(f)) walk(f.contentDocument); } catch {}
      }
    }
    walk(doc);
    return found;
  }
  function agentRows(docs) {
    return docs.flatMap(d => [...d.querySelectorAll('[data-test-id="agent-item"]')].filter(visible));
  }
  const agentName = r => clean(r.querySelector('[data-test-id="agent-name-label"]')?.getAttribute('title') || r.getAttribute('aria-label'));
  function read(docs, name) {
    const errors = [];
    const candidates = agentRows(docs).filter(r => agentName(r) === name);
    let agent = null;
    if (name === 'Me') {
      agent = readMe(docs);
      if (!agent) errors.push('Your status or timer is unreadable');
    }
    else if (candidates.length !== 1) errors.push(`Agent row ${candidates.length ? 'ambiguous' : 'missing'}: ${name || '(choose an agent)'}`);
    else {
      const r = candidates[0];
      const status = clean(r.querySelector('[data-status-value]')?.getAttribute('data-status-value'));
      const timer = clean(r.querySelector('[data-test-id="user-presence-timer"]')?.textContent);
      const seconds = duration(timer);
      if (!status || seconds === null) errors.push('Agent status or timer unreadable');
      else agent = {name, status, timer, seconds};
    }
    const rows = docs.flatMap(d => [...d.querySelectorAll('[data-test-id="queue-item"]')].filter(visible));
    const queues = QUEUES.map(name => {
      const matches = rows.filter(r => clean(r.querySelector('[data-test-id="queue-name"]')?.getAttribute('title')) === name);
      if (matches.length !== 1) { errors.push(`Queue row ${matches.length ? 'ambiguous' : 'missing'}: ${name}`); return {name, waiting:null}; }
      const cells = [...matches[0].querySelectorAll('[role="gridcell"][title]')];
      const cellsWaiting = cells.filter(c => /^\d+\s+Interactions? waiting$/i.test(clean(c.getAttribute('title'))));
      const waiting = cellsWaiting.length === 1 && /^\d+$/.test(clean(cellsWaiting[0].textContent)) ? Number(clean(cellsWaiting[0].textContent)) : null;
      const titleCount = cellsWaiting.length === 1 ? Number(cellsWaiting[0].getAttribute('title').match(/^\d+/)?.[0]) : null;
      if (waiting === null || waiting !== titleCount || !Number.isSafeInteger(waiting)) {
        errors.push(`Waiting count unreadable: ${name}`); return {name, waiting:null};
      }
      return {name, waiting};
    });
    return {agent, queues, errors};
  }
  function readMe(docs) {
    const candidates = [];
    for (const d of docs) {
      for (const timer of d.querySelectorAll('[data-test-id="user-presence-timer"]')) {
        if (!visible(timer) || timer.closest('[data-test-id="agent-item"]')) continue;
        // The supplied header nests the timer one level below the status wrapper.
        let wrapper = timer.parentElement;
        for (let depth = 0; wrapper && depth < 4; depth++, wrapper = wrapper.parentElement) {
          const states = [...wrapper.querySelectorAll('[data-status-value]')].filter(visible);
          const timers = wrapper.querySelectorAll('[data-test-id="user-presence-timer"]');
          if (states.length === 1 && timers.length === 1) {
            const status = clean(states[0].getAttribute('data-status-value'));
            const text = clean(timer.textContent), seconds = duration(text);
            if (status && seconds !== null) candidates.push({name:'Me', status, timer:text, seconds});
            break;
          }
        }
      }
    }
    return candidates.length === 1 ? candidates[0] : null;
  }
  function readCounterPresence(docs) {
    const states=docs.flatMap(d=>[...d.querySelectorAll('[data-test-id="user-status"][data-status-value]')])
      .filter(node=>!node.closest('[data-test-id="agent-item"]') && visible(node));
    if (states.length!==1) {
      // An open status picker can add icons. The header's own timer identifies
      // the actual presence in that case; no queue or group counts are read.
      const me=readMe(docs);return me?{status:me.status}:null;
    }
    const status=clean(states[0].getAttribute('data-status-value'));
    return status?{status}:null;
  }
  function groupRules(agents, queues, others = agents, me = null, timing = {callMinutes:2,coverMinutes:3}) {
    const waiting = queues.length === QUEUES.length && queues.every(q => q.waiting !== null) && queues.some(q => q.waiting > 0);
    return {
      call: waiting ? agents.filter(a => normal(a.status) === 'busy' && a.seconds > timing.callMinutes * 60).map(a => a.name) : [],
      lunch: agents.filter(a => normal(a.status) === 'on break').map(a => a.name),
      critical: !!me && normal(me.status) !== 'available' && (
        (others.length > 0 && others.every(a => !['available','busy'].includes(normal(a.status)))) ||
        (agents.length > 0 && waiting && agents.every(a => normal(a.status) === 'busy' && a.seconds >= timing.coverMinutes * 60)))
    };
  }
  function dispositionStatus(status) {
    const label = normal(status).replace(/[-_]/g, ' ').replace(/\s+/g, ' ');
    return ['wrap up', 'wrapup', 'post processing', 'postprocessing', 'disposition'].includes(label);
  }
  function personalRule(me, lunchMinutes, dispositionSeconds = 10) {
    if (!me || !me.status || !Number.isFinite(me.seconds)) return null;
    const status = normal(me.status);
    if (dispositionStatus(status)) {
      return me.seconds > dispositionSeconds ? {kind:'disposition', title:'Alert: Complete Disposition',
        body:`You have been in disposition for more than ${dispositionSeconds} seconds. Complete the fields and click Wrap up.`} : null;
    }
    if (status === 'on break' || status === 'break') {
      return me.seconds > lunchMinutes * 60 ? {kind:'lunchOverdue', title:'Alert: Lunch Break Finished',
        body:`Your ${lunchMinutes}-minute lunch allowance has passed. Change your status to Available.`} : null;
    }
    if (status === 'available' || status === 'busy') return null;
    return {kind:'critical', title:'Alert: Change Status To Available',
      body:`You are covering phones in G1 and your status is ${me.status}. Change your status to Available.`};
  }
  const host = doc.createElement('div');
  host.id = 'its-call-assist-panel';
  host.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647;max-width:calc(100vw - 36px)';
  const shadow = host.attachShadow({mode:'open'});
  const style = doc.createElement('style');
  style.textContent = `:host{font:13px/1.45 system-ui,sans-serif;color:#172235}*{box-sizing:border-box}.panel{width:390px;max-width:100%;max-height:85vh;overflow:auto;background:#fff;border:1px solid #b5c6dc;border-radius:12px;box-shadow:0 8px 35px #0004;padding:16px}h3{margin:0 0 10px;font-size:16px}label{display:block;margin:8px 0}select,input[type=text]{display:block;width:100%;padding:6px;border:1px solid #a4b2c7;border-radius:5px;background:white;color:#172235}button{cursor:pointer;padding:6px 9px;margin:4px 4px 0 0;border:1px solid #afbdd0;background:#eef3fa;color:#172235;border-radius:5px}button.primary{background:#245dc1;color:white}.small{font-size:11px;color:#526176}pre{font:12px/1.5 system-ui;white-space:pre-wrap;margin:10px 0}.alert{padding:9px;background:#fff0cb;border-radius:6px;margin-top:8px}.hidden{display:none!important}.agents{max-height:240px;overflow:auto;border:1px solid #d7e0ec;border-radius:6px;margin:8px 0}table{border-collapse:collapse;width:100%;font-size:12px}th,td{text-align:left;padding:6px}th{background:#eef3fa;position:sticky;top:0}td{border-top:1px solid #e4eaf2}.state{display:block;color:#526176;font-size:11px}input[type=checkbox]{cursor:pointer;width:16px;height:16px}.unavailable{font-weight:600}.top{display:flex;justify-content:space-between;align-items:center}.top button{margin:0;padding:2px 7px}`;
  style.textContent += `
    .menu-header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:18px;padding-bottom:12px;border-bottom:1px solid #e4eaf2;position:sticky;top:0;z-index:2;background:#fff}
    .menu-header h3{margin:0}
    .menu-header button{margin:0;flex-shrink:0;padding:6px 10px}
    .sound-intro{margin-bottom:20px}
    .sound-category{min-width:0;margin:0 0 20px;padding:12px 14px 14px;border:1px solid #d7e0ec;border-radius:8px;background:#f8faff}
    .sound-category legend{padding:0 6px;font-weight:600;font-size:12px}
    .sound-description{margin-bottom:12px}
    .sound-description p{margin:0 0 8px}
    .sound-description p:last-child{margin-bottom:0}
    .sound-description ul{margin:0 0 8px;padding-left:18px}
    .sound-description li{margin-bottom:5px}
    .sound-field{display:grid;gap:6px;margin:12px 0;font-weight:500}
    .sound-settings select,.sound-settings input[type=number],.assistant-settings input[type=number]{width:100%;padding:8px;border:1px solid #a4b2c7;border-radius:5px;background:#fff;color:#172235;font:inherit}
    .volume-control{display:flex;align-items:center;gap:12px;min-width:0}
    .volume-control input{flex:1;min-width:0;width:100%;margin:0;accent-color:#245dc1;cursor:pointer}
    .volume-value{flex:0 0 42px;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
    .repeat-control{display:flex;align-items:center;gap:8px;margin:14px 0}
    .repeat-control input{flex-shrink:0;margin:0;accent-color:#245dc1}
    .sound-field.disabled{color:#8993a2}
    .sound-settings input:disabled{background:#edf0f4;border-color:#d7dde6;color:#8993a2;cursor:not-allowed}
    .sound-actions{display:flex;gap:8px;margin-top:20px;padding-top:4px}
    .sound-actions button{margin:0}
    .settings-card{margin:0 0 20px;padding:14px;border:1px solid #d7e0ec;border-radius:8px;background:#f8faff}
    .settings-card h4{margin:0 0 6px;font-size:13px}
    .settings-description{margin:0 0 14px;font-size:12px;color:#526176}
    .setting-value{display:flex;align-items:center;gap:8px;margin-top:12px}
    .assistant-settings .setting-value input{width:85px}
    .lunch-value{flex:0 0 58px}
    .lunch-limits{display:flex;justify-content:space-between;margin-top:5px}
    .section-heading{margin:14px 0 8px;font-size:13px;font-weight:600}
    .agent-table{table-layout:fixed}
    .agent-table th:nth-child(1){width:34%}
    .agent-table th:nth-child(2){width:30%}
    .agent-table th:nth-child(3){width:25%}
    .agent-table th:nth-child(4){width:11%}
    .agent-table th:last-child,.agent-table td:last-child{text-align:center}
    .agent-table td{vertical-align:middle;padding:8px 6px}
    .agent-name{font-weight:500;overflow-wrap:anywhere}
    .agent-time{white-space:nowrap;font-size:11px;font-variant-numeric:tabular-nums}
    .agent-status{display:inline-block;max-width:100%;padding:2px 5px;border-radius:4px;background:#edf1f6;color:#526176;font-size:11px;overflow-wrap:anywhere}
    .agent-status[data-state="available"]{background:#e6f5ed;color:#17633a}
    .agent-status[data-state="busy"]{background:#fdeceb;color:#9a2c27}
    .agent-status[data-state="wrap up"],.agent-status[data-state="post processing"]{background:#f0eafb;color:#654293}
    .me-row{background:#f6f9fe}
    .agent-table input[type=checkbox]{margin:0;accent-color:#245dc1;vertical-align:middle}
    .controls{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px;padding-top:12px;border-top:1px solid #e4eaf2}
    .controls button{margin:0;padding:6px 8px;font-size:12px}
    .agent-help{margin:8px 0 14px}
    .panel{width:470px}
    .title-block h3{margin:0}
    .version{margin-top:3px}
    .window-actions{display:flex;gap:5px;align-self:flex-start}
    .top .window-actions button{width:27px;height:27px;padding:0;font-size:17px;line-height:1}
    .monitor-grid{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(0,1fr);gap:14px}
    .monitor-grid>section{min-width:0}
    .statistics{margin-top:10px}
    .stat{margin-bottom:10px}
    .stat-label{display:block;font-size:11px;color:#526176}
    .stat-value{font-size:15px;font-weight:600;font-variant-numeric:tabular-nums}
    .stat-total{font-size:25px;color:#245dc1}
    .statistics-note{font-size:10px;color:#526176;margin-top:10px}
    button:disabled{opacity:.45;cursor:not-allowed}
    @media(max-width:520px){.monitor-grid{grid-template-columns:1fr}}
  `;
  shadow.append(style);
  function el(tag, text, parent, cls) {
    const n = doc.createElement(tag); if (text) n.textContent = text;
    if (cls) n.className = cls; parent?.append(n); return n;
  }
  const panel = el('section', '', shadow, 'panel');
  const unavailableBox = el('div', 'Unable to Assist: Open 8x8 agent queue information.', panel, 'unavailable hidden');
  const normalView = el('div', '', panel, 'main-view');
  const top = el('div', '', normalView, 'top');
  const titleBlock=el('div','',top,'title-block');
  el('h3', 'Service Desk 8x8 Assistant', titleBlock);
  el('div', `Version ${VERSION}`, titleBlock, 'small version');
  const windowActions=el('div','',top,'window-actions');
  const minimize=el('button','-',windowActions);
  minimize.title='Minimise assistant';minimize.setAttribute('aria-label','Minimise assistant');
  const remove=el('button','x',windowActions);
  remove.title='Close assistant';remove.setAttribute('aria-label','Close assistant');
  const content = el('div', '', normalView);
  el('h4', 'Agents', content, 'section-heading');
  const agentContainer = el('div', '', content, 'agents');
  const table = el('table', '', agentContainer, 'agent-table');
  const head = el('tr', '', el('thead', '', table));
  el('th', 'Name', head); el('th', 'Status', head); el('th', 'Time', head); el('th', 'G1', head);
  const agentList = el('tbody', '', table);
  el('div', 'Group 1 (G1) refers to any agent covering phones. An agent which is not in Group 1 is considered Group 2 (G2).', content, 'small agent-help');
  const monitorGrid=el('div','',content,'monitor-grid');
  const monitoringSection=el('section','',monitorGrid);
  el('h4', 'Monitoring', monitoringSection, 'section-heading');
  const statusBox = el('pre', 'Inspecting page…', monitoringSection);
  const statisticsSection=el('section','',monitorGrid);
  el('h4','Statistics',statisticsSection,'section-heading');
  const statisticsBody=el('div','',statisticsSection,'statistics');
  function stat(label,cls) {
    const box=el('div','',statisticsBody,'stat');el('span',label,box,'stat-label');
    return el('span','—',box,'stat-value'+(cls?' '+cls:''));
  }
  const callTotal=stat('Calls taken today','stat-total');
  const callsHour=stat('Calls in the last hour');
  const lastCall=stat('Last call detected');
  const statisticsNote=el('div','Counts Busy starts detected while this assistant is open. Hidden or closed periods may leave gaps.',statisticsBody,'statistics-note');
  const banner = el('div', '', content, 'alert hidden');
  const message = el('div', '', banner);
  const dismiss = el('button', 'Dismiss', banner);
  const controls = el('div', '', normalView, 'controls');
  const pause = el('button', 'Pause', controls);
  const settingsButton = el('button', 'Settings', controls);
  const soundPanel = el('section', '', panel, 'menu-view sound-settings hidden');
  const settingsPanel = el('section', '', panel, 'menu-view assistant-settings hidden');
  const soundHeader = el('div', '', soundPanel, 'menu-header');
  el('h3', 'Sound Settings', soundHeader);
  const soundBack = el('button', 'Back', soundHeader);
  const settingsHeader = el('div', '', settingsPanel, 'menu-header');
  el('h3', 'Assistant Settings', settingsHeader);
  const settingsBack = el('button', 'Back', settingsHeader);
  doc.body.append(host);
  let running = true, destroyed = false, audio = null, notificationRequested = false;
  let bannerKind = '', lastScan = Date.now(), unavailable = false;
  let activeView = QUEUES.length?'main':'settings';
  let activeReminder = null;
  const PREFERENCES_KEY = 'service-desk-8x8-preferences-v5';
  let preferences = {};
  try {
    const value=JSON.parse(root.localStorage.getItem(PREFERENCES_KEY) || '{}');
    if (value && typeof value === 'object' && !Array.isArray(value)) preferences=value;
  } catch {}
  const selected = new Set(Array.isArray(preferences.g1)
    ? preferences.g1.filter(name=>typeof name==='string' && name.trim()) : []);
  let lunchMinutes=Number.isFinite(preferences.lunchMinutes)
    ? Math.max(1,Math.min(120,Math.round(preferences.lunchMinutes))) : 30;
  const settingNumber=(value,fallback,min,max)=>Number.isFinite(value)
    ? Math.max(min,Math.min(max,Math.round(value))) : fallback;
  let dispositionSeconds=settingNumber(preferences.dispositionSeconds,10,1,120);
  let callMinutes=settingNumber(preferences.callMinutes,2,1,30);
  let coverMinutes=settingNumber(preferences.coverMinutes,3,1,60);
  let desktopNotifications=typeof preferences.desktopNotifications==='boolean' ? preferences.desktopNotifications : true;
  const soundsCard=el('div','',settingsPanel,'settings-card');
  el('h4','Sound Settings',soundsCard);
  el('p','Choose the sound, volume, duration and repeat option for each reminder.',soundsCard,'settings-description');
  el('button','Open Sound Settings',soundsCard).onclick=()=>openView('sounds');
  const queuesCard=el('div','',settingsPanel,'settings-card');
  el('h4','Inbound Queue Names',queuesCard);
  el('p','Enter the exact names of the three inbound queues to monitor. These names are stored only in this browser. Do not include an outbound queue.',queuesCard,'settings-description');
  const queueInputs=[0,1,2].map(index=>{
    const label=el('label',`Queue ${index+1}`,queuesCard,'sound-field');
    const input=el('input','',label);input.type='text';input.value=QUEUES[index] || '';
    input.setAttribute('aria-label',`Inbound queue ${index+1}`);return input;
  });
  const queueError=el('p',QUEUES.length?'':'Enter three queue names to start monitoring.',queuesCard,'small');
  for (const input of queueInputs) input.onchange=()=>{
    const names=queueInputs.map(field=>clean(field.value));
    if (!validQueueNames(names)) {queueError.textContent='Enter three different queue names.';return;}
    QUEUES=names;root.__serviceDesk8x8Queues=[...names];
    try {root.localStorage.setItem(QUEUE_CONFIG_KEY,JSON.stringify(names));} catch {}
    queueError.textContent='';reset();safeScan();
  };
  const lunchPanel = el('div', '', settingsPanel, 'settings-card lunch-settings');
  el('h4', 'Lunch Break Length', lunchPanel);
  el('p', 'Length of my lunch break. Only relevant when you are in G1.', lunchPanel, 'settings-description');
  const lunchLabel=el('label', '', lunchPanel);
  lunchLabel.setAttribute('aria-label', 'Lunch break length in minutes');
  const lunchRow=el('span', '', lunchLabel, 'volume-control');
  const lunchSlider=el('input', '', lunchRow);
  lunchSlider.type='range';lunchSlider.min='1';lunchSlider.max='120';lunchSlider.step='1';
  lunchSlider.id='its-my-lunch-minutes';lunchSlider.setAttribute('aria-label','Lunch break length in minutes');
  const lunchValue=el('span', '', lunchRow, 'volume-value lunch-value');
  const lunchLimits=el('div', '', lunchPanel, 'small lunch-limits');
  el('span', '1 minute', lunchLimits);el('span', '2 hours', lunchLimits);
  lunchSlider.value=String(lunchMinutes);
  lunchValue.textContent=`${lunchMinutes} min`;
  const savePreferences=()=>{
    try {root.localStorage.setItem(PREFERENCES_KEY,JSON.stringify({g1:[...selected],lunchMinutes,
      dispositionSeconds,callMinutes,coverMinutes,desktopNotifications}));} catch {}
  };
  const STATISTICS_KEY='service-desk-8x8-statistics-v1';
  const STATISTICS_ZONE='Australia/Brisbane';
  function dayKey(time) {
    const parts=new Intl.DateTimeFormat('en-AU',{timeZone:STATISTICS_ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(time));
    const part=name=>parts.find(p=>p.type===name).value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  }
  let statistics={day:dayKey(Date.now()),calls:[],hadGaps:false,lastPresence:null};
  try {
    const value=JSON.parse(root.localStorage.getItem(STATISTICS_KEY) || '{}');
    if (value && typeof value==='object') {
      if (value.day===statistics.day && Array.isArray(value.calls)) {
        statistics.calls=value.calls.filter(time=>Number.isFinite(time) && time<=Date.now() && dayKey(time)===statistics.day);
        statistics.hadGaps=value.hadGaps===true;
      }
      const last=value.lastPresence;
      if (last && typeof last.status==='string' && Number.isFinite(last.seenAt)) {
        statistics.lastPresence={status:normal(last.status),seenAt:last.seenAt};
      }
    }
  } catch {}
  let lastStatisticsSave=0;
  function saveStatistics() {
    try {root.localStorage.setItem(STATISTICS_KEY,JSON.stringify(statistics));lastStatisticsSave=Date.now();} catch {}
  }
  function renderStatistics() {
    setText(callTotal,String(statistics.calls.length));
    if (!running) return;
    const now=Date.now();
    setText(callsHour,String(statistics.calls.filter(time=>time>=now-3600000).length));
    const latest=statistics.calls.at(-1);
    setText(lastCall,latest===undefined?'—':new Date(latest).toLocaleTimeString('en-AU',
      {timeZone:STATISTICS_ZONE,hour:'2-digit',minute:'2-digit'}));
    setText(statisticsNote,statistics.hadGaps
      ? 'Some of your status updates were unreadable today. This call total may be incomplete.'
      : 'Counts Busy starts detected while this assistant is open. Hidden or closed periods may leave gaps.');
  }
  function countCalls(docs) {
    const now=Date.now(),today=dayKey(now);
    let changed=false;
    if (statistics.day!==today) {statistics.day=today;statistics.calls=[];statistics.hadGaps=false;changed=true;}
    const presence=readCounterPresence(docs),old=statistics.lastPresence;
    if (!presence) {
      if (!statistics.hadGaps) {statistics.hadGaps=true;changed=true;}
    } else {
      const status=normal(presence.status),wasBusy=old?.status==='busy',busy=status==='busy';
      // Preserve the last presence through hidden periods. An unknown sample is
      // never treated as leaving Busy, preventing duplicate counts on recovery.
      // Timer resets alone are not proof of another call. Do not infer calls
      // from missing data or from a timer changing during post-processing.
      const newCall=busy && !wasBusy;
      if (newCall) {statistics.calls.push(now);changed=true;}
      if (!old || status!==old.status) changed=true;
      statistics.lastPresence={status,seenAt:now};
    }
    if (changed || now-lastStatisticsSave>=15000) saveStatistics();
    renderStatistics();
  }
  const knownAgents = new Map(), agentWidgets = new Map(), freshness = new Map(), previous = new Map();
  const callLatched = new Set(), lunchLatched = new Set();
  const notices = new Map(), observers = new Map(), interactionDocs = new Set();
  let lastSample = null;
  const setText = (n, text) => { if (n.textContent !== text) n.textContent = text; };
  function refreshAgents(docs) {
    const current = new Map();
    const me = readMe(docs);
    knownAgents.set('Me', true);
    if (me) current.set('Me', me);
    for (const row of agentRows(docs)) {
      const name = agentName(row);
      if (!name) continue;
      const status = clean(row.querySelector('[data-status-value]')?.getAttribute('data-status-value'));
      const timer = clean(row.querySelector('[data-test-id="user-presence-timer"]')?.textContent);
      current.set(name, {name, status, timer, seconds:duration(timer)});
      knownAgents.set(name, true);
    }
    for (const name of [...knownAgents.keys()].sort((a,b) => a === 'Me' ? -1 : b === 'Me' ? 1 : a.localeCompare(b))) {
      let widget = agentWidgets.get(name);
      if (!widget) {
        const row = el('tr', '', agentList);
        if (name==='Me') row.classList.add('me-row');
        el('td', name, row, 'agent-name');
        const statusCell=el('td', '', row);
        const state=el('span', '', statusCell, 'agent-status');
        const timer=el('td', '', row, 'agent-time');
        const selectionCell = el('td', '', row);
        const box = el('input', '', selectionCell);
        box.type = 'checkbox'; box.checked = selected.has(name);
        box.setAttribute('aria-label', 'G1: ' + name);
        widget = {row, box, state, timer}; agentWidgets.set(name, widget);
        box.onchange = () => {
          if (box.checked) selected.add(name); else selected.delete(name);
          savePreferences();reset();safeScan();
        };
      }
      const a = current.get(name);
      setText(widget.state, a?.status || 'Not currently loaded'); setText(widget.timer, a?.timer || '—');
      widget.state.setAttribute('data-state',normal(a?.status));
      agentList.append(widget.row);
    }
    return current;
  }
  function showUnavailable(value) {
    unavailable = value;
    syncViews();
    unavailableBox.classList.toggle('hidden', !value);
    if (value) {
      stopSound('preview');
      reset();
    }
  }
  function syncViews() {
    normalView.classList.toggle('hidden',unavailable || activeView!=='main');
    soundPanel.classList.toggle('hidden',unavailable || activeView!=='sounds');
    settingsPanel.classList.toggle('hidden',unavailable || activeView!=='settings');
  }
  function openView(view) {
    if (activeView==='sounds' && view!=='sounds') stopSound('preview');
    activeView=view;syncViews();panel.scrollTop=0;
  }
  settingsButton.onclick=()=>openView('settings');
  soundBack.onclick=()=>openView('settings');
  settingsBack.onclick=()=>openView('main');
  function prepareSound() {
    if (!running || destroyed) return;
    try {
      const C = root.AudioContext || root.webkitAudioContext;
      if (C) audio ||= new C();
      if (audio && audio.state !== 'running') audio.resume().catch(() => {});
    } catch (e) {console.warn('Service Desk 8x8 Assistant sound:', e.message);}
  }
  function enableAlerts(event) {
    if (!event?.isTrusted || destroyed || !running) return;
    prepareSound();
    if (desktopNotifications && 'Notification' in root && root.Notification.permission === 'default' && !notificationRequested) {
      notificationRequested = true;
      root.Notification.requestPermission().catch(e => console.warn('Service Desk 8x8 Assistant notifications:', e.message));
    }
  }
  // All sounds are generated locally: no downloaded audio or network requests.
  const PRESETS = {
    'Gentle chime': {notes:[523,659,784], wave:'sine', pace:.32},
    'Soft bell': {notes:[880,1320], wave:'sine', pace:.5},
    'Ascending chime': {notes:[440,554,659,880], wave:'sine', pace:.25},
    'Descending chime': {notes:[880,659,554,440], wave:'sine', pace:.25},
    'Doorbell': {notes:[660,520], wave:'sine', pace:.6},
    'Double ping': {notes:[1047,1047], wave:'sine', pace:.25},
    'Triple beep': {notes:[880,660,880], wave:'triangle', pace:.27},
    'Low pulse': {notes:[220,220,330], wave:'triangle', pace:.4},
    'Radar': {notes:[1200,0,1200,0], wave:'sine', pace:.2},
    'Digital ring': {notes:[740,988,740,988], wave:'square', pace:.15},
    'Urgent pulse': {notes:[1000,0,1000,0,1000], wave:'square', pace:.18},
    'Two-tone alarm': {notes:[880,660,880,660], wave:'square', pace:.3},
    'Fast alarm': {notes:[1200,800,1200,800], wave:'square', pace:.16},
    'High alert': {notes:[1500,1000,1500], wave:'triangle', pace:.2},
    'Warning buzzer': {notes:[180,240,180,240], wave:'sawtooth', pace:.3},
    'Rising siren': {notes:[400,600,800,1000,1200], wave:'triangle', pace:.18}
  };
  const definitions = {
    lunch: {label:'Info: G1 On Break', description:()=>[
      'Plays when someone you have ticked in G1 is "On Break". This includes someone already on break when monitoring starts.',
      'Plays only when you are in G2. Silent while the Change Status To Available alert is active.'
    ], preset:'Gentle chime', volume:45, seconds:2, repeat:false},
    call: {label:'Info: Caller Waiting', description:()=>[
      `Plays when a caller is waiting in a monitored queue and at least one G1 member has been "Busy" for more than ${timeWords(callMinutes,'minute')}.`,
      'Plays only when you are in G2. Silent while the Change Status To Available alert is active.'
    ], preset:'Triple beep', volume:65, seconds:3, repeat:false},
    critical: {label:'Alert: Change Status To Available', description:()=>[
      'If you are in G1: plays when your status is neither "Available" nor "Busy", unless you are on lunch or in disposition. Lunch and disposition have their own reminders below.',
      'If you are in G2: plays when you are not "Available" and either of these situations applies:',
      [
        'No other agent currently shown in 8x8’s Groups list is "Available" or "Busy".',
        `A caller is waiting and every G1 member has been "Busy" for at least ${timeWords(coverMinutes,'minute')}.`
      ],
      'Stops when you become "Available" or the situation above ends.'
    ], preset:'Two-tone alarm', volume:100, seconds:10, repeat:true},
    disposition: {label:'Alert: Complete Disposition', description:()=>[
      `Plays only when you have ticked "Me" in G1 and you spend more than ${timeWords(dispositionSeconds,'second')} in disposition.`,
      'Disposition is the step after a call where you complete the call details and click "Wrap up". The sound stops when you leave this step.'
    ], preset:'Urgent pulse', volume:80, seconds:10, repeat:true},
    lunchOverdue: {label:'Alert: Lunch Break Finished', description:()=>[
      `Plays only when you have ticked "Me" in G1 and your "On Break" time is longer than your lunch length in Assistant Settings (currently ${timeWords(lunchMinutes,'minute')}).`,
      'Reminds you to return to "Available". Stops when you leave "On Break".'
    ], preset:'Digital ring', volume:85, seconds:10, repeat:true}
  };
  function timeWords(value,unit) {return `${value} ${unit}${value===1?'':'s'}`;}
  const SOUND_KEY = 'service-desk-8x8-sounds-v4';
  let saved = {};
  try {
    const value=JSON.parse(root.localStorage.getItem(SOUND_KEY) || '{}');
    if (value && typeof value === 'object' && !Array.isArray(value)) saved=value;
  } catch {}
  const soundSettings = {};
  for (const [kind,d] of Object.entries(definitions)) {
    const v = saved[kind] || {};
    soundSettings[kind] = {preset:PRESETS[v.preset] ? v.preset : d.preset,
      volume:Number.isFinite(v.volume) ? Math.max(0,Math.min(100,v.volume)) : d.volume,
      seconds:Number.isFinite(v.seconds) ? Math.max(1,Math.min(120,v.seconds)) : d.seconds,
      repeat:typeof v.repeat === 'boolean' ? v.repeat : d.repeat};
  }
  const sounds = new Map();
  function stopSound(kind) {
    const job = sounds.get(kind); if (!job) return;
    root.clearInterval(job.interval); root.clearTimeout(job.timeout);
    for (const osc of job.nodes) {try {osc.stop();} catch {}}
    sounds.delete(kind);
  }
  function beep(kind, preview = false) {
    if (!running || destroyed || audio?.state !== 'running') return;
    const key = preview ? 'preview' : kind;
    stopSound(key);
    const cfg = {...soundSettings[kind]}, preset = PRESETS[cfg.preset];
    const job = {nodes:new Set(), interval:null, timeout:null}; sounds.set(key,job);
    const start = Date.now();
    const total = preview ? Math.min(3,cfg.seconds) : cfg.seconds;
    const endless = cfg.repeat && !preview;
    const cycle = () => {
      if (sounds.get(key) !== job) return;
      const remaining = endless ? Infinity : total - (Date.now()-start)/1000;
      if (remaining <= 0) {stopSound(key);return;}
      preset.notes.forEach((hz,i) => {
        const offset = i*preset.pace;
        if (!hz || offset >= remaining) return;
        const osc = audio.createOscillator(), gain = audio.createGain();
        const t = audio.currentTime+offset, len = Math.min(preset.pace*.8,remaining-offset);
        osc.type=preset.wave;osc.frequency.value=hz;
        gain.gain.setValueAtTime(0,t);
        gain.gain.linearRampToValueAtTime(.3*cfg.volume/100,t+Math.min(.015,len/3));
        gain.gain.linearRampToValueAtTime(0,t+len);
        osc.connect(gain);gain.connect(audio.destination);job.nodes.add(osc);
        osc.start(t);osc.stop(t+len+.01);
        osc.onended=()=>{job.nodes.delete(osc);osc.disconnect();gain.disconnect();};
      });
    };
    cycle();
    job.interval=root.setInterval(cycle,Math.max(250,preset.notes.length*preset.pace*1000));
    if (!endless) job.timeout=root.setTimeout(()=>stopSound(key),total*1000);
  }
  const saveSounds = () => {try {root.localStorage.setItem(SOUND_KEY,JSON.stringify(soundSettings));} catch {}};
  el('div','G1 means the people covering phones. Anyone not ticked in G1 is in G2. The explanations below use your current Assistant Settings. With Repeat ticked, a sound keeps playing until the situation described below ends. Otherwise, it plays for the chosen duration. Volume depends on your computer’s volume.',soundPanel,'small sound-intro');
  const soundDescriptions=new Map();
  const previewButtons=[];
  function refreshSoundDescriptions() {
    for (const [kind,parent] of soundDescriptions) {
      parent.textContent='';
      for (const part of definitions[kind].description()) {
        if (Array.isArray(part)) {
          const list=el('ul','',parent);for (const text of part) el('li',text,list);
        } else el('p',part,parent);
      }
    }
  }
  for (const [kind,d] of Object.entries(definitions)) {
    const section=el('fieldset','',soundPanel,'sound-category');el('legend',d.label,section);
    soundDescriptions.set(kind,el('div','',section,'small sound-description'));
    const choice=el('select','',el('label','Sound type',section,'sound-field'));
    for (const name of Object.keys(PRESETS)) {const option=el('option',name,choice);option.value=name;}
    choice.value=soundSettings[kind].preset;
    const volumeLabel=el('label','Volume',section,'sound-field');
    const volumeRow=el('span','',volumeLabel,'volume-control');
    const volume=el('input','',volumeRow);
    volume.type='range';volume.min=0;volume.max=100;volume.value=soundSettings[kind].volume;
    const value=el('span',volume.value+'%',volumeRow,'volume-value');
    const durationLabel=el('label','Duration (seconds, 1–120)',section,'sound-field');
    const seconds=el('input','',durationLabel);
    seconds.type='number';seconds.min=1;seconds.max=120;seconds.value=soundSettings[kind].seconds;
    const repeatLabel=el('label','',section,'repeat-control'), repeat=el('input','',repeatLabel);
    repeat.type='checkbox';repeat.checked=soundSettings[kind].repeat;
    repeatLabel.append(doc.createTextNode('Repeat until condition clears'));
    const syncDuration=()=>{
      seconds.disabled=repeat.checked;
      durationLabel.classList.toggle('disabled',repeat.checked);
    };
    syncDuration();
    const update=()=>{
      soundSettings[kind]={preset:choice.value,volume:Number(volume.value),seconds:Math.max(1,Math.min(120,Number(seconds.value)||1)),repeat:repeat.checked};
      value.textContent=volume.value+'%';syncDuration();saveSounds();
      const active=sounds.has(kind);stopSound(kind);stopSound('preview');
      if (active) beep(kind);
    };
    choice.onchange=update;volume.oninput=update;seconds.onchange=update;repeat.onchange=update;
    const preview=el('button','Preview',section);previewButtons.push(preview);
    preview.onclick=()=>{prepareSound();beep(kind,true);};
  }
  refreshSoundDescriptions();
  const soundActions=el('div','',soundPanel,'sound-actions');
  el('button','Stop preview',soundActions).onclick=()=>stopSound('preview');
  function applyTimingSettings() {
    savePreferences();refreshSoundDescriptions();
    safeScan();
  }
  function timingSetting(title,description,id,value,min,max,unit,assign) {
    const card=el('div','',settingsPanel,'settings-card');
    el('h4',title,card);el('p',description,card,'settings-description');
    const label=el('label','',card,'setting-value');
    const input=el('input','',label);input.type='number';input.min=String(min);input.max=String(max);input.step='1';
    input.id=id;input.value=String(value);input.setAttribute('aria-label',title+' in '+unit);
    el('span',unit,label);
    input.onchange=()=>{
      const number=settingNumber(Number(input.value),value,min,max);
      input.value=String(number);assign(number);applyTimingSettings();
    };
    return input;
  }
  timingSetting('Disposition Reminder Delay',
    'Time allowed to finish the call details and click "Wrap up" before the reminder plays. Only relevant when you are in G1.',
    'its-disposition-seconds',dispositionSeconds,1,120,'seconds',number=>{dispositionSeconds=number;});
  timingSetting('Caller Waiting Delay',
    'Busy time needed before the Caller Waiting sound can play. Only used when you are in G2 and a caller is waiting in a queue.',
    'its-call-minutes',callMinutes,1,30,'minutes',number=>{callMinutes=number;});
  timingSetting('Extra Phone Cover Delay',
    'Busy time needed for every G1 member before the urgent Available alert can play. Only used when you are in G2, are not Available, and a caller is waiting.',
    'its-cover-minutes',coverMinutes,1,60,'minutes',number=>{coverMinutes=number;});
  const desktopCard=el('div','',settingsPanel,'settings-card');
  el('h4','Desktop Notifications',desktopCard);
  el('p','Show desktop notifications for alerts. Sounds and messages in the assistant still work when this is off.',desktopCard,'settings-description');
  const desktopLabel=el('label','',desktopCard,'repeat-control');
  const desktopToggle=el('input','',desktopLabel);desktopToggle.type='checkbox';desktopToggle.checked=desktopNotifications;
  desktopToggle.id='its-desktop-notifications';desktopLabel.append(doc.createTextNode('Show desktop notifications'));
  desktopToggle.onchange=event=>{
    desktopNotifications=desktopToggle.checked;savePreferences();
    if (!desktopNotifications) {for (const notice of notices.values()) notice.close();notices.clear();}
    else enableAlerts(event);
  };
  function notify(kind, title, body) {
    if (!running || destroyed) return;
    bannerKind = kind; message.textContent = `${title}\n${body}`; banner.classList.remove('hidden');
    try { beep(kind); } catch {}
    if (desktopNotifications && 'Notification' in root && root.Notification.permission === 'granted') {
      try {
        notices.get(kind)?.close();
        const n = new root.Notification(title, {body, tag:`its-call-assist-${kind}`, requireInteraction:true});
        notices.set(kind,n); n.onclick = () => {root.focus(); n.close();};
      } catch(e) { console.warn('Service Desk 8x8 Assistant notification:', e.message); }
    }
  }
  function clearAlert(kind) {
    stopSound(kind);
    notices.get(kind)?.close(); notices.delete(kind);
    if (bannerKind === kind) {banner.classList.add('hidden');bannerKind='';}
  }
  function reset() {
    callLatched.clear(); lunchLatched.clear(); freshness.clear(); previous.clear();
    activeReminder=null;
    for (const k of ['call','lunch','critical','disposition','lunchOverdue']) clearAlert(k);
    banner.classList.add('hidden');
  }
  function syncReminder(reminder) {
    if (activeReminder && activeReminder.kind !== reminder?.kind) {
      clearAlert(activeReminder.kind);activeReminder=null;
    }
    if (!reminder) return;
    if (!activeReminder) {
      activeReminder=reminder;notify(reminder.kind,reminder.title,reminder.body);
    } else {
      activeReminder=reminder;
      if (bannerKind===reminder.kind) setText(message,`${reminder.title}\n${reminder.body}`);
      if (!sounds.has(reminder.kind) && soundSettings[reminder.kind].repeat) beep(reminder.kind);
    }
  }
  lunchSlider.oninput=()=>{
    lunchMinutes=Math.max(1,Math.min(120,Math.round(Number(lunchSlider.value)||30)));
    lunchValue.textContent=`${lunchMinutes} min`;savePreferences();refreshSoundDescriptions();
    safeScan();
  };
  function scan(docs) {
    if (destroyed || !running) return;
    const now = Date.now(), gap = now - lastScan; lastScan = now;
    for (const [d,o] of observers) if (!docs.includes(d)) {o.disconnect();observers.delete(d);}
    for (const d of docs) if (!observers.has(d) && d.body) {
      const o = new root.MutationObserver(safeScan);
      o.observe(d.body, {subtree:true,childList:true,characterData:true,attributes:true,
        attributeFilter:['data-status-value','aria-label','title','hidden','style','class']});
      observers.set(d,o);
    }
    for (const d of [...interactionDocs]) if (!docs.includes(d)) {
      d.removeEventListener('pointerdown', enableAlerts, true); d.removeEventListener('keydown', enableAlerts, true); interactionDocs.delete(d);
    }
    for (const d of docs) if (!interactionDocs.has(d)) {
      d.addEventListener('pointerdown', enableAlerts, true); d.addEventListener('keydown', enableAlerts, true); interactionDocs.add(d);
    }
    const current = refreshAgents(docs);
    const selfInG1=selected.has('Me');
    const sample = read(docs, selected.values().next().value || [...current.keys()].find(name => name !== 'Me') || '');
    const samples = [...selected].map(name => read(docs, name));
    const agents = samples.map(s => s.agent).filter(Boolean);
    const missing = !current.has('Me') || !agentRows(docs).length || sample.errors.length > 0 || samples.some(s => s.errors.length);
    lastSample = {me:current.get('Me') || null, agents, queues:sample.queues, selected:[...selected],
      mode:selfInG1?'covering':'assisting',lunchMinutes,dispositionSeconds,callMinutes,coverMinutes,
      desktopNotifications,unavailable:!!missing};
    if (missing) {
      showUnavailable(true); freshness.clear(); return;
    }
    showUnavailable(false);
    if (gap > 30000) freshness.clear();
    let fresh = true;
    for (const a of selfInG1 ? [current.get('Me')] : agents) {
      const signature = `${a.status}|${a.timer}`;
      let f = freshness.get(a.name);
      if (!f) f = {signature, changedAt:now, observed:false};
      else if (f.signature !== signature) f = {signature, changedAt:now, observed:true};
      freshness.set(a.name, f);
      if (!f.observed || now - f.changedAt >= 30000) fresh = false;
    }
    const offline = root.navigator.onLine === false;
    const heading = !selected.size ? 'Select at least one G1 agent' : !running ? 'PAUSED' : offline ? 'Waiting for network connection' : !fresh ? 'Waiting for live G1 timer updates' : 'MONITORING';
    setText(statusBox, heading + '\n' + sample.queues.map(q => `${q.name}: ${q.waiting} waiting`).join('\n') + '\nChecked: ' + new Date().toLocaleTimeString());
    if (!running || !fresh || offline) {
      clearAlert('call');clearAlert('lunch');syncReminder(null);return;
    }
    for (const a of agents) {
      const old = previous.get(a.name);
      if (old && (normal(old.status) !== normal(a.status) || a.seconds < old.seconds)) {
        callLatched.delete(a.name); lunchLatched.delete(a.name);
        if (a.name==='Me') syncReminder(null);
      }
      previous.set(a.name, a);
    }
    if (selfInG1) {
      clearAlert('call');clearAlert('lunch');callLatched.clear();lunchLatched.clear();
      syncReminder(personalRule(current.get('Me'),lunchMinutes,dispositionSeconds));
      return;
    }
    const others = [...current.values()].filter(a => a.name !== 'Me');
    const me = current.get('Me');
    const usableOthers = others.length > 0 && others.every(a => a.status && a.seconds !== null);
    // Confirm timer updates for Me and all loaded agents before making coverage claims.
    let coverageFresh = usableOthers;
    for (const a of [me,...others]) {
      const key = 'coverage:'+a.name, signature = a.status+'|'+a.timer;
      let f=freshness.get(key);
      if (!f) f={signature,changedAt:now,observed:false};
      else if (f.signature!==signature) f={signature,changedAt:now,observed:true};
      freshness.set(key,f);
      if (!f.observed || now-f.changedAt>=30000) coverageFresh=false;
    }
    const decision = groupRules(agents, sample.queues, others, me,{callMinutes,coverMinutes});
    decision.critical = decision.critical && coverageFresh;
    if (decision.critical) {
      clearAlert('call');
      clearAlert('lunch');
      syncReminder({kind:'critical',title:'Alert: Change Status To Available',body:
        others.every(a => !['available','busy'].includes(normal(a.status)))
        ? 'No other loaded agent is Available or Busy. Change your status to Available.'
        : `Everyone in G1 is Busy for at least ${timeWords(coverMinutes,'minute')} and a caller is waiting. Change your status to Available.`});
    } else syncReminder(null);
    const newCalls = decision.call.filter(name => !callLatched.has(name));
    const newBreaks = decision.lunch.filter(name => !lunchLatched.has(name));
    for (const name of [...callLatched]) if (!decision.call.includes(name)) callLatched.delete(name);
    for (const name of [...lunchLatched]) if (!decision.lunch.includes(name)) lunchLatched.delete(name);
    if (!decision.call.length) clearAlert('call');
    if (!decision.lunch.length) clearAlert('lunch');
    if (newBreaks.length && !decision.critical) {
      notify('lunch','Info: G1 On Break',`${newBreaks.join(', ')}: On Break.`);
      newBreaks.forEach(name => lunchLatched.add(name));
    }
    if (newCalls.length && !decision.critical) {
      const details = agents.filter(a => newCalls.includes(a.name)).map(a => `${a.name}: ${a.timer}`).join('; ');
      const waiting = sample.queues.filter(q => q.waiting > 0).map(q => `${q.name}: ${q.waiting}`).join('; ');
      notify('call','Caller waiting — jump on the phones',`Busy — ${details}. Waiting — ${waiting}.`);
      newCalls.forEach(name => callLatched.add(name));
    }
  }
  function safeScan() {
    if (destroyed) return;
    try {
      const docs=documents();
      countCalls(docs);
      if (running) {
        if (!QUEUES.length) {showUnavailable(false);openView('settings');return;}
        scan(docs);
      }
    } catch(e) {
      if (running) showUnavailable(true);
      console.warn('Service Desk 8x8 Assistant:',e.message);
    }
  }
  pause.onclick = () => {
    running = !running;
    setText(pause, running ? 'Pause' : 'Resume');
    for (const preview of previewButtons) preview.disabled=!running;
    if (running) {freshness.clear();prepareSound();safeScan();}
    else {
      reset();stopSound('preview');saveStatistics();
      audio?.suspend?.().catch(()=>{});
      setText(statusBox,statusBox.textContent.replace(/^[^\n]*/,'PAUSED'));
    }
  };
  dismiss.onclick = () => {
    if (activeReminder?.kind===bannerKind) banner.classList.add('hidden');
    else if (bannerKind) clearAlert(bannerKind);
  };
  minimize.onclick = () => {
    content.classList.toggle('hidden');
    const collapsed=content.classList.contains('hidden');
    minimize.textContent=collapsed?'+':'-';
    minimize.title=collapsed?'Restore assistant':'Minimise assistant';
    minimize.setAttribute('aria-label',minimize.title);
  };
  function destroy() {
    saveStatistics();root.removeEventListener?.('pagehide',saveStatistics);
    destroyed=true;running=false;root.clearInterval(interval);
    for (const key of [...sounds.keys()]) stopSound(key);
    for (const o of observers.values()) o.disconnect();
    for (const n of notices.values()) n.close();
    for (const d of interactionDocs) {d.removeEventListener('pointerdown', enableAlerts, true);d.removeEventListener('keydown', enableAlerts, true);}
    audio?.close().catch(()=>{});host.remove();delete root.__itsCallAssist;
  }
  remove.onclick = destroy;
  const interval = root.setInterval(safeScan,2000);
  root.__itsCallAssist = {destroy, inspect:() => lastSample};
  root.__itsCallAssist.version=VERSION;
  root.__itsCallAssist.statistics=()=>({day:statistics.day,total:statistics.calls.length,calls:[...statistics.calls],hadGaps:statistics.hadGaps});
  root.addEventListener?.('pagehide',saveStatistics);
  prepareSound();safeScan();
})();
