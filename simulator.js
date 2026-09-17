const QCOLOR = { 0: 'q0', 1: 'q1', 2: 'q2' };
let userTasks = [];
let engine = null;
let playTimer = null;
let originalTasksForCompare = null;

function renderTaskList() {
  const el = document.getElementById('taskList');
  if (userTasks.length === 0) {
    el.innerHTML = '<div class="empty-note" style="padding:14px 0;">No tasks yet.</div>';
    return;
  }
  const colorVar = { 0: '--emergency', 1: '--interactive', 2: '--background-q' };
  el.innerHTML = userTasks.map((t, i) => `
    <div class="task-row">
      <div class="bar" style="background:var(${colorVar[t.queue]})"></div>
      <div>
        <div class="name">${t.name} <span class="queue-tag ${QCOLOR[t.queue]}">${QUEUE_NAME[t.queue]}</span></div>
        <div class="meta">arrival t=${t.arrival} · burst=${t.burst} · priority=${t.basePriority}</div>
      </div>
      <button data-i="${i}" class="rm">×</button>
    </div>`).join('');
  el.querySelectorAll('.rm').forEach(b => b.addEventListener('click', () => {
    userTasks.splice(+b.dataset.i, 1); renderTaskList();
  }));
}

document.getElementById('btnAdd').addEventListener('click', () => {
  const name = document.getElementById('fName').value.trim() || 'Untitled task';
  const queue = +document.getElementById('fQueue').value;
  const priority = +document.getElementById('fPriority').value;
  const arrival = +document.getElementById('fArrival').value;
  const burst = +document.getElementById('fBurst').value;
  userTasks.push({ name, queue, arrival, burst, basePriority: priority });
  document.getElementById('fName').value = '';
  renderTaskList();
});

document.getElementById('btnClear').addEventListener('click', () => { userTasks = []; renderTaskList(); resetRun(); });

document.getElementById('btnPresetHospital').addEventListener('click', () => {
  userTasks = HOSPITAL_DEMO_WORKLOAD.map(t => ({ ...t }));
  renderTaskList(); resetRun();
});

document.getElementById('btnPresetStress').addEventListener('click', () => {
  userTasks = generateStarvationStressWorkload(1, 150);
  renderTaskList(); resetRun();
});

function resetRun() {
  clearInterval(playTimer); playTimer = null;
  engine = null;
  document.getElementById('statusPill').textContent = 'IDLE';
  document.getElementById('statusPill').className = 'status-pill';
  document.getElementById('ganttWrap').innerHTML = '<div class="empty-note">Add tasks (or load a preset) and press Run.</div>';
  document.getElementById('nowBadge').textContent = '— idle —';
  document.getElementById('nowBadge').className = 'badge';
  document.getElementById('tickLabel').textContent = 't = 0';
  document.getElementById('resultsPanel').style.display = 'none';
  document.getElementById('comparePanel').style.display = 'none';
  ['tElapsed', 'tUtil', 'tWait', 'tEmerg'].forEach(id => document.getElementById(id).textContent = '0');
  document.getElementById('tBg').textContent = 'OK';
  document.getElementById('tileBg').className = 'tile';
  document.getElementById('btnRun').textContent = '▶ Run simulation';
}
document.getElementById('btnReset').addEventListener('click', resetRun);

function startEngine() {
  if (userTasks.length === 0) { alert('Add at least one task or load a preset first.'); return null; }
  originalTasksForCompare = JSON.parse(JSON.stringify(userTasks));
  const e = newEngine(cloneTasks(userTasks));
  document.getElementById('ganttWrap').innerHTML = buildGanttSkeleton(e.all);
  document.getElementById('resultsPanel').style.display = 'none';
  document.getElementById('comparePanel').style.display = 'none';
  return e;
}

function buildGanttSkeleton(procs) {
  const rows = procs.map(p => `
    <div class="gantt-row" data-pid="${p.pid}">
      <div class="pid-label">${p.pid}</div>
      <div class="gantt-track" id="track-${p.pid}"></div>
    </div>`).join('');
  return rows + '<div class="gantt-axis" id="ganttAxis"></div>';
}

