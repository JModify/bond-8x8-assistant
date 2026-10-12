const fs = require('fs');
const vm = require('vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const file = path.join(__dirname,'..','Service-Desk-8x8-Assistant.js');
const original = fs.readFileSync(file, 'utf8');
let passed = 0;
function check(name, fn) { fn(); passed++; console.log('PASS:', name); }

// Minimal page fixture: the same status, timer and queue attributes 8x8 supplies.
// The production reader, UI handlers, rule logic and alert lifecycle all run.
function environment(preferences = {g1:['Me'], lunchMinutes:30}, sounds = {}, options = {}) {
  if(!options.rawPreferences)preferences={settingsVersion:3,dispositionSeconds:10,...preferences};
  let now = 100000, nextId = 0;
  const jobs = new Map(), notifications = [], storage = new Map([
    ['service-desk-8x8-preferences-v5',JSON.stringify(preferences)],
    ['service-desk-8x8-inbound-queues-v1',JSON.stringify(['Demo Academic Queue','Demo Transfer Queue','Demo Service Queue'])],
    ['service-desk-8x8-sounds-v4',JSON.stringify(sounds)]
  ]);
  let document;
  class Node {
    constructor(tag, text = '') {
      this.tagName=tag.toUpperCase();this.nodeType=tag==='#text'?3:1;
      this.ownerDocument=document;this.children=[];this.parentElement=null;
      this.attributes={};this.style={};this.className='';this._text=text;
      this.value='';this.checked=false;this.disabled=false;
      this.classList={
        contains:c=>this.className.split(/\s+/).includes(c),
        add:c=>this.classList.toggle(c,true),
        remove:c=>this.classList.toggle(c,false),
        toggle:(c,force)=>{
          const set=new Set(this.className.split(/\s+/).filter(Boolean));
          const value=force===undefined?!set.has(c):force;
          if(value)set.add(c);else set.delete(c);this.className=[...set].join(' ');return value;
        }
      };
    }
    set textContent(s){this._text=String(s);this.children=[];}
    get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}
    append(...nodes){for(const n of nodes){if(n.parentElement)n.parentElement.children=n.parentElement.children.filter(c=>c!==n);this.children.push(n);n.parentElement=this;n.ownerDocument=this.ownerDocument;}}
    setAttribute(k,v){this.attributes[k]=String(v);}
    getAttribute(k){return this.attributes[k]??(['type','id','title'].includes(k)?this[k]??null:null);}
    matches(selector){
      let tag=selector.match(/^[a-z][\w-]*/i)?.[0];if(tag&&tag.toUpperCase()!==this.tagName)return false;
      if(selector.startsWith('.'))return this.classList.contains(selector.slice(1));
      if(selector.startsWith('#'))return this.id===selector.slice(1);
      for(const m of selector.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)) {
        const value=this.getAttribute(m[1]);if(value===null||value===undefined||(m[2]!==undefined&&value!==m[2]))return false;
      }
      return true;
    }
    querySelectorAll(selector){
      const found=[];
      const visit=node=>{for(const c of node.children){if(c.nodeType===1&&selector.split(',').some(s=>c.matches(s.trim())))found.push(c);visit(c);}};
      visit(this);return found;
    }
    querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
    closest(selector){for(let n=this;n;n=n.parentElement)if(n.matches(selector))return n;return null;}
    getClientRects(){return this.hidden?[]:[{}];}
    addEventListener(){}removeEventListener(){}
    attachShadow(){this.shadowRoot=new Node('shadow-root');return this.shadowRoot;}
    remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(n=>n!==this);}
  }
  document={createElement:tag=>new Node(tag),createTextNode:t=>new Node('#text',t),
    querySelectorAll:s=>document.body.querySelectorAll(s),addEventListener(){},removeEventListener(){}};
  document.body=new Node('body');document.body.ownerDocument=document;
  const add=(tag,parent,attrs={},text='')=>{
    const node=new Node(tag,text);for(const[k,v]of Object.entries(attrs))node.setAttribute(k,v);parent.append(node);return node;
  };
  const header=add('span',document.body);
  const meStatus=add('div',header,{'data-test-id':'user-status','data-status-value':'Available'});
  const timerWrapper=add('span',header);
  const meTimer=add('div',timerWrapper,{'data-test-id':'user-presence-timer'},'0s');
  const group=add('div',document.body,{'data-test-id':'virtuoso-item-list'});
  const agents={};
  function login(name,statusLabel='Available',seconds=0) {
    const row=add('div',group,{'data-test-id':'agent-item','aria-label':name});
    add('span',row,{'data-test-id':'agent-name-label',title:name},name);
    const status=add('div',row,{'data-status-value':statusLabel});
    const timer=add('div',row,{'data-test-id':'user-presence-timer'},seconds+'s');
    agents[name]={row,status,timer};
  }
  for(const name of ['Alex Agent','Casey Agent'])login(name);
  const queues=[];
  for(const name of ['Demo Academic Queue','Demo Transfer Queue','Demo Outbound Queue','Demo Service Queue']){
    const row=add('div',document.body,{'data-test-id':'queue-item'});
    add('span',row,{'data-test-id':'queue-name',title:name},name);
    const cell=add('span',row,{role:'gridcell',title:'0 Interactions waiting'},'0');
    const wait=add('span',row,{role:'gridcell',title:'0 minutes 0 seconds Longest waiting time'},'0m 0s');
    queues.push({row,cell,wait});
  }
  const schedule=(fn,ms)=>{const id=++nextId;jobs.set(id,{fn,ms});return id;};
  const audioContexts=[];
  class AudioContext {
    constructor(){this.state='running';this.currentTime=0;this.destination={};this.sinkId='';audioContexts.push(this);}
    async setSinkId(id){
      if(options.beforeSink)await options.beforeSink(id);
      if(options.rejectOutput===id)throw Error('NotAllowedError');
      if(id && !devices.some(d=>d.kind==='audiooutput'&&d.deviceId===id))throw Error('NotFoundError');
      this.sinkId=id;
    }
    resume(){this.state='running';return Promise.resolve();}close(){this.state='closed';return Promise.resolve();}
    createOscillator(){return{frequency:{value:0},connect(){},disconnect(){},start(){},stop(){}};}
    createGain(){return{gain:{setValueAtTime(){},linearRampToValueAtTime(){}},connect(){},disconnect(){}};}
  }
  class Notification {
    static permission='granted';
    constructor(title,options){this.title=title;this.options=options;this.closed=false;notifications.push(this);}
    close(){this.closed=true;}
  }
  if(options.noOutputSelection)delete AudioContext.prototype.setSinkId;
  const devices=options.devices || [
    {kind:'audiooutput',deviceId:'default',label:'Default - Desk Speakers'},
    {kind:'audiooutput',deviceId:'speakers',label:'Desk Speakers'},
    {kind:'audiooutput',deviceId:'headset',label:'Support Headset'},
    {kind:'audioinput',deviceId:'default',label:'Default - Desk Microphone'}
  ];
  const deviceListeners=new Set();let microphoneRequests=0;
  const mediaDevices={
    enumerateDevices:async()=>{if(options.enumerationFails)throw Error('NotAllowedError');return devices;},
    getUserMedia:async()=>{microphoneRequests++;throw Error('Unexpected microphone capture');},
    addEventListener:(name,fn)=>{if(name==='devicechange')deviceListeners.add(fn);},
    removeEventListener:(name,fn)=>{if(name==='devicechange')deviceListeners.delete(fn);}
  };
  if(options.outputPicker)mediaDevices.selectAudioOutput=async()=>({kind:'audiooutput',deviceId:'headset',label:'Support Headset'});
  const window={document,location:{hostname:'vcc-au2.8x8.com',origin:'https://vcc-au2.8x8.com'},
    navigator:{onLine:true,mediaDevices},AudioContext,Notification,
    localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)},
    setInterval:schedule,setTimeout:schedule,clearInterval:id=>jobs.delete(id),clearTimeout:id=>jobs.delete(id),
    getComputedStyle:n=>({display:n.classList.contains('hidden')?'none':'block',visibility:'visible'}),
    MutationObserver:class{observe(){}disconnect(){}},focus(){}};
  window.top=window;document.defaultView=window;
  class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  const source=original.replace('root.__itsCallAssist = {destroy, inspect:() => lastSample};',
    'root.__itsCallAssist = {destroy, inspect:() => lastSample, debug:()=>({activeReminder,playing:[...sounds.keys()],muted,audioOutput:audio?.sinkId}), rescan:safeScan};');
  vm.runInNewContext(source,{window,location:window.location,Date:Clock,console},{timeout:1000});
  const ui=()=>document.body.querySelector('#its-call-assist-panel').shadowRoot;
  const scan=()=>{now+=2000;window.__itsCallAssist.rescan();};
  const setMe=(status,seconds)=>{meStatus.setAttribute('data-status-value',status);meTimer.textContent=seconds+'s';scan();};
  const other=(name,status,seconds)=>{agents[name].status.setAttribute('data-status-value',status);agents[name].timer.textContent=seconds+'s';};
  const clock=seconds=>{
    const s=String(seconds%60).padStart(2,'0'),m=Math.floor(seconds/60);
    return m>=60?`${Math.floor(m/60)}:${String(m%60).padStart(2,'0')}:${s}`:`${String(m).padStart(2,'0')}:${s}`;
  };
  let personalPage=null,breakTimer=null,wrapTimer=null;
  function hideMain() {header.hidden=true;group.hidden=true;for(const q of queues)q.row.hidden=true;personalPage?.remove();}
  function showBreak(seconds) {
    hideMain();personalPage=add('div',document.body);
    add('h1',personalPage,{'aria-describedby':'timeCounter'},'On Break for:');
    const wrapper=add('div',personalPage);
    breakTimer=add('div',wrapper,{id:'timeCounter',role:'timer','data-test-id':'on-break-timer'},clock(seconds));
    add('span',personalPage,{title:'Lunch'},'Lunch');scan();
  }
  function showWrapUp(remaining) {
    hideMain();personalPage=add('article',document.body,{'data-test-id':'phone-card-test-id'});
    add('div',personalPage,{'data-test-id':'wrap-up-label'},'Wrap up');
    add('div',personalPage,{'data-test-id':'interaction-time-label',role:'timer','aria-label':'42 minutes 0 seconds'},'42:00');
    wrapTimer=add('div',personalPage,{'data-test-id':'progress-timer',role:'timer','aria-label':'Wrap up'},clock(remaining));scan();
  }
  function restoreMain(status='Available',seconds=0) {
    personalPage?.remove();personalPage=null;header.hidden=false;group.hidden=false;
    for(const q of queues)q.row.hidden=false;setMe(status,seconds);
  }
  const waiting=(n,seconds=0,index=3)=>{
    const q=queues[index];q.cell.textContent=String(n);q.cell.setAttribute('title',`${n} Interactions waiting`);
    q.wait.textContent=`${Math.floor(seconds/60)}m ${seconds%60}s`;
    q.wait.setAttribute('title',`${Math.floor(seconds/60)} minutes ${seconds%60} seconds Longest waiting time`);
  };
  return {window,ui,scan,setMe,other,jobs,storage,notifications,queues,group,header,meTimer,meStatus,
    login,logout:name=>agents[name].row.remove(),agents,
    audioContexts,devices,deviceListeners,microphoneRequests:()=>microphoneRequests,
    deviceChanged:()=>{for(const fn of deviceListeners)fn();},
    showBreak,showWrapUp,restoreMain,
    breakTime:seconds=>{breakTimer.textContent=clock(seconds);scan();},
    wrapTime:remaining=>{wrapTimer.textContent=clock(remaining);scan();},
    personalPage:()=>personalPage,
    setTime:time=>{now=time;},advance:ms=>{now+=ms;window.__itsCallAssist.rescan();},
    rerun:()=>vm.runInNewContext(source,{window,location:window.location,Date:Clock,console},{timeout:1000}),
    debug:()=>window.__itsCallAssist.debug(),
    checkbox:name=>ui().querySelector(`[aria-label="G1: ${name}"]`),
    button:name=>ui().querySelectorAll('button').find(n=>n.textContent===name),
    waiting,
    tick:(name,value)=>{const b=ui().querySelector(`[aria-label="G1: ${name}"]`);b.checked=value;b.onchange();},
    lunch:minutes=>{const input=ui().querySelector('#its-my-lunch-minutes');input.value=String(minutes);input.oninput();}
  };
}
check('Me is selectable and reveals a 1–120 minute lunch slider',()=>{
  const e=environment({g1:['Alex Agent'],lunchSeconds:1800});
  assert(e.checkbox('Me'));assert(e.ui().querySelector('.assistant-settings').classList.contains('hidden'));
  e.tick('Me',true);e.button('Settings').onclick();assert(!e.ui().querySelector('.assistant-settings').classList.contains('hidden'));
  assert.equal(e.window.__itsCallAssist.inspect().mode,'covering');
  const slider=e.ui().querySelector('#its-my-lunch-minutes');assert.equal(slider.min,'1');assert.equal(slider.max,'120');
});
check('Self alone is valid G1 and Available/Busy stay silent despite waiting callers',()=>{
  const e=environment();e.waiting(2);e.other('Alex Agent','On Break',1900);
  e.setMe('Available',5);e.setMe('Busy',200);assert.equal(e.notifications.length,0);assert.equal(e.debug().activeReminder,null);
  assert.equal(e.window.__itsCallAssist.inspect().unavailable,false);
});
check('Other agents going on break are silent while Me is in G1',()=>{
  const e=environment({g1:['Me','Alex Agent'],lunchSeconds:1800});
  e.setMe('Available',2);e.other('Alex Agent','On Break',1);e.setMe('Available',4);
  assert.equal(e.notifications.length,0);
});
check('Disposition has a strict greater-than-10-second boundary',()=>{
  const e=environment();e.setMe('Wrap Up',9);e.setMe('Wrap Up',10);assert.equal(e.notifications.length,0);
  e.setMe('Wrap Up',11);assert.equal(e.debug().activeReminder.kind,'disposition');assert(e.debug().playing.includes('disposition'));
  e.setMe('Wrap Up',12);assert.equal(e.notifications.length,1);
});
check('Wrap-up/Post-processing/Disposition label variants are recognised',()=>{
  for(const status of ['Wrap Up','Wrap-up','Post Processing','Post-processing','Disposition']){
    const e=environment();e.setMe(status,11);assert.equal(e.debug().activeReminder.kind,'disposition');
  }
});
check('Completing disposition clears its sound and allows a later call episode',()=>{
  const e=environment();e.setMe('Wrap Up',11);e.setMe('Available',0);assert(!e.debug().playing.includes('disposition'));
  e.setMe('Busy',1);e.setMe('Wrap Up',10);assert.equal(e.notifications.length,1);
  e.setMe('Wrap Up',11);assert.equal(e.notifications.length,2);
});
check('A normal lunch stays silent including the exact selected duration',()=>{
  const e=environment();e.setMe('On Break',1799);e.setMe('On Break',1800);assert.equal(e.notifications.length,0);
  e.setMe('On Break',1801);assert.equal(e.debug().activeReminder.kind,'lunchOverdue');
  e.setMe('Available',0);assert(!e.debug().playing.includes('lunchOverdue'));
});
check('Both lunch slider endpoints use strict greater-than boundaries',()=>{
  for(const minutes of [1,120]){
    const e=environment({g1:['Me'],lunchMinutes:minutes});e.setMe('On Break',minutes*60);assert.equal(e.notifications.length,0);
    e.setMe('On Break',minutes*60+1);assert.equal(e.debug().activeReminder.kind,'lunchOverdue');
  }
});
check('Increasing lunch allowance cancels an overdue reminder; settings persist',()=>{
  const e=environment({g1:['Me'],lunchSeconds:600});e.setMe('On Break',601);
  e.lunch(20);assert.equal(e.debug().activeReminder,null);assert(!e.debug().playing.includes('lunchOverdue'));
  const saved=JSON.parse(e.storage.get('service-desk-8x8-preferences-v5'));
  assert.equal(saved.lunchMinutes,20);assert.deepEqual(saved.g1,['Me']);
});
check('Other unavailable self states use the existing Available alarm',()=>{
  const e=environment();e.setMe('Work Offline',2);assert.equal(e.debug().activeReminder.kind,'critical');
  e.setMe('Busy',0);assert.equal(e.debug().activeReminder,null);assert(!e.debug().playing.includes('critical'));
});
check('New sound settings have separate defaults and disabled repeat durations',()=>{
  const e=environment();const cards=e.ui().querySelectorAll('fieldset');assert.equal(cards.length,4);
  for(const [label,preset,volume]of [['Alert: Complete Disposition','Urgent pulse','80'],['Alert: Lunch Break Finished','Digital ring','85']]){
    const card=cards.find(n=>n.querySelector('legend').textContent===label);
    assert.equal(card.querySelector('select').value,preset);
    assert.equal(String(card.querySelector('[type="range"]').value),volume);
    assert(card.querySelector('[type="number"]').disabled);
    const repeat=card.querySelector('[type="checkbox"]');repeat.checked=false;repeat.onchange();
    assert(!card.querySelector('[type="number"]').disabled);
  }
});
check('Mute and removal stop personal sounds; hidden queues retain a compact reminder',()=>{
  for(const action of ['Mute','hidden','Remove']){
    const e=environment();e.setMe('Wrap Up',11);
    if(action==='hidden'){
      e.queues[0].row.hidden=true;e.scan();assert(e.ui().querySelector('.unavailable').classList.contains('hidden'));
      assert.equal(e.window.__itsCallAssist.inspect().view,'disposition');assert(e.debug().playing.includes('disposition'));
    }
    else e.button(action==='Remove'?'x':action).onclick();
    if(action==='Remove'){assert.equal(e.window.__itsCallAssist,undefined);assert.equal(e.jobs.size,0);}
    else if(action!=='hidden') assert(!e.debug().playing.includes('disposition'));
  }
});
check('Unticking Me stops personal reminder sounds',()=>{
  const e=environment({g1:['Me','Alex Agent'],lunchSeconds:1800});e.setMe('Wrap Up',11);e.tick('Me',false);
  assert(!e.debug().playing.includes('disposition'));assert.equal(e.window.__itsCallAssist.inspect().mode,'assisting');
});
check('G2 still reports another selected agent going on break',()=>{
  const e=environment({g1:['Alex Agent'],lunchSeconds:1800});e.setMe('Available',2);e.other('Alex Agent','On Break',1);e.setMe('Available',4);
  assert(e.notifications.some(n=>n.title==='Info: G1 On Break'));
});
check('A finite custom reminder does not restart within the same condition',()=>{
  const e=environment({g1:['Me'],lunchSeconds:1800},{disposition:{preset:'Soft bell',volume:40,seconds:2,repeat:false}});
  e.setMe('Wrap Up',11);
  for(const {fn,ms}of [...e.jobs.values()])if(ms===2000)fn();
  e.setMe('Wrap Up',12);assert(!e.debug().playing.includes('disposition'));assert.equal(e.notifications.length,1);
});

