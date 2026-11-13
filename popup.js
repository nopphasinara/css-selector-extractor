const $ = id => document.getElementById(id);
let columns = [{name:'Title',selector:'',mode:'text'}];
let extracted = null;
let activeTabId = null;
let selectedPickerIndex = null;
let validated = false;
const status = message => { $('status').textContent = message; };
const save = () => chrome.storage.local.set({columns,container:$('container').value});
function invalidate() {
  validated = false;
  $('extract').disabled = false;
  $('checks').textContent = 'Selectors changed. Check matches before extracting.';
  $('checks').className = 'hint';
  extracted = null;
  $('results').replaceChildren();$('count').textContent='';
  $('copy').disabled = $('export').disabled = true;
}
function render() {
  $('selectors').replaceChildren();
  columns.forEach((col,index) => {
    const row=document.createElement('div');row.className='row';
    const name=document.createElement('input');name.placeholder='Column name';name.value=col.name;name.setAttribute('aria-label','Column name '+(index+1));
    const selector=document.createElement('input');selector.placeholder='e.g. .title';selector.value=col.selector;selector.spellcheck=false;selector.setAttribute('aria-label','CSS selector '+(index+1));
    const mode=document.createElement('select');mode.setAttribute('aria-label','Extract attribute '+(index+1));
    for(const value of ['text','href','src','value']){const opt=document.createElement('option');opt.value=value;opt.textContent=value;mode.append(opt);}mode.value=col.mode;
    const pick=document.createElement('button');pick.textContent='◎';pick.className='secondary';pick.title='Pick selector for this column';pick.setAttribute('aria-label','Pick selector for column '+(index+1));
    const remove=document.createElement('button');remove.textContent='×';remove.className='secondary';remove.title='Remove column';remove.setAttribute('aria-label','Remove column '+(index+1));
    const match=document.createElement('small');match.className='match-count';match.textContent='Not checked';match.dataset.column=index;
    name.addEventListener('input',()=>{col.name=name.value;save();});
    selector.addEventListener('input',()=>{col.selector=selector.value;invalidate();save();});
    mode.addEventListener('change',()=>{col.mode=mode.value;invalidate();save();});
    pick.addEventListener('click',()=>startPicker(index));
    remove.addEventListener('click',()=>{if(columns.length===1){status('At least one column is required.');return;}columns.splice(index,1);invalidate();render();save();});
    row.append(name,selector,mode,pick,remove);
    const group=document.createElement('div');group.className='selector-group';group.append(row,match);$('selectors').append(group);
  });
}
function tsv() {
  if(!extracted)return '';
  const sanitize=v=>String(v??'').replace(/\t/g,' ').replace(/\r?\n/g,' ');
  return [extracted.headers,...extracted.rows].map(row=>row.map(sanitize).join('\t')).join('\r\n');
}
function showResults(data) {
  extracted=data;const table=$('results');table.replaceChildren();
  const head=document.createElement('thead'),tr=document.createElement('tr');
  data.headers.forEach(value=>{const th=document.createElement('th');th.textContent=value;tr.append(th);});head.append(tr);table.append(head);
  const body=document.createElement('tbody');data.rows.slice(0,200).forEach(row=>{const tr=document.createElement('tr');row.forEach(value=>{const td=document.createElement('td');td.textContent=value;tr.append(td);});body.append(tr);});table.append(body);
  $('count').textContent=`(${data.rows.length} rows${data.rows.length>200?', first 200 shown':''})`;
  $('copy').disabled=$('export').disabled=false;
}
async function tab(){
  const [active]=await chrome.tabs.query({active:true,currentWindow:true});
  if(!active?.id||!/^https?:/.test(active.url||''))throw Error('Open a regular http(s) webpage first.');
  return active.id;
}
async function message(type,config){
  const tabId=await tab();
  await chrome.scripting.executeScript({target:{tabId},files:['page.js']});
  return chrome.tabs.sendMessage(tabId,{type,config});
}
async function startPicker(index=null){
  try {
    const tabId=await tab();
    selectedPickerIndex=index;
    await chrome.storage.local.set({pickerTarget:{tabId,index}});
    const result=await message('PICK');
    if(!result?.ok)throw Error(result?.error||'Picker failed');
    window.close();
  }catch(e){status(e.message);}
}
async function applyPendingPick(){
  const {pendingPick}=await chrome.storage.local.get('pendingPick');
  if(!pendingPick)return;
  const tabId=await tab().catch(()=>null);
  if(tabId!==pendingPick.tabId)return;
  let index=Number.isInteger(pendingPick.index)?pendingPick.index:columns.findIndex(c=>!c.selector.trim());
  if(index<0||index>=columns.length)index=columns.length;
  if(index===columns.length)columns.push({name:'Column '+(index+1),selector:'',mode:'text'});
  columns[index].selector=pendingPick.selector;
  invalidate();render();await save();
  await chrome.storage.local.remove('pendingPick');
  status(`Auto-filled selector into column ${index+1}. Press Check Matches to validate.`);
}
async function checkMatches(){
  if(columns.some(c=>!c.selector.trim()))throw Error('Enter a CSS selector for each column.');
  const response=await message('COUNT',{container:$('container').value,columns});
  if(!response?.ok)throw Error(response?.error||'Selector validation failed.');
  for(const item of response.data.columns){
    const label=document.querySelector(`.match-count[data-column="${item.index}"]`);
    if(label){label.textContent=`${item.count} matches${response.data.hasContainer?` (${item.withinRows} of ${response.data.rowCount} rows)` : ''}`;label.className='match-count '+(item.count?'matched':'no-match');}
  }
  const {rowCount,hasContainer,columns:counts}=response.data;
  $('checks').textContent=(hasContainer?`Row containers: ${rowCount}. `:'')+counts.map(c=>`${c.name}: ${c.count}`).join(' | ');
  $('checks').className='hint';validated=true;
  return response.data;
}
$('add').addEventListener('click',()=>{columns.push({name:'Column '+(columns.length+1),selector:'',mode:'text'});invalidate();render();save();});
$('container').addEventListener('input',()=>{invalidate();save();});
$('check').addEventListener('click',async()=>{
  status('Checking selectors…');
  try{const result=await checkMatches();status(`Checked ${result.columns.length} selectors.`);}catch(e){validated=false;status(e.message);}
});
$('extract').addEventListener('click',async()=>{
  status('Checking selectors before extraction…');
  try{
    const counts=await checkMatches();
    if(counts.columns.some(c=>c.count===0)||counts.hasContainer&&counts.rowCount===0){status('No matches for one or more selectors. Review counts before extraction.');return;}
    status('Extracting…');
    const response=await message('EXTRACT',{container:$('container').value,columns});
    if(!response?.ok)throw Error(response?.error||'Extraction failed');
    showResults(response.data);status(`Extracted ${response.data.rows.length} rows.`);
  }catch(e){status(e.message);}
});
$('picker').addEventListener('click',()=>startPicker());
$('copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(tsv());status('TSV copied.');}catch(e){status('Copy failed: '+e.message);}});
$('export').addEventListener('click',()=>{const blob=new Blob(['\uFEFF',tsv()],{type:'text/tab-separated-values;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='extracted-data.tsv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status('TSV exported.');});
(async()=>{try{const saved=await chrome.storage.local.get(['columns','container']);if(Array.isArray(saved.columns)&&saved.columns.length)columns=saved.columns;$('container').value=saved.container||'';render();await applyPendingPick();}catch(e){status(e.message);}})();
