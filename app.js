/* ════════════════════════════════════════════════════
   LINUXPATH — app.js  v4
   Multi-course architecture:
   - resources/index.json lists course folder names
   - resources/<id>/meta.json has title, icon, accent, files[]
   - resources/<id>/<file>.json contains { sections: [...] }
   - Multiple part files are merged in order
   - Each course has isolated localStorage state
════════════════════════════════════════════════════ */

let CURRICULUM      = null;
let COURSE_META     = null;
const SHUFFLE_CACHE = {};
let selectedToken   = null;
let draggedToken    = null;

let state = {
  sectionIdx : 0,
  lessonIdx  : 0,
  stepIdx    : 0,
  xp         : 0,
  streak     : 0,
  lastActive : null,
  hintUsed   : {},
  answered   : {},
  done       : {},
};

/* ════════════════════════════════════════════════════
   PERSISTENCE
════════════════════════════════════════════════════ */
const SAVE_PREFIX = 'linuxpath_v4_';
function saveKey()    { return SAVE_PREFIX + (COURSE_META?.id || 'default'); }
function saveState()  { try { localStorage.setItem(saveKey(), JSON.stringify(state)); } catch(e) {} }
function loadState()  { try { const r = localStorage.getItem(saveKey()); if (r) Object.assign(state, JSON.parse(r)); } catch(e) {} }
function clearState() { Object.assign(state,{sectionIdx:0,lessonIdx:0,stepIdx:0,xp:0,streak:0,lastActive:null,hintUsed:{},answered:{},done:{}}); }

function getSavedXP(courseId) {
  try { return JSON.parse(localStorage.getItem(SAVE_PREFIX + courseId))?.xp || 0; } catch(e) { return 0; }
}

/* ════════════════════════════════════════════════════
   HELPERS
════════════════════════════════════════════════════ */
const stepKey   = (si,li,sti) => `${si}-${li}-${sti}`;
const lessonKey = (si,li)     => `${si}-${li}`;
function currentSection() { return CURRICULUM.sections[state.sectionIdx]; }
function currentLesson()  { return currentSection().lessons[state.lessonIdx]; }
function currentStep()    { return currentLesson().steps[state.stepIdx]; }

function shuffled(arr, key) {
  if (!SHUFFLE_CACHE[key]) {
    const c = [...arr];
    for (let i = c.length-1; i > 0; i--) { const j = Math.floor(Math.random()*(i+1)); [c[i],c[j]]=[c[j],c[i]]; }
    SHUFFLE_CACHE[key] = c;
  }
  return SHUFFLE_CACHE[key];
}

function overallProgress() {
  let total=0, done=0;
  CURRICULUM.sections.forEach((s,si) => s.lessons.forEach((l,li) => l.steps.forEach((_,sti) => {
    total++;
    if (state.answered[stepKey(si,li,sti)]?.correct) done++;
  })));
  return total ? (done/total)*100 : 0;
}