check('Agents uses separate Name / Status / Time / G1 columns',()=>{
  const e=environment();e.setMe('Available',5);
  const table=e.ui().querySelector('table');
  assert.deepEqual(table.querySelector('thead').querySelectorAll('th').map(c=>c.textContent),['Name','Status','Time','G1']);
  const rows=table.querySelector('tbody').querySelectorAll('tr');
  assert.equal(rows.length,3);
  const cells=rows[0].querySelectorAll('td');assert.equal(cells.length,4);
  assert.deepEqual(cells.map(c=>c.textContent),['Me','Available','5s','']);
  assert.equal(cells[3].querySelector('input').getAttribute('aria-label'),'G1: Me');
  assert(e.ui().querySelectorAll('h4').some(n=>n.textContent==='Agents'));
});
check('Sounds and Settings replace main content and have top Back buttons',()=>{
  const e=environment();
  const main=e.ui().querySelector('.main-view');
  const sounds=e.ui().querySelector('.sound-settings'),settings=e.ui().querySelector('.assistant-settings');
  assert(sounds.classList.contains('hidden'));assert(settings.classList.contains('hidden'));
  e.button('Settings').onclick();e.button('Open Sound Settings').onclick();assert(main.classList.contains('hidden'));assert(!sounds.classList.contains('hidden'));assert(settings.classList.contains('hidden'));
  assert.equal(sounds.children[0].querySelector('h3').textContent,'Sound Settings');
  assert.equal(sounds.children[0].querySelector('button').textContent,'Back');
  assert.equal(sounds.querySelectorAll('button').filter(n=>n.textContent==='Back').length,1);
  sounds.children[0].querySelector('button').onclick();assert(!settings.classList.contains('hidden'));assert(sounds.classList.contains('hidden'));settings.children[0].querySelector('button').onclick();assert(!main.classList.contains('hidden'));
  e.button('Settings').onclick();assert(main.classList.contains('hidden'));assert(!settings.classList.contains('hidden'));
  assert.equal(settings.children[0].querySelector('h3').textContent,'Assistant Settings');
  assert.equal(settings.children[0].querySelector('button').textContent,'Back');
  settings.children[0].querySelector('button').onclick();assert(!main.classList.contains('hidden'));
});
check('Monitoring continues in submenus; Back stops previews only',()=>{
  const e=environment();e.button('Settings').onclick();e.button('Open Sound Settings').onclick();e.setMe('Wrap Up',11);
  assert.equal(e.debug().activeReminder.kind,'disposition');
  const sounds=e.ui().querySelector('.sound-settings');sounds.querySelectorAll('button').find(n=>n.textContent==='Preview').onclick();
  assert(e.debug().playing.includes('preview'));
  sounds.children[0].querySelector('button').onclick();assert(!e.debug().playing.includes('preview'));assert(e.debug().playing.includes('disposition'));
  e.button('Settings').onclick();e.setMe('Available',0);assert.equal(e.debug().activeReminder,null);
});
check('Disposition delay and descriptions update immediately',()=>{
  const e=environment();e.setMe('Wrap Up',10);assert.equal(e.notifications.length,0);
  const input=e.ui().querySelector('#its-disposition-seconds');input.value='5';input.onchange();
  assert.equal(e.debug().activeReminder.kind,'disposition');
  const card=e.ui().querySelectorAll('fieldset').find(n=>n.querySelector('legend').textContent==='Alert: Complete Disposition');
  assert(card.querySelector('.sound-description').textContent.includes('more than 5 seconds'));
  input.value='20';input.onchange();assert.equal(e.debug().activeReminder,null);
  e.setMe('Wrap Up',20);assert.equal(e.debug().activeReminder,null);
  e.setMe('Wrap Up',21);assert.equal(e.debug().activeReminder.kind,'disposition');
});
check('Desktop notifications can be disabled without silencing alerts',()=>{
  const e=environment({g1:['Me'],lunchSeconds:1800,desktopNotifications:false});e.setMe('Wrap Up',11);
  assert.equal(e.notifications.length,0);assert(e.debug().playing.includes('disposition'));
  const toggle=e.ui().querySelector('#its-desktop-notifications');toggle.checked=true;toggle.onchange();e.setMe('Work Offline',1);
  assert.equal(e.notifications.length,1);toggle.checked=false;toggle.onchange();assert(e.notifications[0].closed);
  assert(e.debug().playing.includes('critical'));
});
check('Hidden data conceals all menu contents, then restores the open menu',()=>{
  const e=environment();e.button('Settings').onclick();e.queues[0].row.hidden=true;e.scan();
  assert(e.ui().querySelector('.assistant-settings').classList.contains('hidden'));
  assert(e.ui().querySelector('.sound-settings').classList.contains('hidden'));
  assert(!e.ui().querySelector('.unavailable').classList.contains('hidden'));
  assert.equal(e.ui().querySelector('.unavailable').textContent,'Unable to Assist: Open 8x8 agent queue information.');
  e.queues[0].row.hidden=false;e.scan();assert(!e.ui().querySelector('.assistant-settings').classList.contains('hidden'));
});

