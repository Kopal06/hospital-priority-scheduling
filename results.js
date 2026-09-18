(function renderHospitalDemoComparison() {
  const amq = newEngine(cloneTasks(HOSPITAL_DEMO_WORKLOAD));
  runToCompletion(amq);
  const { rows } = report(amq);
  const fcfs = runFcfsBaseline(HOSPITAL_DEMO_WORKLOAD);

  const amqEmg = rows.filter(r => r.queue === 'Emergency' && r.response !== null);
  const fcfsEmg = fcfs.rows.filter(r => r.queue === 'Emergency');
  const amqEmgAvg = amqEmg.reduce((s, r) => s + r.response, 0) / amqEmg.length;
  const fcfsEmgAvg = fcfsEmg.reduce((s, r) => s + r.response, 0) / fcfsEmg.length;
  const amqWaitAvg = rows.reduce((s, r) => s + r.waiting, 0) / rows.length;
  const fcfsWaitAvg = fcfs.rows.reduce((s, r) => s + r.waiting, 0) / fcfs.rows.length;
  const amqTat = rows.filter(r => r.turnaround !== null);
  const amqTatAvg = amqTat.reduce((s, r) => s + r.turnaround, 0) / amqTat.length;
  const fcfsTatAvg = fcfs.rows.reduce((s, r) => s + r.turnaround, 0) / fcfs.rows.length;

  const metrics = [
    { label: 'Emergency response time (ticks)', fcfs: fcfsEmgAvg, amq: amqEmgAvg },
    { label: 'Average waiting time (ticks)', fcfs: fcfsWaitAvg, amq: amqWaitAvg },
    { label: 'Average turnaround time (ticks)', fcfs: fcfsTatAvg, amq: amqTatAvg },
  ];
  const maxVal = Math.max(...metrics.map(m => Math.max(m.fcfs, m.amq)), 1);
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

  const tbl = document.getElementById('demoTable');
  tbl.innerHTML = `<tr><th>PID</th><th>Name</th><th>Queue</th><th>Wait (AMQ)</th><th>Resp. (AMQ)</th><th>Promotions</th></tr>` +
    rows.map(r => `<tr><td>${r.pid}</td><td>${r.name}</td><td><span class="queue-tag ${{Emergency:'q0',Interactive:'q1',Background:'q2'}[r.queue]}">${r.queue}</span></td>
      <td>${r.waiting}</td><td>${r.response !== null ? r.response : '—'}</td><td>${r.promotions}</td></tr>`).join('');
})();

document.getElementById('btnRunSweep').addEventListener('click', function () {
  this.disabled = true;
  this.textContent = 'Running…';
  setTimeout(() => {
    const results = runAgingSweep(20, 150);
    const tbl = document.getElementById('sweepTable');
    tbl.style.display = 'table';
    tbl.innerHTML = `<tr><th>Configuration</th><th>Seeds</th><th>Background starved</th><th>Avg wait (finished)</th><th>Avg max background wait</th></tr>` +
      results.map(r => `<tr>
        <td>${r.label}</td>
        <td>${r.seeds}</td>
        <td>${r.starvedCount} / ${r.seeds} (${r.starvedPct.toFixed(0)}%)</td>
        <td>${r.avgWait.toFixed(1)}</td>
        <td>${r.avgMaxBackgroundWait.toFixed(1)}</td>
      </tr>`).join('');
    const note = document.getElementById('sweepNote');
    note.style.display = 'block';
    const noAging = results[0], proposed = results[1];
    note.textContent = `With no aging, ${noAging.starvedCount}/${noAging.seeds} seeds left a Background job ` +
      `unfinished within the horizon. With the proposed aging setting, that drops to ${proposed.starvedCount}/${proposed.seeds}.`;
    this.disabled = false;
    this.textContent = '▶ Run sweep (20 seeds × 3 configs)';
  }, 30);
});
