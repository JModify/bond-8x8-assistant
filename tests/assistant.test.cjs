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
function environment(preferences = {g1:['Me'], lunchMinutes:30}, sounds = {}) {
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
  const group=add('div',document.body);
  const agents={};
  for(const name of ['Alex Agent','Casey Agent']){
    const row=add('div',group,{'data-test-id':'agent-item','aria-label':name});
    add('span',row,{'data-test-id':'agent-name-label',title:name},name);
    const status=add('div',row,{'data-status-value':'Available'});
    const timer=add('div',row,{'data-test-id':'user-presence-timer'},'0s');
    agents[name]={status,timer};
  }
  const queues=[];
  for(const name of ['Demo Academic Queue','Demo Transfer Queue','Demo Outbound Queue','Demo Service Queue']){
    const row=add('div',document.body,{'data-test-id':'queue-item'});
    add('span',row,{'data-test-id':'queue-name',title:name},name);
    const cell=add('span',row,{role:'gridcell',title:'0 Interactions waiting'},'0');
    queues.push({row,cell});
  }
  const schedule=(fn,ms)=>{const id=++nextId;jobs.set(id,{fn,ms});return id;};
  class AudioContext {
    constructor(){this.state='running';this.currentTime=0;this.destination={};}
    resume(){this.state='running';return Promise.resolve();}close(){this.state='closed';return Promise.resolve();}
    createOscillator(){return{frequency:{value:0},connect(){},disconnect(){},start(){},stop(){}};}
    createGain(){return{gain:{setValueAtTime(){},linearRampToValueAtTime(){}},connect(){},disconnect(){}};}
  }
  class Notification {
    static permission='granted';
    constructor(title,options){this.title=title;this.options=options;this.closed=false;notifications.push(this);}
    close(){this.closed=true;}
  }
  const window={document,location:{hostname:'vcc-au2.8x8.com',origin:'https://vcc-au2.8x8.com'},
    navigator:{onLine:true},AudioContext,Notification,
    localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)},
    setInterval:schedule,setTimeout:schedule,clearInterval:id=>jobs.delete(id),clearTimeout:id=>jobs.delete(id),
    getComputedStyle:n=>({display:n.classList.contains('hidden')?'none':'block',visibility:'visible'}),
    MutationObserver:class{observe(){}disconnect(){}},focus(){}};
  window.top=window;document.defaultView=window;
  class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  const source=original.replace('root.__itsCallAssist = {destroy, inspect:() => lastSample};',
    'root.__itsCallAssist = {destroy, inspect:() => lastSample, debug:()=>({activeReminder,playing:[...sounds.keys()],running}), rescan:safeScan};');
  vm.runInNewContext(source,{window,location:window.location,Date:Clock,console},{timeout:1000});
  const ui=()=>document.body.querySelector('#its-call-assist-panel').shadowRoot;
  const scan=()=>{now+=2000;window.__itsCallAssist.rescan();};
  const setMe=(status,seconds)=>{meStatus.setAttribute('data-status-value',status);meTimer.textContent=seconds+'s';scan();};
  const other=(name,status,seconds)=>{agents[name].status.setAttribute('data-status-value',status);agents[name].timer.textContent=seconds+'s';};
  return {window,ui,scan,setMe,other,jobs,storage,notifications,queues,group,header,meTimer,meStatus,
    setTime:time=>{now=time;},advance:ms=>{now+=ms;window.__itsCallAssist.rescan();},
    rerun:()=>vm.runInNewContext(source,{window,location:window.location,Date:Clock,console},{timeout:1000}),
    debug:()=>window.__itsCallAssist.debug(),
    checkbox:name=>ui().querySelector(`[aria-label="G1: ${name}"]`),
    button:name=>ui().querySelectorAll('button').find(n=>n.textContent===name),
    waiting:n=>{queues[3].cell.textContent=String(n);queues[3].cell.setAttribute('title',`${n} Interactions waiting`);},
    tick:(name,value)=>{const b=ui().querySelector(`[aria-label="G1: ${name}"]`);b.checked=value;b.onchange();},
    lunch:minutes=>{const input=ui().querySelector('#its-my-lunch-minutes');input.value=String(minutes);input.oninput();}
  };
}
check('Me is selectable and reveals a 1–120 minute lunch slider',()=>{
  const e=environment({g1:['Alex Agent'],lunchMinutes:30});
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
  const e=environment({g1:['Me','Alex Agent'],lunchMinutes:30});
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
  const e=environment({g1:['Me'],lunchMinutes:10});e.setMe('On Break',601);
  e.lunch(20);assert.equal(e.debug().activeReminder,null);assert(!e.debug().playing.includes('lunchOverdue'));
  const saved=JSON.parse(e.storage.get('service-desk-8x8-preferences-v5'));
  assert.equal(saved.lunchMinutes,20);assert.deepEqual(saved.g1,['Me']);
});
check('Other unavailable self states use the existing Available alarm',()=>{
  const e=environment();e.setMe('Work Offline',2);assert.equal(e.debug().activeReminder.kind,'critical');
  e.setMe('Busy',0);assert.equal(e.debug().activeReminder,null);assert(!e.debug().playing.includes('critical'));
});
check('New sound settings have separate defaults and disabled repeat durations',()=>{
  const e=environment();const cards=e.ui().querySelectorAll('fieldset');assert.equal(cards.length,5);
  for(const [label,preset,volume]of [['Alert: Complete Disposition','Urgent pulse','80'],['Alert: Lunch Break Finished','Digital ring','85']]){
    const card=cards.find(n=>n.querySelector('legend').textContent===label);
    assert.equal(card.querySelector('select').value,preset);
    assert.equal(String(card.querySelector('[type="range"]').value),volume);
    assert(card.querySelector('[type="number"]').disabled);
    const repeat=card.querySelector('[type="checkbox"]');repeat.checked=false;repeat.onchange();
    assert(!card.querySelector('[type="number"]').disabled);
  }
});
check('Pause, hidden queues and removal stop the new alarms',()=>{
  for(const action of ['Pause','hidden','Remove']){
    const e=environment();e.setMe('Wrap Up',11);
    if(action==='hidden'){e.queues[0].row.hidden=true;e.scan();assert(e.ui().querySelector('.unavailable').textContent.includes('Unable to Assist'));}
    else e.button(action==='Remove'?'x':action).onclick();
    if(action==='Remove'){assert.equal(e.window.__itsCallAssist,undefined);assert.equal(e.jobs.size,0);}
    else assert(!e.debug().playing.includes('disposition'));
  }
});
check('Unticking Me stops personal alarms and hides the lunch control',()=>{
  const e=environment({g1:['Me','Alex Agent'],lunchMinutes:30});e.setMe('Wrap Up',11);e.tick('Me',false);
  assert(!e.debug().playing.includes('disposition'));assert.equal(e.window.__itsCallAssist.inspect().mode,'assisting');
});
check('G2 still reports another selected agent going on break',()=>{
  const e=environment({g1:['Alex Agent'],lunchMinutes:30});e.setMe('Available',2);e.other('Alex Agent','On Break',1);e.setMe('Available',4);
  assert(e.notifications.some(n=>n.title==='Info: G1 On Break'));
});
check('A finite custom reminder does not restart within the same condition',()=>{
  const e=environment({g1:['Me'],lunchMinutes:30},{disposition:{preset:'Soft bell',volume:40,seconds:2,repeat:false}});
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
check('Outbound waiting is ignored and its row is not required',()=>{
  const e=environment({g1:['Alex Agent'],lunchMinutes:30});
  e.queues[2].cell.textContent='50';e.queues[2].cell.setAttribute('title','50 Interactions waiting');
  e.other('Alex Agent','Busy',240);e.setMe('Work Offline',1);
  e.other('Alex Agent','Busy',241);e.other('Casey Agent','Available',1);e.setMe('Work Offline',2);
  assert.equal(e.notifications.length,0);assert.equal(e.window.__itsCallAssist.inspect().queues.length,3);
  assert(!e.window.__itsCallAssist.inspect().queues.some(q=>q.name==='Demo Outbound Queue'));
  e.queues[2].row.hidden=true;e.scan();assert.equal(e.window.__itsCallAssist.inspect().unavailable,false);
  e.waiting(1);e.setMe('Work Offline',3);assert(e.notifications.some(n=>n.title==='Alert: Change Status To Available'));
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
check('Settings preserve custom values and existing sound choices',()=>{
  const e=environment({g1:['Me'],lunchMinutes:45,dispositionSeconds:15,callMinutes:4,coverMinutes:6,desktopNotifications:false},
    {critical:{preset:'Soft bell',volume:32,seconds:4,repeat:false}});
  const sample=e.window.__itsCallAssist.inspect();assert.equal(sample.dispositionSeconds,15);assert.equal(sample.callMinutes,4);assert.equal(sample.coverMinutes,6);
  assert.equal(e.ui().querySelector('#its-desktop-notifications').checked,false);
  const critical=e.ui().querySelectorAll('fieldset').find(n=>n.querySelector('legend').textContent==='Alert: Change Status To Available');
  assert.equal(critical.querySelector('select').value,'Soft bell');
  assert(critical.querySelector('.sound-description').textContent.includes('at least 6 minutes'));
  const input=e.ui().querySelector('#its-call-minutes');input.value='7';input.onchange();
  const saved=JSON.parse(e.storage.get('service-desk-8x8-preferences-v5'));
  assert.equal(saved.callMinutes,7);assert.equal(saved.lunchMinutes,45);assert.equal(saved.desktopNotifications,false);
  const caller=e.ui().querySelectorAll('fieldset').find(n=>n.querySelector('legend').textContent==='Info: Caller Waiting');
  assert(caller.querySelector('.sound-description').textContent.includes('more than 7 minutes'));
});
check('Desktop notifications can be disabled without silencing alerts',()=>{
  const e=environment({g1:['Me'],lunchMinutes:30,desktopNotifications:false});e.setMe('Wrap Up',11);
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
check('Custom group delays preserve strict caller and inclusive cover boundaries',()=>{
  const context={normal:s=>s.toLowerCase().trim(),QUEUES:['a','b','c']};vm.createContext(context);
  const start=original.indexOf('  function groupRules('),end=original.indexOf('  function dispositionStatus(',start);
  vm.runInContext(original.slice(start,end),context);
  const q=[{waiting:1},{waiting:0},{waiting:0}],me={status:'Work Offline'},delay={callMinutes:4,coverMinutes:6};
  const run=s=>context.groupRules([{name:'Agent',status:'Busy',seconds:s}],q,[{status:'Available'}],me,delay);
  assert.equal(run(240).call.length,0);assert.equal(run(241).call.length,1);assert.equal(run(359).critical,false);assert.equal(run(360).critical,true);
});

check('Release reports version 1.0.1 and bottom controls are only Pause / Settings',()=>{
  const e=environment();assert.equal(e.window.__itsCallAssist.version,'1.0.1');
  assert.deepEqual(e.ui().querySelector('.controls').querySelectorAll('button').map(b=>b.textContent),['Pause','Settings']);
  assert.deepEqual(e.ui().querySelector('.window-actions').querySelectorAll('button').map(b=>b.textContent),['-','x']);
  assert(e.ui().querySelector('.version').textContent.includes('1.0.1'));
});
check('Minimise and restore use the top button; close removes the assistant',()=>{
  const e=environment();e.button('-').onclick();assert(e.ui().querySelector('.monitor-grid').parentElement.classList.contains('hidden'));
  e.button('+').onclick();assert(!e.ui().querySelector('.monitor-grid').parentElement.classList.contains('hidden'));
  e.button('x').onclick();assert.equal(e.window.__itsCallAssist,undefined);assert.equal(e.jobs.size,0);
});
check('G2 explanation appears below Agents and the two finite-sound stop lines are gone',()=>{
  const e=environment();assert(e.ui().querySelector('.agent-help').textContent.includes('Group 2 (G2)'));
  for(const label of ['Info: G1 On Break','Info: Caller Waiting']){
    const card=e.ui().querySelectorAll('fieldset').find(n=>n.querySelector('legend').textContent===label);
    assert(!card.querySelector('.sound-description').textContent.includes('Stops when'));
    assert(card.querySelector('.sound-description').textContent.includes('G2'));
  }
  assert(!e.ui().textContent.includes('outside G1'));
});
check('Each observed transition to Busy counts once, regardless of G1 selection',()=>{
  const e=environment({g1:['Alex Agent'],lunchMinutes:30});
  e.setMe('Busy',0);assert.equal(e.window.__itsCallAssist.statistics().total,1);
  e.setMe('Busy',3);e.setMe('Busy',30);assert.equal(e.window.__itsCallAssist.statistics().total,1);
  e.setMe('Wrap Up',1);e.setMe('Available',1);e.setMe('Busy',0);assert.equal(e.window.__itsCallAssist.statistics().total,2);
});
check('Pausing freezes Checked, agent values, last-call time, queues and alert sample',()=>{
  const e=environment();e.setMe('Available',5);
  e.button('Pause').onclick();
  const status=e.ui().querySelector('pre').textContent;
  const table=e.ui().querySelector('tbody').textContent;
  const last=e.ui().querySelector('.statistics').querySelectorAll('.stat-value')[2].textContent;
  const sample=JSON.stringify(e.window.__itsCallAssist.inspect());
  assert(status.startsWith('PAUSED'));
  e.waiting(4);e.other('Alex Agent','Busy',500);e.setMe('Busy',0);e.setMe('Busy',4);
  assert.equal(e.ui().querySelector('pre').textContent,status);
  assert.equal(e.ui().querySelector('tbody').textContent,table);
  assert.equal(e.ui().querySelector('.statistics').querySelectorAll('.stat-value')[2].textContent,last);
  assert.equal(JSON.stringify(e.window.__itsCallAssist.inspect()),sample);
  assert.equal(e.window.__itsCallAssist.statistics().total,1);
  assert.equal(e.ui().querySelector('.stat-total').textContent,'1');
  assert.equal(e.notifications.length,0);assert.equal(e.debug().playing.length,0);
});
check('Resume catches up to current page values and delayed statistics without recounting Busy',()=>{
  const e=environment();e.setMe('Available',5);e.button('Pause').onclick();e.setMe('Busy',20);e.waiting(3);
  e.button('Resume').onclick();assert.equal(e.window.__itsCallAssist.inspect().me.timer,'20s');
  assert(e.ui().querySelector('pre').textContent.includes('3 waiting'));
  assert.equal(e.ui().querySelector('.statistics').querySelectorAll('.stat-value')[1].textContent,'1');
  assert.equal(e.window.__itsCallAssist.statistics().total,1);
});
check('Pause also stops an active alarm and blocks previews',()=>{
  const e=environment();e.setMe('Wrap Up',11);assert(e.debug().playing.includes('disposition'));
  e.button('Pause').onclick();assert.equal(e.debug().playing.length,0);
  e.button('Settings').onclick();e.button('Open Sound Settings').onclick();
  const preview=e.ui().querySelectorAll('button').find(b=>b.textContent==='Preview');assert(preview.disabled);
  preview.onclick();assert.equal(e.debug().playing.length,0);
  e.setMe('Work Offline',1);assert.equal(e.debug().playing.length,0);
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
  assert(e.ui().querySelector('.statistics-note').textContent.includes('incomplete'));
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
check('Calls last hour expire only in the running display',()=>{
  const e=environment();e.setMe('Busy',0);e.setMe('Available',0);
  const hour=e.ui().querySelector('.statistics').querySelectorAll('.stat-value')[1];assert.equal(hour.textContent,'1');
  e.button('Pause').onclick();e.advance(3601000);assert.equal(hour.textContent,'1');
  e.button('Resume').onclick();assert.equal(hour.textContent,'0');assert.equal(e.window.__itsCallAssist.statistics().total,1);
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
console.log(`${passed} scenarios passed.`);