check('Release reports version 1.0.3 and bottom controls are only Mute / Settings',()=>{
  const e=environment();assert.equal(e.window.__itsCallAssist.version,'1.0.3');
  assert.deepEqual(e.ui().querySelector('.controls').querySelectorAll('button').map(b=>b.textContent),['Mute','Settings']);
  assert.deepEqual(e.ui().querySelector('.window-actions').querySelectorAll('button').map(b=>b.textContent),['-','x']);
  assert(e.ui().querySelector('.version').textContent.includes('1.0.3'));
});
check('Minimise and restore use the top button; close removes the assistant',()=>{
  const e=environment();e.button('-').onclick();assert(e.ui().querySelector('.monitor-grid').parentElement.classList.contains('hidden'));
  e.button('+').onclick();assert(!e.ui().querySelector('.monitor-grid').parentElement.classList.contains('hidden'));
  e.button('x').onclick();assert.equal(e.window.__itsCallAssist,undefined);assert.equal(e.jobs.size,0);
});
check('G2 explanation appears below Agents and the two finite-sound stop lines are gone',()=>{
  const e=environment();assert(e.ui().querySelector('.agent-help').textContent.includes('Group 2 (G2)'));
  for(const label of ['Info: G1 On Break']){
    const card=e.ui().querySelectorAll('fieldset').find(n=>n.querySelector('legend').textContent===label);
    assert(!card.querySelector('.sound-description').textContent.includes('Stops when'));
    assert(card.querySelector('.sound-description').textContent.includes('G2'));
  }
  assert(!e.ui().textContent.includes('outside G1'));
});
check('Each observed transition to Busy counts once, regardless of G1 selection',()=>{
  const e=environment({g1:['Alex Agent'],lunchSeconds:1800});
  e.setMe('Busy',0);assert.equal(e.window.__itsCallAssist.statistics().total,1);
  e.setMe('Busy',3);e.setMe('Busy',30);assert.equal(e.window.__itsCallAssist.statistics().total,1);
  e.setMe('Wrap Up',1);e.setMe('Available',1);e.setMe('Busy',0);assert.equal(e.window.__itsCallAssist.statistics().total,2);
});
check('Calls keep counting while queues are hidden and when the status timer cannot be read',()=>{
  const e=environment();e.queues[0].row.hidden=true;e.meTimer.textContent='timer unavailable';
  e.meStatus.setAttribute('data-status-value','Busy');e.scan();assert.equal(e.window.__itsCallAssist.statistics().total,1);
  assert.equal(e.window.__itsCallAssist.inspect().unavailable,true);
  e.meStatus.setAttribute('data-status-value','Available');e.scan();e.meStatus.setAttribute('data-status-value','Busy');e.scan();
  assert.equal(e.window.__itsCallAssist.statistics().total,2);
});
check('An unreadable interval does not fabricate a Busy exit or count the same call twice',()=>{
  const e=environment();e.setMe('Busy',0);e.header.hidden=true;e.scan();e.scan();
  assert.equal(e.window.__itsCallAssist.statistics().total,1);assert(e.window.__itsCallAssist.statistics().hadGaps);
  e.header.hidden=false;e.setMe('Busy',8);assert.equal(e.window.__itsCallAssist.statistics().total,1);
  assert(e.ui().querySelector('.statistics-note').textContent.includes('inaccuracies'));
});
check('A Busy timer reset alone is not counted as another call',()=>{
  const e=environment();e.setMe('Busy',120);e.setMe('Busy',125);e.setMe('Busy',0);e.setMe('Wrap Up',0);
  assert.equal(e.window.__itsCallAssist.statistics().total,1);
});
check('Rerunning the snippet keeps daily statistics without duplicating an ongoing Busy period',()=>{
  const e=environment();e.setMe('Busy',0);e.rerun();assert.equal(e.window.__itsCallAssist.statistics().total,1);
  e.setMe('Busy',5);assert.equal(e.window.__itsCallAssist.statistics().total,1);
  e.setMe('Available',0);e.setMe('Busy',0);assert.equal(e.window.__itsCallAssist.statistics().total,2);
});
check('Daily rollover uses Brisbane midnight and does not count an ongoing call again',()=>{
  const e=environment();e.setTime(Date.parse('2026-10-12T13:59:50Z'));e.setMe('Busy',0);
  assert.equal(e.window.__itsCallAssist.statistics().day,'2026-10-12');
  assert.equal(e.window.__itsCallAssist.statistics().total,1);
  e.setTime(Date.parse('2026-10-12T14:00:01Z'));e.setMe('Busy',12);
  assert.equal(e.window.__itsCallAssist.statistics().day,'2026-10-13');
  assert.equal(e.window.__itsCallAssist.statistics().total,0);
  e.setMe('Available',0);e.setMe('Busy',0);assert.equal(e.window.__itsCallAssist.statistics().total,1);
});
check('Missing queue configuration opens Settings and can be configured locally',()=>{
  const e=environment();e.storage.delete('service-desk-8x8-inbound-queues-v1');e.rerun();
  assert(!e.ui().querySelector('.assistant-settings').classList.contains('hidden'));
  const inputs=e.ui().querySelectorAll('input').filter(n=>(n.getAttribute('aria-label')||'').startsWith('Inbound queue '));
  assert.equal(inputs.length,3);
  ['Demo Academic Queue','Demo Transfer Queue','Demo Service Queue'].forEach((name,i)=>{inputs[i].value=name;inputs[i].onchange();});
  assert.deepEqual(JSON.parse(e.storage.get('service-desk-8x8-inbound-queues-v1')),['Demo Academic Queue','Demo Transfer Queue','Demo Service Queue']);
  assert.equal(e.window.__itsCallAssist.inspect().unavailable,false);
});