const PX_PER_TICK = 14;

function paintTick(e, info) {
  document.getElementById('tickLabel').textContent = 't = ' + e.time;
  const badge = document.getElementById('nowBadge');
  if (info && !info.idle) {
    badge.textContent = info.name + ' (' + QUEUE_NAME[info.queue] + ')';
    badge.className = 'badge ' + QCOLOR[info.queue];
    const track = document.getElementById('track-' + info.pid);
    if (track) {
      const block = document.createElement('div');
      block.className = 'gantt-block ' + QCOLOR[info.queue];
      block.style.left = (e.time - 1) * PX_PER_TICK + 'px';
      block.style.width = (PX_PER_TICK - 1) + 'px';
      track.appendChild(block);
      track.style.width = e.time * PX_PER_TICK + 'px';
    }
  } else {
    badge.textContent = '— idle —';
    badge.className = 'badge';
  }
  const axis = document.getElementById('ganttAxis');
  if (axis && e.time % 5 === 0) {
    axis.style.width = e.time * PX_PER_TICK + 'px';
    axis.textContent = 'now → t=' + e.time;
  }
  document.getElementById('ganttWrap').scrollLeft = e.time * PX_PER_TICK;

  const { rows, util } = report(e);
  const finishedRows = rows.filter(r => r.completion !== null);
  const avgWait = finishedRows.length ? (finishedRows.reduce((s, r) => s + r.waiting, 0) / finishedRows.length) : 0;
  const emgRows = finishedRows.filter(r => r.queue === 'Emergency');
  const avgEmg = emgRows.length ? (emgRows.reduce((s, r) => s + r.response, 0) / emgRows.length) : 0;
  const bgRows = rows.filter(r => r.queue === 'Background');
  const bgPromotions = bgRows.reduce((s, r) => s + r.promotions, 0);
  const bgStillWaiting = bgRows.some(r => r.completion === null);

  document.getElementById('tElapsed').textContent = e.time;
  document.getElementById('tUtil').textContent = util.toFixed(0);
  document.getElementById('tWait').textContent = avgWait.toFixed(1);
  document.getElementById('tEmerg').textContent = avgEmg.toFixed(1);
  const tileBg = document.getElementById('tileBg');
  const tBg = document.getElementById('tBg');
  if (bgStillWaiting && bgPromotions === 0) { tBg.textContent = 'WAITING'; tileBg.className = 'tile'; }
  else if (bgPromotions > 0) { tBg.textContent = 'AGED ×' + bgPromotions; tileBg.className = 'tile good'; }
  else { tBg.textContent = 'OK'; tileBg.className = 'tile good'; }
}