function esc(str) {
  return String(str??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function parseText(text) {
  const e = String(text).replace(/&/g,'&amp;').replace(/</g,'§L§').replace(/>/g,'§G§').replace(/\n/g,'<br>');
  return e
    .replace(/§L§hl§G§(.*?)§L§\/hl§G§/g,   '<hl>$1</hl>')
    .replace(/§L§cmd§G§(.*?)§L§\/cmd§G§/g,  '<cmd>$1</cmd>')
    .replace(/§L§warn§G§(.*?)§L§\/warn§G§/g,'<warn>$1</warn>')
    .replace(/§L§/g,'&lt;').replace(/§G§/g,'&gt;');
}

function parseOutput(raw) {
  return String(raw)
    .replace(/<success>([\s\S]*?)<\/success>/g,'<span class="out-ok">$1</span>')
    .replace(/<e>([\s\S]*?)<\/e>/g,            '<span class="out-err">$1</span>')
    .replace(/<info>([\s\S]*?)<\/info>/g,       '<span class="out-inf">$1</span>');
}

/* ════════════════════════════════════════════════════
   STREAK + BADGES
════════════════════════════════════════════════════ */
function updateStreak() {
  const today = new Date().toDateString();
  const yest  = new Date(Date.now()-86400000).toDateString();
  if (state.lastActive !== today) {
    state.streak     = state.lastActive===yest ? state.streak+1 : 1;
    state.lastActive = today;
  }
  syncBadges();
}

function syncBadges() {
  ['streak','drawer-streak'].forEach(id => { const el=document.getElementById(id); if(el) el.textContent=state.streak; });
  ['xp-display','drawer-xp'].forEach(id => { const el=document.getElementById(id); if(el) el.textContent=state.xp; });
}

/* ════════════════════════════════════════════════════
   TOPBAR
════════════════════════════════════════════════════ */
function updateTopbar() {
  const sec=currentSection(), lesson=currentLesson(), sti=state.stepIdx, total=lesson.steps.length;
  document.getElementById('prog-lbl').textContent = `§${sec.id} · ${lesson.id} · ${sti+1}/${total}`;
  document.getElementById('prog-fill').style.width = overallProgress()+'%';
  syncBadges();
}

/* ════════════════════════════════════════════════════
   UI MODE — toggle between picker and course
════════════════════════════════════════════════════ */
function setCourseMode(on) {
  document.getElementById('layout').style.display             = on ? 'flex' : 'none';
  document.getElementById('course-picker').style.display      = on ? 'none' : 'flex';
  document.getElementById('back-to-courses').style.display    = on ? 'flex' : 'none';
  document.getElementById('topbar-course-info').style.display = on ? ''     : 'none';
  document.getElementById('top-right').style.display          = on ? ''     : 'none';
  // menu-btn: in course mode let CSS decide (hidden on desktop, flex on mobile)
  // in picker mode always hide it
  document.getElementById('menu-btn').style.display           = on ? '' : 'none';
}

/* ════════════════════════════════════════════════════
   MOBILE DRAWER
════════════════════════════════════════════════════ */
function openDrawer() {
  document.getElementById('drawer-nav').innerHTML = buildNavHTML(true);
  document.getElementById('drawer').classList.add('open');
  document.getElementById('drawer-overlay').classList.add('show');
  document.body.style.overflow = 'hidden';
  syncBadges();
}
function closeDrawer() {
  document.getElementById('drawer').classList.remove('open');
  document.getElementById('drawer-overlay').classList.remove('show');
  document.body.style.overflow = '';
}

/* ════════════════════════════════════════════════════
   NAV (sidebar + drawer share same builder)
════════════════════════════════════════════════════ */
const DIFF_STYLE = {
  beginner    : {bg:'#0f2a1e',br:'#1a4a30',tx:'#00d084'},
  intermediate: {bg:'#2a2108',br:'#4a3a0a',tx:'#f5a623'},
  advanced    : {bg:'#2a1010',br:'#4a1a1a',tx:'#ff5f57'},
};

function buildNavHTML(inDrawer=false) {
  if (!CURRICULUM) return '';
  let html = '';
  CURRICULUM.sections.forEach((sec,si) => {
    const dc = DIFF_STYLE[sec.difficulty]||DIFF_STYLE.beginner;
    const allDone  = sec.lessons.every((_,li) => state.done[lessonKey(si,li)]);
    const isCurSec = si===state.sectionIdx;
    html += `<div class="sb-sec">
      <div class="sb-sec-hdr" onclick="toggleSecBody(this)">
        <span class="sb-sec-title">${esc(sec.title)}</span>
        <span class="sb-sec-badge" style="background:${dc.bg};border:1px solid ${dc.br};color:${dc.tx}">
          ${allDone?'✓ done':esc(sec.difficulty)}
        </span>
      </div>
      <div class="sb-sec-body" style="display:${isCurSec?'block':'none'}">`;
    sec.lessons.forEach((lesson,li) => {
      const isActive = si===state.sectionIdx && li===state.lessonIdx;
      const isDone   = !!state.done[lessonKey(si,li)];
      const close    = inDrawer ? 'closeDrawer();' : '';
      html += `<div class="sb-item${isActive?' active':''}${isDone?' done':''}"
        onclick="${close}jumpTo(${si},${li})">
        <span class="sb-num">${esc(lesson.id)}</span>
        <span class="sb-label">${esc(lesson.title)}</span>
        <span class="sb-check">${isDone?'✓':''}</span>
      </div>`;
    });
    html += `</div><div class="sb-divider"></div></div>`;
  });
  return html;
}

function buildSidebar() { document.getElementById('sidebar').innerHTML = buildNavHTML(false); }
function toggleSecBody(hdr) { const b=hdr.nextElementSibling; b.style.display=b.style.display==='none'?'block':'none'; }
function jumpTo(si,li) { state.sectionIdx=si; state.lessonIdx=li; state.stepIdx=0; saveState(); buildSidebar(); renderLesson(); }

/* ════════════════════════════════════════════════════
   STEP DOTS
════════════════════════════════════════════════════ */
function stepDotsHTML(steps) {
  const cur = state.stepIdx;
  const dots = steps.map((_,i)=>`<div class="sdot ${i<cur?'done':i===cur?'active':''}"></div>`).join('');
  return `<div class="step-dots">${dots}<span class="step-counter">${cur+1} / ${steps.length}</span></div>`;
}

/* ════════════════════════════════════════════════════
   FEEDBACK + RETRY
════════════════════════════════════════════════════ */
function feedbackHTML(correct, fb) {
  const retry = !correct
    ? `<div style="margin-top:8px"><button class="retry-btn" onclick="retryStep()">↺ Try again</button></div>`
    : '';
  return `<div class="feedback ${correct?'ok':'bad'} show">
    <span class="fb-icon">${correct?'✓':'✗'}</span>
    <div style="flex:1">
      <span class="fb-title">${correct?'Correct!':'Not quite'}</span>
      <span class="fb-body">${esc(correct?fb.ok:fb.bad)}</span>
      ${retry}
    </div>
  </div>`;
}

function retryStep() {
  const key = stepKey(state.sectionIdx, state.lessonIdx, state.stepIdx);
  delete state.answered[key];
  delete SHUFFLE_CACHE[key+'-mcq'];
  delete SHUFFLE_CACHE[key+'-fill'];
  delete SHUFFLE_CACHE[key+'-reorder'];
  selectedToken = null;
  saveState();
  renderLesson();
}

/* ════════════════════════════════════════════════════
   RENDER — CONCEPT
════════════════════════════════════════════════════ */
function renderConcept(step) {
  let termHTML = '';
  if (step.terminal?.length) {
    const rows = step.terminal.map(r => {
      const out = r.output ? `<div class="t-row-out">${esc(r.output).replace(/\n/g,'<br>')}</div>` : '';
      return `<div><span class="t-row-prompt">${esc(r.prompt)} </span><span class="t-row-cmd">${esc(r.cmd)}</span></div>${out}`;
    }).join('');
    termHTML = `<div class="terminal">
      <div class="t-bar">
        <div class="t-dot" style="background:#ff5f57"></div>
        <div class="t-dot" style="background:#febc2e"></div>
        <div class="t-dot" style="background:#28c840"></div>
        <span class="t-title">bash — user@linux:~</span>
      </div>
      <div class="t-body">${rows}</div>
    </div>`;
  }
  return `<div class="card">
    <div class="card-lbl">${esc(step.label||'Concept')}</div>
    <div class="concept-body">${parseText(step.text)}</div>
    ${termHTML}
  </div>`;
}

/* ════════════════════════════════════════════════════
   RENDER — MCQ
════════════════════════════════════════════════════ */
function renderMCQ(step, answered) {
  const key   = stepKey(state.sectionIdx, state.lessonIdx, state.stepIdx);
  const ltrs  = ['A','B','C','D','E'];
  const pairs = shuffled(step.options.map((opt,i)=>({opt,origIdx:i})), key+'-mcq');
  const opts  = pairs.map(({opt,origIdx},di) => {
    let cls = '';
    if (answered) {
      if (origIdx===step.correct)                               cls='correct disabled';
      else if (origIdx===answered.origIdx && !answered.correct) cls='wrong disabled';
      else                                                      cls='disabled';
    }
    return `<div class="mcq-opt ${cls}" ${answered?'':` onclick="submitMCQ(${origIdx})"`}>
      <span class="mcq-letter">${ltrs[di]}</span><span>${esc(opt)}</span>
    </div>`;
  }).join('');
  const fb = answered ? feedbackHTML(answered.correct, step.feedback) : '';
  return `<div class="card">
    <div class="card-lbl">${esc(step.label||'Quick check')}</div>
    <div class="mcq-q">${esc(step.question)}</div>
    <div class="mcq-opts">${opts}</div>
    ${fb}
  </div>`;
}

/* ════════════════════════════════════════════════════
   RENDER — FILL
════════════════════════════════════════════════════ */
function renderFill(step, answered) {
  const key = stepKey(state.sectionIdx, state.lessonIdx, state.stepIdx);
  const sentence = step.sentence.map(part => {
    if (typeof part==='string') return `<span>${esc(part)}</span>`;
    const val = answered?.value?.[part.blank]??null;
    const cls = val ? (answered.correct?'filled':'wrong') : '';
    return `<span class="fill-blank ${cls}">${val?esc(val):'___'}</span>`;
  }).join('');
  const words = shuffled([...step.words], key+'-fill');
  const chips = words.map(w => {
    const used = answered?.value?.includes(w);
    return `<div class="word-chip ${used?'used':''}"
      ${answered?'style="pointer-events:none"':''}
      onclick="submitFill('${esc(w)}')">${esc(w)}</div>`;
  }).join('');
  const fb = answered ? feedbackHTML(answered.correct, step.feedback) : '';
  return `<div class="card">
    <div class="card-lbl">${esc(step.label||'Fill in the blank')}</div>
    <div class="fill-sentence">${sentence}</div>
    <div class="word-bank">${chips}</div>
    ${fb}
  </div>`;
}

/* ════════════════════════════════════════════════════
   RENDER — REORDER
════════════════════════════════════════════════════ */
function renderReorder(step, answered) {
  const key    = stepKey(state.sectionIdx, state.lessonIdx, state.stepIdx);
  const tokens = shuffled([...step.tokens], key+'-reorder');
  const placed = answered ? answered.placed : [];
  const inPool = tokens.filter(t => !placed.includes(t));
  const locked = !!answered;

  const mkToken = (t, loc) =>
    `<div class="token" draggable="${!locked}" data-token="${esc(t)}" data-loc="${loc}"
      ${locked?'':`ondragstart="dragStart(event)" ondragend="dragEnd(event)"`}
      onclick="tokenClick(this)">${esc(t)}</div>`;

  const zoneCls = answered ? (answered.correct?'correct':'wrong') : '';
  const hint    = !answered ? `<div class="reorder-hint">Tap to select a token, tap again to place it. Desktop: drag and drop.</div>` : '';
  const fb      = answered ? feedbackHTML(answered.correct, step.feedback) : '';

  return `<div class="card">
    <div class="card-lbl">${esc(step.label||'Reorder the command')}</div>
    <div class="reorder-instruction">${esc(step.instruction)}</div>
    ${hint}
    <div class="drop-zone-lbl">Your answer:</div>
    <div class="drop-zone ${zoneCls}" id="drop-zone"
      ${locked?'':`ondragover="dragOver(event)" ondragleave="dragLeave(event)" ondrop="dropToken(event)"`}>
      ${placed.map(t=>mkToken(t,'zone')).join('')}
    </div>
    <div class="drop-zone-lbl">Available tokens:</div>
    <div class="token-pool" id="token-pool">
      ${inPool.map(t=>mkToken(t,'pool')).join('')}
    </div>
    <button class="check-btn" ${answered?'style="display:none"':''} onclick="checkReorder()">Check answer</button>
    ${fb}
  </div>`;
}

/* ════════════════════════════════════════════════════
   RENDER — EDITOR
════════════════════════════════════════════════════ */
function renderEditor(step, answered) {
  const key      = stepKey(state.sectionIdx, state.lessonIdx, state.stepIdx);
  const hintUsed = !!state.hintUsed[key];
  const locked   = !!answered;
  const fb = answered ? feedbackHTML(answered.correct, {ok:'Great work!', bad:step.hint}) : '';

  return `<div class="card">
    <div class="card-lbl">${esc(step.label||'Write it yourself')}</div>
    <div class="editor-prompt">${esc(step.prompt)}</div>
    <textarea class="editor-input" id="cmd-input" rows="2"
      autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false"
      placeholder="${esc(step.placeholder||'type your command here...')}"
      ${locked?'readonly':''}>${esc(answered?answered.value:'')}</textarea>
    <div class="editor-row">
      <button class="run-btn" ${locked?'disabled':''} onclick="runEditor()">▶ Run</button>
      ${!locked?`<button class="hint-btn" onclick="showHint()">💡 Hint <span class="hint-penalty">(-5 XP)</span></button>`:''}
    </div>
    <div class="hint-box${hintUsed?' show':''}" id="hint-box">💡 ${esc(step.hint)}</div>
    ${answered
      ? `<div class="output-box show">${parseOutput(answered.correct?step.output.ok:step.output.bad)}</div>`
      : `<div class="output-box" id="output-box"></div>`}
    ${fb}
  </div>`;
}

/* ════════════════════════════════════════════════════
   MASTER RENDER
════════════════════════════════════════════════════ */
function renderLesson() {
  selectedToken = null;
  document.getElementById('complete').classList.remove('show');
  const area = document.getElementById('lesson-area');
  area.style.display = '';

  const sec    = currentSection();
  const lesson = currentLesson();
  const step   = currentStep();
  const si=state.sectionIdx, li=state.lessonIdx, sti=state.stepIdx;
  const key    = stepKey(si,li,sti);
  const answered = state.answered[key]??null;

  let stepHTML = '';
  if      (step.type==='concept') stepHTML = renderConcept(step);
  else if (step.type==='mcq')     stepHTML = renderMCQ(step, answered);
  else if (step.type==='fill')    stepHTML = renderFill(step, answered);
  else if (step.type==='reorder') stepHTML = renderReorder(step, answered);
  else if (step.type==='editor')  stepHTML = renderEditor(step, answered);

  const canNext    = step.type==='concept' || answered?.correct===true;
  const isLastStep = sti===lesson.steps.length-1;
  const isLastLsn  = li===currentSection().lessons.length-1;
  const isLastSec  = si===CURRICULUM.sections.length-1;
  const isVeryLast = isLastStep && isLastLsn && isLastSec;
  const nextLabel  = isVeryLast ? 'Finish 🎉' : isLastStep ? 'Next lesson →' : 'Continue →';

  area.innerHTML = `
    <div class="lesson-hdr">
      <div class="lesson-tag">Section ${esc(String(sec.id))} · Lesson ${esc(lesson.id)}</div>
      <div class="lesson-title">${esc(lesson.title)}</div>
      <div class="lesson-desc">${esc(lesson.description)}</div>
    </div>
    ${stepDotsHTML(lesson.steps)}
    ${stepHTML}
    <div class="nav-row">
      <button class="btn-back" onclick="goBack()">← Back</button>
      <button class="btn-next" id="btn-next" ${canNext?'':'disabled'} onclick="goNext()">
        ${nextLabel}
      </button>
    </div>`;

  updateTopbar();
  buildSidebar();
  window.scrollTo({top:0, behavior:'smooth'});
}

/* ════════════════════════════════════════════════════
   NAVIGATION
════════════════════════════════════════════════════ */
function goNext() {
  const lesson=currentLesson(), si=state.sectionIdx, li=state.lessonIdx;
  if (state.stepIdx < lesson.steps.length-1) {
    state.stepIdx++;
  } else {
    state.done[lessonKey(si,li)] = true;
    const sec = currentSection();
    if      (li < sec.lessons.length-1)         { state.lessonIdx++;  state.stepIdx=0; }
    else if (si < CURRICULUM.sections.length-1) { state.sectionIdx++; state.lessonIdx=0; state.stepIdx=0; }
    else { saveState(); showComplete(); return; }
  }
  saveState(); renderLesson();
}

function goBack() {
  if (state.stepIdx > 0) {
    state.stepIdx--;
  } else {
    const si=state.sectionIdx, li=state.lessonIdx;
    if      (li > 0) { state.lessonIdx--;  state.stepIdx=currentLesson().steps.length-1; }
    else if (si > 0) { state.sectionIdx--; state.lessonIdx=currentSection().lessons.length-1; state.stepIdx=currentLesson().steps.length-1; }
  }
  saveState(); renderLesson();
}

/* ════════════════════════════════════════════════════
   SUBMIT HANDLERS
════════════════════════════════════════════════════ */
function submitMCQ(origIdx) {
  const step=currentStep(), key=stepKey(state.sectionIdx,state.lessonIdx,state.stepIdx);
  if (state.answered[key]) return;
  const correct = origIdx===step.correct;
  state.answered[key] = {correct, origIdx, value:origIdx};
  if (correct) { addXP(step.xp||10); celebrate(); }
  saveState(); renderLesson();
}

function submitFill(word) {
  const step=currentStep(), key=stepKey(state.sectionIdx,state.lessonIdx,state.stepIdx);
  if (state.answered[key]) return;
  const correct = step.correct.includes(word);
  state.answered[key] = {correct, value:[word]};
  if (correct) { addXP(step.xp||15); celebrate(); }
  saveState(); renderLesson();
}

function runEditor() {
  const step=currentStep(), key=stepKey(state.sectionIdx,state.lessonIdx,state.stepIdx);
  if (state.answered[key]) return;
  const input    = (document.getElementById('cmd-input')?.value||'').trim();
  const correct  = step.expected.some(e => input.toLowerCase()===e.toLowerCase());
  const hintUsed = !!state.hintUsed[key];
  const xpEarned = correct ? Math.max((step.xp||20)-(hintUsed?5:0),0) : 0;
  state.answered[key] = {correct, value:input};
  if (correct) { addXP(xpEarned); celebrate(); }
  saveState(); renderLesson();
}

function checkReorder() {
  const step=currentStep(), key=stepKey(state.sectionIdx,state.lessonIdx,state.stepIdx);
  if (state.answered[key]) return;
  const zone = document.getElementById('drop-zone');
  if (!zone) return;
  const placed = [...zone.querySelectorAll('.token')].map(t=>t.dataset.token);
  const correct = placed.length===step.correct_order.length && placed.every((t,i)=>t===step.correct_order[i]);
  state.answered[key] = {correct, placed, value:placed};
  if (correct) { addXP(step.xp||15); celebrate(); }
  saveState(); renderLesson();
}

function showHint() {
  const key = stepKey(state.sectionIdx,state.lessonIdx,state.stepIdx);
  if (!state.hintUsed[key]) { state.hintUsed[key]=true; saveState(); }
  document.getElementById('hint-box')?.classList.add('show');
}

/* ════════════════════════════════════════════════════
   REORDER — DRAG (desktop)
════════════════════════════════════════════════════ */
function dragStart(e) { draggedToken = e.currentTarget; e.currentTarget.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; }
function dragEnd(e)   { e.currentTarget.classList.remove('dragging'); draggedToken=null; }
function dragOver(e)  { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }
function dragLeave(e) { e.currentTarget.classList.remove('drag-over'); }
function dropToken(e) {
  e.preventDefault();
  const zone=document.getElementById('drop-zone');
  if (!zone||!draggedToken) return;
  zone.classList.remove('drag-over');
  zone.appendChild(draggedToken);
  draggedToken.dataset.loc='zone';
}

/* ════════════════════════════════════════════════════
   REORDER — TAP (mobile)
════════════════════════════════════════════════════ */
function tokenClick(el) {
  const key = stepKey(state.sectionIdx,state.lessonIdx,state.stepIdx);
  if (state.answered[key]) return;
  const zone=document.getElementById('drop-zone');
  const pool=document.getElementById('token-pool');
  if (!zone||!pool) return;

  if (el.classList.contains('selected')) { el.classList.remove('selected'); selectedToken=null; return; }

  const prev = document.querySelector('.token.selected');
  if (prev) {
    const loc = prev.dataset.loc;
    if (loc==='pool') { zone.appendChild(prev); prev.dataset.loc='zone'; }
    else              { pool.appendChild(prev); prev.dataset.loc='pool'; }
    prev.classList.remove('selected'); selectedToken=null;
    return;
  }

  el.classList.add('selected');
  selectedToken = el.dataset.token;
}

document.addEventListener('click', e => {
  if (!selectedToken) return;
  const clickedToken = e.target.closest('.token');
  if (clickedToken) return;
  const zone=document.getElementById('drop-zone');
  const pool=document.getElementById('token-pool');
  if (!zone||!pool) return;
  const prev = document.querySelector('.token.selected');
  if (!prev) { selectedToken=null; return; }
  if (zone.contains(e.target) && prev.dataset.loc==='pool') {
    zone.appendChild(prev); prev.dataset.loc='zone';
    prev.classList.remove('selected'); selectedToken=null;
  } else if (pool.contains(e.target) && prev.dataset.loc==='zone') {
    pool.appendChild(prev); prev.dataset.loc='pool';
    prev.classList.remove('selected'); selectedToken=null;
  }
});

/* ════════════════════════════════════════════════════
   XP + CONFETTI
════════════════════════════════════════════════════ */
function addXP(amount) {
  if (!amount) return;
  state.xp += amount;
  syncBadges();
  const pop = document.createElement('div');
  pop.className='xp-pop'; pop.textContent=`+${amount} XP`;
  document.body.appendChild(pop);
  setTimeout(()=>pop.remove(), 800);
}

function celebrate(big=false) {
  const wrap=document.getElementById('confetti');
  const colors=['#00d084','#f5a623','#4fa3e3','#ff5f57','#c084fc','#fff'];
  const count=big?90:22;
  for (let i=0;i<count;i++) {
    const el=document.createElement('div');
    el.className='cp';
    const size=5+Math.random()*(big?9:5);
    el.style.cssText=`left:${Math.random()*100}%;top:-12px;width:${size}px;height:${size}px;background:${colors[i%colors.length]};animation-duration:${(big?1.2:.75)+Math.random()*.8}s;animation-delay:${Math.random()*.4}s;transform:rotate(${Math.random()*360}deg)`;
    wrap.appendChild(el);
    setTimeout(()=>el.remove(),2200);
  }
}

/* ════════════════════════════════════════════════════
   COMPLETE SCREEN
════════════════════════════════════════════════════ */
function showComplete() {
  document.getElementById('lesson-area').style.display='none';
  const el=document.getElementById('complete');
  el.classList.add('show');
  const msg = COURSE_META?.complete_message || 'Course complete!';
  const sub = COURSE_META?.complete_sub     || 'Great work finishing this course.';
  el.innerHTML=`
    <div class="complete-icon">🎉</div>
    <div class="complete-h">${esc(msg)}</div>
    <p class="complete-p">${esc(sub)}</p>
    <div class="complete-xp">⚡ ${state.xp} XP earned</div>
    <p style="font-size:12px;color:var(--text3);margin-top:4px">Up next: Permissions · Processes · Shell scripting · Networking</p>
    <div style="display:flex;gap:10px;margin-top:20px;flex-wrap:wrap;justify-content:center">
      <button class="btn-restart" onclick="restartAll()">↩ Restart course</button>
      <button class="btn-restart" style="background:var(--bg3);color:var(--text);border:1px solid var(--border2)" onclick="backToCourses()">← All courses</button>
    </div>`;
  celebrate(true); updateTopbar();
}

function restartAll() {
  clearState();
  Object.keys(SHUFFLE_CACHE).forEach(k=>delete SHUFFLE_CACHE[k]);
  saveState(); buildSidebar(); renderLesson();
}

/* ════════════════════════════════════════════════════
   COURSE PICKER
════════════════════════════════════════════════════ */
function showCoursePicker(metas) {
  setCourseMode(false);
  document.getElementById('loader').style.display = 'none';

  const grid = document.getElementById('course-grid');
  if (!metas.length) {
    grid.innerHTML = `<p style="color:var(--text2);text-align:center;grid-column:1/-1">
      No courses found. Add a folder to <code>resources/</code> and register it in <code>resources/index.json</code>.
    </p>`;
    return;
  }

  grid.innerHTML = metas.map(meta => {
    const accent      = meta.accent || '#00d084';
    const xp          = getSavedXP(meta.id);
    const hasProgress = xp > 0;
    const diff        = meta.difficulty || 'beginner';
    const dc          = DIFF_STYLE[diff] || DIFF_STYLE.beginner;

    return `<div class="course-card" onclick="launchCourse('${esc(meta.id)}')">
      <div class="cc-icon" style="background:${accent}18;border-color:${accent}2a">
        ${esc(meta.icon || '📚')}
      </div>
      <div class="cc-title">${esc(meta.title)}</div>
      <div class="cc-desc">${esc(meta.description)}</div>
      <div class="cc-meta">
        <span class="cc-diff" style="background:${dc.bg};border:1px solid ${dc.br};color:${dc.tx}">${esc(diff)}</span>
        ${meta.sections_count ? `<span class="cc-sections">${meta.sections_count} sections</span>` : ''}
      </div>
      ${hasProgress ? `<div class="cc-progress-row"><span class="cc-xp" style="color:${accent}">⚡ ${xp} XP earned</span></div>` : ''}
      <button class="cc-btn" style="background:${accent}">${hasProgress ? 'Continue →' : 'Start learning →'}</button>
    </div>`;
  }).join('');
}

/* ════════════════════════════════════════════════════
   LAUNCH A COURSE
════════════════════════════════════════════════════ */
async function launchCourse(courseId) {
  setCourseMode(false);
  const loader = document.getElementById('loader');
  loader.style.display = 'flex';
  loader.innerHTML = `<div class="loader-dot"></div>Loading course…`;

  try {
    /* 1. Load meta */
    const metaRes = await fetch(`resources/${courseId}/meta.json`);
    if (!metaRes.ok) throw new Error(`resources/${courseId}/meta.json not found (HTTP ${metaRes.status})`);
    COURSE_META = await metaRes.json();

    /* 2. Load all curriculum part files in order and merge sections */
    const parts = await Promise.all(
      COURSE_META.files.map(f =>
        fetch(`resources/${courseId}/${f}`)
          .then(r => { if (!r.ok) throw new Error(`${f} not found (HTTP ${r.status})`); return r.json(); })
      )
    );
    CURRICULUM = { sections: parts.flatMap(p => Array.isArray(p.sections) ? p.sections : []) };
    if (!CURRICULUM.sections.length) throw new Error('No sections found in curriculum files.');

    /* 3. Restore or initialise state */
    clearState();
    loadState();
    updateStreak();
    state.sectionIdx = Math.min(state.sectionIdx, CURRICULUM.sections.length-1);
    state.lessonIdx  = Math.min(state.lessonIdx,  currentSection().lessons.length-1);
    state.stepIdx    = Math.min(state.stepIdx,    currentLesson().steps.length-1);

    /* 4. Enter course UI */
    loader.style.display = 'none';
    setCourseMode(true);
    buildSidebar();
    renderLesson();

  } catch(err) {
    loader.innerHTML = `
      <div style="color:var(--red);font-size:13px;text-align:center;line-height:1.8;max-width:320px;padding:0 16px">
        <div style="font-size:28px;margin-bottom:10px">⚠</div>
        Failed to load course:<br>
        <code style="font-size:11px;color:var(--text2)">${esc(err.message)}</code><br><br>
        <button onclick="backToCourses()"
          style="background:var(--bg3);border:1px solid var(--border2);color:var(--text);border-radius:8px;padding:9px 18px;cursor:pointer;font-size:12px">
          ← Back to courses
        </button>
      </div>`;
  }
}

/* ════════════════════════════════════════════════════
   BACK TO COURSE PICKER
════════════════════════════════════════════════════ */
function backToCourses() {
  CURRICULUM  = null;
  COURSE_META = null;
  clearState();
  Object.keys(SHUFFLE_CACHE).forEach(k => delete SHUFFLE_CACHE[k]);
  closeDrawer();
  document.getElementById('lesson-area').style.display = 'none';
  document.getElementById('complete').classList.remove('show');
  document.getElementById('sidebar').innerHTML = '';
  boot();
}

/* ════════════════════════════════════════════════════
   BOOT — loads resources/index.json and shows picker
════════════════════════════════════════════════════ */
async function boot() {
  setCourseMode(false);
  const loader = document.getElementById('loader');
  loader.style.display = 'flex';
  loader.innerHTML = `<div class="loader-dot"></div>Loading courses…`;

  try {
    const res = await fetch('resources/index.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const index = await res.json();
    if (!Array.isArray(index.courses) || !index.courses.length) throw new Error('No courses listed in resources/index.json');

    /* Load all meta files in parallel; skip broken ones gracefully */
    const metas = await Promise.all(
      index.courses.map(id =>
        fetch(`resources/${id}/meta.json`).then(r => r.ok ? r.json() : null).catch(() => null)
      )
    );

    showCoursePicker(metas.filter(Boolean));

  } catch(err) {
    loader.innerHTML = `
      <div style="color:var(--red);font-size:13px;text-align:center;line-height:1.8;max-width:320px;padding:0 16px">
        <div style="font-size:28px;margin-bottom:10px">⚠</div>
        Could not load <code>resources/index.json</code><br>
        Both files must be served over HTTP:<br><br>
        <code style="color:var(--text3);font-size:11px">python3 -m http.server</code><br>
        <code style="color:var(--text3);font-size:11px">open http://localhost:8000</code>
      </div>`;
  }
}

boot();