check('Captured break page stays visible with only its status bar and no queue information',()=>{
  const e=environment();e.showBreak(421);
  assert.equal(e.window.__itsCallAssist.inspect().me.seconds,421);
  assert.equal(e.window.__itsCallAssist.inspect().view,'break');
  assert(!e.ui().querySelector('.compact-view').classList.contains('hidden'));
  for(const cls of ['.main-view','.sound-settings','.assistant-settings','.unavailable']) assert(e.ui().querySelector(cls).classList.contains('hidden'));
  assert.equal(e.ui().querySelector('.compact-elapsed').textContent,'421s elapsed');
  assert.equal(e.ui().querySelector('.compact-countdown').textContent,'1379s left');
  assert.equal(e.ui().querySelector('.progress-track').getAttribute('aria-valuenow'),'421');
  assert.equal(e.notifications.length,0);
});
check('Hidden break page uses native elapsed time, alerts strictly after lunch, then restores main',()=>{
  const e=environment({g1:['Me'],lunchSeconds:60});e.showBreak(59);
  e.breakTime(60);assert.equal(e.debug().activeReminder,null);
  e.breakTime(61);assert.equal(e.debug().activeReminder.kind,'lunchOverdue');
  assert.equal(e.ui().querySelector('.compact-countdown').textContent,'1s overdue');
  e.breakTime(65);assert.equal(e.notifications.length,1);
  e.restoreMain();assert.equal(e.debug().activeReminder,null);assert.equal(e.window.__itsCallAssist.inspect().view,'main');
  assert(e.ui().querySelector('.compact-view').classList.contains('hidden'));
  assert(!e.ui().querySelector('.main-view').classList.contains('hidden'));
});
check('Break timer supports hours and keeps working without saved queue names',()=>{
  const e=environment({g1:['Me'],lunchSeconds:7200});e.showBreak(7199);
  e.storage.delete('service-desk-8x8-inbound-queues-v1');e.rerun();
  assert.equal(e.window.__itsCallAssist.inspect().view,'break');
  e.breakTime(7200);assert.equal(e.window.__itsCallAssist.inspect().me.seconds,7200);assert.equal(e.debug().activeReminder,null);
  e.breakTime(7201);assert.equal(e.debug().activeReminder.kind,'lunchOverdue');
});
check('G2 gets the compact pages without personal reminder sounds or G1 queue checks',()=>{
  const e=environment({g1:['Alex Agent'],lunchSeconds:30});e.showBreak(31);e.breakTime(32);
  assert.equal(e.window.__itsCallAssist.inspect().view,'break');assert.equal(e.debug().playing.length,0);
  e.showWrapUp(120);e.wrapTime(100);assert.equal(e.window.__itsCallAssist.inspect().view,'disposition');
  assert.equal(e.notifications.length,0);assert.equal(e.debug().playing.length,0);
});
check('Unreadable or ambiguous break timers stop reminders instead of inventing elapsed time',()=>{
  const e=environment({g1:['Me'],lunchSeconds:5});e.showBreak(6);e.breakTime(7);
  const timer=e.personalPage().querySelector('[data-test-id="on-break-timer"]');timer.textContent='01:99';e.scan();
  assert.equal(e.debug().activeReminder,null);assert.equal(e.window.__itsCallAssist.inspect().unavailable,true);
  timer.textContent='00:08';e.scan();
  const duplicate=e.window.document.createElement('div');duplicate.setAttribute('data-test-id','on-break-timer');duplicate.textContent='00:08';
  e.personalPage().append(duplicate);e.scan();assert.equal(e.window.__itsCallAssist.inspect().unavailable,true);
});
check('Captured wrap-up countdown measures disposition time, ignoring the completed call timer',()=>{
  const e=environment();e.showWrapUp(111);
  assert.equal(e.window.__itsCallAssist.inspect().me.seconds,0);assert.equal(e.ui().querySelector('.compact-countdown').textContent,'10s left');
  e.wrapTime(102);assert.equal(e.window.__itsCallAssist.inspect().me.seconds,9);assert.equal(e.debug().activeReminder,null);
  e.wrapTime(101);assert.equal(e.ui().querySelector('.compact-countdown').textContent,'0s left');assert.equal(e.debug().activeReminder,null);
  e.wrapTime(100);assert.equal(e.debug().activeReminder.kind,'disposition');assert.equal(e.ui().querySelector('.compact-countdown').textContent,'1s overdue');
  e.restoreMain();assert.equal(e.debug().activeReminder,null);assert(!e.ui().querySelector('.main-view').classList.contains('hidden'));
});
check('Disposition elapsed time survives rerunning and does not rewind when 8x8 extends its timer',()=>{
  const e=environment();e.showWrapUp(111);e.wrapTime(100);assert.equal(e.window.__itsCallAssist.inspect().me.seconds,11);
  e.wrapTime(105);assert.equal(e.window.__itsCallAssist.inspect().me.seconds,11);
  e.rerun();assert(e.window.__itsCallAssist.inspect().me.seconds>=11);
  e.wrapTime(99);assert.equal(e.debug().activeReminder.kind,'disposition');
  e.restoreMain('Busy',1);e.showWrapUp(111);assert.equal(e.window.__itsCallAssist.inspect().me.seconds,0);
});
check('A disposition tab during an active call does not imply the call is in wrap-up',()=>{
  const e=environment();e.setMe('Busy',5);
  const tab=e.window.document.createElement('button');tab.setAttribute('data-test-id','disposition-tab_TAB');tab.setAttribute('aria-selected','true');tab.textContent='Disposition';
  e.window.document.body.append(tab);e.scan();
  assert.equal(e.window.__itsCallAssist.inspect().view,'main');assert.equal(e.debug().activeReminder,null);
});
check('A finished native countdown does not silence a disposition reminder while Wrap up remains open',()=>{
  const e=environment();e.showWrapUp(5);e.wrapTime(0);e.advance(11000);
  assert.equal(e.debug().activeReminder.kind,'disposition');e.advance(31000);
  assert.equal(e.debug().activeReminder.kind,'disposition');assert(e.debug().playing.includes('disposition'));
  e.restoreMain();assert.equal(e.debug().activeReminder,null);
});
check('Switching from a known disposition status to its dedicated page preserves elapsed time',()=>{
  const e=environment();e.setMe('Wrap Up',11);e.showWrapUp(100);
  assert(e.window.__itsCallAssist.inspect().me.seconds>=11);assert.equal(e.debug().activeReminder.kind,'disposition');
});
check('Call statistics recognise hidden wrap-up and break status without adding false calls',()=>{
  const e=environment();e.setMe('Busy',0);e.showWrapUp(111);e.wrapTime(110);
  assert.equal(e.window.__itsCallAssist.statistics().total,1);assert.equal(e.window.__itsCallAssist.statistics().hadGaps,false);
  e.restoreMain('Busy',0);assert.equal(e.window.__itsCallAssist.statistics().total,2);
  e.showBreak(60);e.breakTime(61);assert.equal(e.window.__itsCallAssist.statistics().total,2);
});
check('Monitoring combines inbound callers into one total and timestamps the whole update',()=>{
  const e=environment();e.waiting(3);
  for(const [index,value]of [[0,2],[1,4],[2,50]]) {e.queues[index].cell.textContent=String(value);e.queues[index].cell.setAttribute('title',`${value} Interactions waiting`);}
  e.setMe('Available',5);assert.equal(e.ui().querySelector('.queue-total').textContent,'9');
  const monitor=e.ui().querySelector('.monitoring-summary').textContent;
  assert(!monitor.includes('Demo'));assert(!monitor.includes('MONITORING'));assert(!monitor.includes('Checked'));
  assert(e.ui().querySelector('.last-updated').textContent.startsWith('Last updated'));assert(!e.ui().querySelector('time').textContent.includes('—'));
});