function finalizeRun(e) {
  const { rows } = report(e);
  document.getElementById('resultsPanel').style.display = 'block';
  const tbl = document.getElementById('resultsTable');
  tbl.innerHTML = `<tr><th>PID</th><th>Name</th><th>Queue</th><th>Arr</th><th>Burst</th>
    <th>Compl.</th><th>Wait</th><th>Resp.</th><th>Promotions</th></tr>` +
    rows.map(r => `<tr>
      <td>${r.pid}</td><td>${r.name}</td><td><span class="queue-tag ${QCOLOR[{Emergency:0,Interactive:1,Background:2}[r.queue]]}">${r.queue}</span></td>
      <td>${r.arrival}</td><td>${r.burst}</td>
      <td>${r.completion !== null ? r.completion : '—'}</td><td>${r.waiting}</td>
      <td>${r.response !== null ? r.response : '—'}</td><td>${r.promotions}</td>
    </tr>`).join('');

  const fcfs = runFcfsBaseline(originalTasksForCompare);
  const amqEmg = rows.filter(r => r.queue === 'Emergency' && r.response !== null);
  const fcfsEmg = fcfs.rows.filter(r => r.queue === 'Emergency');
  const amqEmgAvg = amqEmg.length ? amqEmg.reduce((s, r) => s + r.response, 0) / amqEmg.length : 0;
  const fcfsEmgAvg = fcfsEmg.length ? fcfsEmg.reduce((s, r) => s + r.response, 0) / fcfsEmg.length : 0;
  const amqWaitAvg = rows.length ? rows.reduce((s, r) => s + r.waiting, 0) / rows.length : 0;
  const fcfsWaitAvg = fcfs.rows.length ? fcfs.rows.reduce((s, r) => s + r.waiting, 0) / fcfs.rows.length : 0;
  const finishedForTat = rows.filter(r => r.turnaround !== null);
  const amqTatAvg = finishedForTat.length ? finishedForTat.reduce((s, r) => s + r.turnaround, 0) / finishedForTat.length : 0;
  const fcfsTatAvg = fcfs.rows.length ? fcfs.rows.reduce((s, r) => s + r.turnaround, 0) / fcfs.rows.length : 0;

  const metrics = [
    { label: 'Emergency response time (ticks)', fcfs: fcfsEmgAvg, amq: amqEmgAvg },
    { label: 'Average waiting time (ticks)', fcfs: fcfsWaitAvg, amq: amqWaitAvg },
    { label: 'Average turnaround time (ticks)', fcfs: fcfsTatAvg, amq: amqTatAvg },
  ];
  const maxVal = Math.max(...metrics.map(m => Math.max(m.fcfs, m.amq)), 1);
  document.getElementById('comparePanel').style.display = 'block';
  document.getElementById('compareBars').innerHTML = metrics.map(m => `
    <div class="compare-metric">
      <div class="label">${m.label}</div>
      <div class="bar-line"><div class="name">FCFS</div>
        <div class="track"><div class="fill fcfs" style="width:${(m.fcfs / maxVal * 100).toFixed(1)}%"></div></div>
        <div class="num">${m.fcfs.toFixed(1)}</div></div>
      <div class="bar-line"><div class="name">AMQ</div>
        <div class="track"><div class="fill amq" style="width:${(m.amq / maxVal * 100).toFixed(1)}%"></div></div>
        <div class="num">${m.amq.toFixed(1)}</div></div>
    </div>`).join('');

  document.getElementById('statusPill').textContent = 'DONE';
  document.getElementById('statusPill').className = 'status-pill done';
  document.getElementById('nowBadge').textContent = '— simulation complete —';
  document.getElementById('nowBadge').className = 'badge';
}

function stepSimulation() {
  if (!engine) {
    engine = startEngine(); if (!engine) return;
    document.getElementById('statusPill').textContent = 'RUNNING';
    document.getElementById('statusPill').className = 'status-pill running';
  }
  if (engine.done) { finalizeRun(engine); clearInterval(playTimer); playTimer = null; return; }
  const info = tickOnce(engine);
  paintTick(engine, info);
  if (engine.done || engine.time > 500) { finalizeRun(engine); clearInterval(playTimer); playTimer = null; }
}
document.getElementById('btnStep').addEventListener('click', stepSimulation);

document.getElementById('btnRun').addEventListener('click', () => {
  if (playTimer) {
    clearInterval(playTimer); playTimer = null;
    document.getElementById('btnRun').textContent = '▶ Run simulation';
    return;
  }
  if (!engine) { engine = startEngine(); if (!engine) return; }
  document.getElementById('statusPill').textContent = 'RUNNING';
  document.getElementById('statusPill').className = 'status-pill running';
  document.getElementById('btnRun').textContent = '⏸ Pause';
  const speed = +document.getElementById('speedRange').value;
  const delay = Math.max(15, 260 - speed * 24);
  playTimer = setInterval(() => {
    stepSimulation();
    if (!engine || engine.done) {
      clearInterval(playTimer); playTimer = null;
      document.getElementById('btnRun').textContent = '▶ Run simulation';
    }
  }, delay);
});

// initial preset
document.getElementById('btnPresetHospital').click();