check('Signed-out agents and their G1 selections are removed; logging in creates a fresh row',()=>{
  const e=environment({g1:['Alex Agent'],lunchMinutes:30});
  const original=e.checkbox('Alex Agent');e.logout('Alex Agent');e.scan();
  assert.equal(e.checkbox('Alex Agent'),null);assert(!e.window.__itsCallAssist.inspect().selected.includes('Alex Agent'));
  assert(!JSON.parse(e.storage.get('service-desk-8x8-preferences-v5')).g1.includes('Alex Agent'));
  assert.equal(e.window.__itsCallAssist.inspect().unavailable,false);
  e.login('Alex Agent','Busy',3);e.scan();const fresh=e.checkbox('Alex Agent');assert(fresh);assert.notEqual(fresh,original);assert.equal(fresh.checked,false);
});
check('Removing the last online agents leaves only Me and still allows selecting Me',()=>{
  const e=environment({g1:['Alex Agent','Casey Agent']});e.logout('Alex Agent');e.logout('Casey Agent');e.scan();
  assert.equal(e.ui().querySelector('tbody').querySelectorAll('tr').length,1);
  assert.equal(e.window.__itsCallAssist.inspect().unavailable,false);e.tick('Me',true);
  assert.equal(e.window.__itsCallAssist.inspect().mode,'covering');
});
check('A saved selection for an already signed-out agent cannot block the main assistant',()=>{
  const e=environment({g1:['Former Agent']});assert.equal(e.checkbox('Former Agent'),null);
  assert.equal(e.window.__itsCallAssist.inspect().unavailable,false);
  assert.deepEqual(JSON.parse(e.storage.get('service-desk-8x8-preferences-v5')).g1,[]);
});
check('Hidden roster, break and disposition pages do not erase saved G1 members',()=>{
  const e=environment({g1:['Me','Alex Agent']});e.group.hidden=true;e.scan();
  assert(JSON.parse(e.storage.get('service-desk-8x8-preferences-v5')).g1.includes('Alex Agent'));
  e.group.hidden=false;e.scan();e.showBreak(30);e.showWrapUp(111);e.restoreMain();
  assert(e.checkbox('Alex Agent').checked);assert(e.window.__itsCallAssist.inspect().selected.includes('Alex Agent'));
});
check('New agents appear immediately and Me stays first with the same row styling',()=>{
  const e=environment();e.login('AAA Agent');e.scan();
  const rows=e.ui().querySelector('tbody').querySelectorAll('tr');assert.equal(rows[0].querySelector('td').textContent,'Me');
  assert(e.checkbox('AAA Agent'));assert.equal(rows[0].className,rows[1].className);
  assert.equal(e.ui().querySelector('.version').textContent,'Author: Joshua Lavagna-Slater | Version 1.0.3');
});
check('Version 1.0.2 settings migrate to minute lunches and one caller waiting delay',()=>{
  const e=environment({g1:['Me'],lunchSeconds:2700,coverSeconds:360,callSeconds:240,dispositionSeconds:10},{},{rawPreferences:true});
  const sample=e.window.__itsCallAssist.inspect();assert.equal(sample.lunchMinutes,45);assert.equal(sample.waitingAlertSeconds,360);assert.equal(sample.dispositionSeconds,20);
  const saved=JSON.parse(e.storage.get('service-desk-8x8-preferences-v5'));assert.equal(saved.lunchMinutes,45);
  assert.equal(saved.lunchSeconds,undefined);assert.equal(saved.callSeconds,undefined);assert.equal(saved.coverSeconds,undefined);assert.equal(saved.settingsVersion,3);
  e.rerun();assert.equal(e.window.__itsCallAssist.inspect().lunchMinutes,45);assert.equal(e.window.__itsCallAssist.inspect().waitingAlertSeconds,360);
});
check('Disposition defaults to 20 seconds and a newly chosen 10-second value stays unchanged',()=>{
  const e=environment({g1:['Me']},{},{rawPreferences:true});assert.equal(e.window.__itsCallAssist.inspect().dispositionSeconds,20);
  e.setMe('Wrap Up',20);assert.equal(e.debug().activeReminder,null);e.setMe('Wrap Up',21);assert.equal(e.debug().activeReminder.kind,'disposition');
  const delay=e.ui().querySelector('#its-disposition-seconds');delay.value='10';delay.onchange();e.rerun();
  assert.equal(e.window.__itsCallAssist.inspect().dispositionSeconds,10);
});
check('Minute lunch input and slider agree, while delay settings and sound choices persist',()=>{
  const e=environment({g1:['Me'],lunchMinutes:45,dispositionSeconds:15,waitingAlertSeconds:360,desktopNotifications:false},
    {critical:{preset:'Soft bell',volume:32,seconds:4,repeat:false}});
  const exact=e.ui().querySelector('#its-my-lunch-exact-minutes');exact.value='1';exact.onchange();
  assert.equal(e.ui().querySelector('#its-my-lunch-minutes').value,'1');e.lunch(20);assert.equal(exact.value,'20');
  e.setMe('On Break',1200);assert.equal(e.debug().activeReminder,null);e.setMe('On Break',1201);assert.equal(e.debug().activeReminder.kind,'lunchOverdue');
  const delay=e.ui().querySelector('#its-waiting-alert-seconds');delay.value='7';delay.onchange();
  const saved=JSON.parse(e.storage.get('service-desk-8x8-preferences-v5'));assert.equal(saved.waitingAlertSeconds,7);assert.equal(saved.lunchMinutes,20);assert.equal(saved.dispositionSeconds,15);
  const card=e.ui().querySelectorAll('fieldset').find(n=>n.querySelector('legend').textContent==='Alert: Change Status To Available');
  assert.equal(card.querySelector('select').value,'Soft bell');assert(card.querySelector('.sound-description').textContent.includes('at least 7 seconds'));
  assert(!e.ui().querySelector('#its-call-seconds'));assert(!e.ui().querySelector('#its-cover-seconds'));
  assert(!e.ui().querySelectorAll('fieldset').some(n=>n.querySelector('legend').textContent==='Info: Caller Waiting'));
});
check('One cover alert uses an inclusive caller wait boundary and accepts mixed unavailable G1 states',()=>{
  const context={normal:s=>s.toLowerCase().trim(),QUEUES:['a','b','c']};vm.createContext(context);
  const start=original.indexOf('  function groupRules('),end=original.indexOf('  function dispositionStatus(',start);vm.runInContext(original.slice(start,end),context);
  const agents=[{name:'A',status:'Busy',seconds:1},{name:'B',status:'On Break',seconds:300},{name:'C',status:'Working Offline',seconds:2}];
  const queues=[{waiting:1,waitSeconds:59},{waiting:0,waitSeconds:0},{waiting:0,waitSeconds:0}],me={status:'Work Offline'};
  assert.equal(context.groupRules(agents,queues,me,60).critical,false);queues[0].waitSeconds=60;
  assert.equal(context.groupRules(agents,queues,me,60).critical,true);
  agents[2].status='Available';assert.equal(context.groupRules(agents,queues,me,60).critical,false);
  agents[2].status='Wrap Up';assert.equal(context.groupRules(agents,queues,me,60).critical,true);
  me.status='Available';assert.equal(context.groupRules(agents,queues,me,60).critical,false);
  me.status='Work Offline';assert.equal(context.groupRules([],queues,me,60).critical,false);
  queues[0].waitSeconds=null;assert.equal(context.groupRules(agents,queues,me,60).critical,false);
});
function coveragePulse(e,age,tick=1) {
  e.other('Alex Agent','Busy',tick);e.waiting(1,age);e.setMe('Work Offline',tick);
}
check('Live coverage repeats only after a caller reaches the delay, regardless of short Busy time',()=>{
  const e=environment({g1:['Alex Agent'],waitingAlertSeconds:60});coveragePulse(e,58,1);coveragePulse(e,59,2);
  assert.equal(e.notifications.length,0);assert.equal(e.debug().playing.length,0);
  coveragePulse(e,60,3);assert.equal(e.debug().activeReminder.kind,'critical');assert(e.debug().playing.includes('critical'));
  coveragePulse(e,61,4);assert.equal(e.notifications.length,1);
  e.other('Alex Agent','Available',0);e.setMe('Work Offline',5);assert.equal(e.debug().activeReminder,null);
  coveragePulse(e,62,6);coveragePulse(e,63,7);assert.equal(e.debug().activeReminder.kind,'critical');
  e.setMe('Available',0);assert.equal(e.debug().activeReminder,null);
});
check('Nobody being Available is not enough without a caller waiting for the required time',()=>{
  const e=environment({g1:['Alex Agent'],waitingAlertSeconds:60});e.other('Alex Agent','Working Offline',1);e.setMe('Work Offline',1);
  e.other('Alex Agent','Working Offline',2);e.setMe('Work Offline',2);
  assert.equal(e.debug().activeReminder,null);assert.equal(e.notifications.length,0);
});
check('Ending or replacing the oldest waiting call stops the coverage sound',()=>{
  const e=environment({g1:['Alex Agent'],waitingAlertSeconds:60});coveragePulse(e,60,1);coveragePulse(e,61,2);
  assert.equal(e.debug().activeReminder.kind,'critical');coveragePulse(e,2,3);assert.equal(e.debug().activeReminder,null);
  coveragePulse(e,60,4);assert.equal(e.debug().activeReminder.kind,'critical');e.waiting(0);e.setMe('Work Offline',5);
  assert.equal(e.debug().activeReminder,null);
});
check('Unavailable longest-wait data does not produce a fabricated caller delay',()=>{
  const e=environment({g1:['Alex Agent'],waitingAlertSeconds:60});coveragePulse(e,60,1);coveragePulse(e,61,2);
  e.queues[3].wait.textContent='unreadable';e.queues[3].wait.setAttribute('title','unknown Longest waiting time');e.setMe('Work Offline',3);
  assert.equal(e.debug().activeReminder,null);assert.equal(e.window.__itsCallAssist.inspect().unavailable,false);
  assert(e.ui().querySelector('.monitoring-state').textContent.includes('caller time'));
});
check('Outbound waits and unselected G2 agents cannot control the coverage alert',()=>{
  const e=environment({g1:['Alex Agent'],waitingAlertSeconds:60});e.waiting(10,900,2);e.other('Alex Agent','Busy',1);e.setMe('Work Offline',1);
  e.other('Alex Agent','Busy',2);e.setMe('Work Offline',2);assert.equal(e.debug().activeReminder,null);
  e.queues[2].row.hidden=true;coveragePulse(e,60,3);coveragePulse(e,61,4);
  assert.equal(e.debug().activeReminder.kind,'critical');assert.equal(e.window.__itsCallAssist.inspect().queues.length,3);
  assert.equal(e.ui().querySelector('.queue-total').textContent,'1');
});
check('Coverage queue alarms are suppressed when Me is in G1',()=>{
  const e=environment({g1:['Me','Alex Agent'],waitingAlertSeconds:1});e.other('Alex Agent','Busy',1);e.waiting(3,300);e.setMe('Busy',1);
  e.other('Alex Agent','Busy',2);e.waiting(3,301);e.setMe('Busy',2);assert.equal(e.notifications.length,0);assert.equal(e.debug().activeReminder,null);
});
check('Mute stops all tones and previews while updates, counters and notifications continue',()=>{
  const e=environment();e.setMe('Wrap Up',11);assert(e.debug().playing.includes('disposition'));e.button('Mute').onclick();
  assert(e.debug().muted);assert.equal(e.debug().playing.length,0);
  assert.equal(e.debug().activeReminder.kind,'disposition');assert(e.ui().querySelectorAll('button').filter(b=>b.textContent==='Preview').every(b=>b.disabled));
  e.setMe('Work Offline',1);assert.equal(e.debug().activeReminder.kind,'critical');assert(e.notifications.at(-1).options.silent);
  const stamp=e.ui().querySelector('.last-updated').textContent;e.setMe('Busy',0);e.waiting(4);e.other('Alex Agent','Busy',400);e.setMe('Busy',4);
  assert.equal(e.window.__itsCallAssist.statistics().total,1);assert.equal(e.ui().querySelector('.queue-total').textContent,'4');
  assert.notEqual(e.ui().querySelector('.last-updated').textContent,stamp);assert.equal(e.window.__itsCallAssist.inspect().me.timer,'4s');
  assert.equal(e.debug().playing.length,0);
});
check('Unmute resumes the current alert without duplicating its notification and mute persists on rerun',()=>{
  const e=environment();e.setMe('Wrap Up',11);e.button('Mute').onclick();const count=e.notifications.length;
  e.button('Unmute').onclick();assert(e.debug().playing.includes('disposition'));assert.equal(e.notifications.length,count);
  e.button('Mute').onclick();e.rerun();assert(e.debug().muted);assert.equal(e.debug().playing.length,0);
  assert.deepEqual(e.ui().querySelector('.controls').querySelectorAll('button').map(b=>b.textContent),['Unmute','Settings']);
});
check('Compact break time and progress continue while muted and can be unmuted from the bar',()=>{
  const e=environment({g1:['Me'],lunchMinutes:1});e.showBreak(20);e.ui().querySelector('.compact-actions').querySelector('button').onclick();
  const width=e.ui().querySelector('.progress-fill').style.width;e.breakTime(70);
  assert.equal(e.ui().querySelector('.compact-elapsed').textContent,'70s elapsed');assert.notEqual(e.ui().querySelector('.progress-fill').style.width,width);
  assert.equal(e.debug().activeReminder.kind,'lunchOverdue');assert.equal(e.debug().playing.length,0);assert(e.notifications.at(-1).options.silent);
  e.ui().querySelector('.compact-actions').querySelector('button').onclick();assert(e.debug().playing.includes('lunchOverdue'));
});
check('Last-hour statistics expire while muted, rather than freezing',()=>{
  const e=environment();e.setMe('Busy',0);e.setMe('Available',0);e.button('Mute').onclick();e.advance(3601000);
  assert.equal(e.ui().querySelector('.statistics').querySelectorAll('.stat-value')[1].textContent,'0');
  assert.equal(e.window.__itsCallAssist.statistics().total,1);
});
check('Unmute also resumes a customised repeating break information sound without another popup',()=>{
  const e=environment({g1:['Alex Agent']},{lunch:{repeat:true}});e.other('Alex Agent','On Break',1);e.setMe('Available',1);
  assert(e.debug().playing.includes('lunch'));const count=e.notifications.length;e.button('Mute').onclick();e.button('Unmute').onclick();
  assert(e.debug().playing.includes('lunch'));assert.equal(e.notifications.length,count);
});

const asyncChecks=[];
function asyncCheck(name,fn) {asyncChecks.push({name,fn});}
asyncCheck('Desktop notification test sends a popup without an alert sound or false delivery claim',async()=>{
  const e=environment();e.button('Settings').onclick();await e.button('Test desktop notification').onclick();
  assert.equal(e.notifications.length,1);assert.equal(e.notifications[0].title,'8x8 Assistant: Test Notification');
  assert.equal(e.debug().playing.length,0);assert.equal(e.debug().activeReminder,null);
  assert(e.ui().querySelector('.notification-feedback').textContent.includes('If no popup appeared'));
});
asyncCheck('Notification permissions require the documented manual Edge allow-list steps',async()=>{
  const e=environment();const instructions=e.ui().querySelector('.notification-instructions').textContent;
  for(const text of ['Privacy, search and services','All permissions','Allowed to send notifications','Add site','https://vcc-au2.8x8.com'])assert(instructions.includes(text));
  let requests=0;e.window.Notification.requestPermission=async()=>{requests++;return 'granted';};
  for(const permission of ['default','denied']) {
    e.window.Notification.permission=permission;await e.button('Test desktop notification').onclick();
    assert.equal(e.notifications.length,0);assert(e.ui().querySelector('.notification-feedback').textContent.includes('Edge settings'));
  }
  assert.equal(requests,0);
});
asyncCheck('Muted notification tests still work quietly and disabled, unsupported or failed tests report correctly',async()=>{
  const muted=environment({g1:['Me'],muted:true});await muted.button('Test desktop notification').onclick();
  assert.equal(muted.notifications.length,1);assert(muted.notifications[0].options.silent);assert.equal(muted.debug().playing.length,0);
  const off=environment({g1:['Me'],desktopNotifications:false});assert(off.button('Test desktop notification').disabled);
  await off.button('Test desktop notification').onclick();assert.equal(off.notifications.length,0);
  const missing=environment();delete missing.window.Notification;await missing.button('Test desktop notification').onclick();
  assert(missing.ui().querySelector('.notification-feedback').textContent.includes('not supported'));
  const failed=environment();failed.window.Notification=class{static permission='granted';constructor(){throw Error('Blocked');}};
  await failed.button('Test desktop notification').onclick();assert(failed.ui().querySelector('.notification-feedback').textContent.includes('could not be sent'));
});
asyncCheck('Audio dropdowns name system defaults, input stays disabled, and selecting output affects only assistant audio',async()=>{
  const e=environment();await e.button('Refresh devices').onclick();
  const input=e.ui().querySelector('[aria-label="Assistant input device"]'),output=e.ui().querySelector('[aria-label="Assistant output device"]');
  assert(input.disabled);assert.equal(input.querySelector('option').textContent,'Desk Microphone (Default)');
  assert.equal(output.querySelector('option').textContent,'Desk Speakers (Default)');
  const phoneAudio=new e.window.AudioContext();output.value='headset';await output.onchange();
  assert.equal(e.debug().audioOutput,'headset');assert.equal(phoneAudio.sinkId,'');assert.equal(phoneAudio.state,'running');
  assert.equal(JSON.parse(e.storage.get('service-desk-8x8-preferences-v5')).outputDeviceId,'headset');
  assert.equal(e.microphoneRequests(),0);output.value='';await output.onchange();assert.equal(e.debug().audioOutput,'');
});
asyncCheck('A saved assistant output restores on rerun and a removed device falls back to Default',async()=>{
  const e=environment();await e.button('Refresh devices').onclick();const output=e.ui().querySelector('[aria-label="Assistant output device"]');
  output.value='headset';await output.onchange();e.rerun();await e.button('Refresh devices').onclick();assert.equal(e.debug().audioOutput,'headset');
  e.devices.splice(e.devices.findIndex(d=>d.deviceId==='headset'),1);e.deviceChanged();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(e.debug().audioOutput,'');assert.equal(JSON.parse(e.storage.get('service-desk-8x8-preferences-v5')).outputDeviceId,'');
  e.button('x').onclick();assert.equal(e.deviceListeners.size,0);
});
asyncCheck('Permission failure keeps the previous output and unsupported browsers retain a usable Default',async()=>{
  const e=environment({}, {}, {rejectOutput:'headset'});await e.button('Refresh devices').onclick();
  const output=e.ui().querySelector('[aria-label="Assistant output device"]');output.value='headset';await output.onchange();
  assert.equal(e.debug().audioOutput,'');assert.equal(output.value,'');
  const old=environment({g1:['Me'],outputDeviceId:'headset'}, {}, {noOutputSelection:true});await new Promise(resolve=>setImmediate(resolve));
  assert(old.ui().querySelector('[aria-label="Assistant output device"]').disabled);assert.equal(old.debug().audioOutput,'');
  old.setMe('Wrap Up',11);assert(old.debug().playing.includes('disposition'));assert.equal(old.microphoneRequests(),0);
});
asyncCheck('Browser output picker and unavailable device listing handle permissions without microphone capture',async()=>{
  const e=environment({}, {}, {outputPicker:true});await e.button('Choose output device').onclick();assert.equal(e.debug().audioOutput,'headset');assert.equal(e.microphoneRequests(),0);
  const failed=environment({}, {}, {enumerationFails:true});await failed.button('Refresh devices').onclick();
  assert.equal(failed.debug().audioOutput,'');assert(failed.ui().textContent.includes('Could not list audio devices'));
});
asyncCheck('Output routing works while muted without starting a tone',async()=>{
  const e=environment({g1:['Me'],muted:true});await e.button('Refresh devices').onclick();const output=e.ui().querySelector('[aria-label="Assistant output device"]');
  output.value='headset';await output.onchange();e.setMe('Wrap Up',11);assert.equal(e.debug().playing.length,0);
  e.button('Unmute').onclick();assert(e.debug().playing.includes('disposition'));assert.equal(e.debug().audioOutput,'headset');
});
asyncCheck('Closing during an output switch prevents a late preference write or sound restart',async()=>{
  let finish;const pending=new Promise(resolve=>{finish=resolve;});
  const e=environment({}, {}, {beforeSink:()=>pending});await e.button('Refresh devices').onclick();
  const output=e.ui().querySelector('[aria-label="Assistant output device"]');output.value='headset';const changing=output.onchange();
  await Promise.resolve();e.button('x').onclick();finish();await changing;
  assert.equal(e.window.__itsCallAssist,undefined);assert.equal(e.jobs.size,0);assert.equal(e.deviceListeners.size,0);
  assert.equal(JSON.parse(e.storage.get('service-desk-8x8-preferences-v5')).outputDeviceId,'');
});
(async()=>{
  for(const {name,fn}of asyncChecks) {await fn();passed++;console.log('PASS:',name);}
  console.log(`${passed} scenarios passed.`);
})().catch(error=>{console.error(error);process.exitCode=1;});

