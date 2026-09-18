(function () {
  const amq = newEngine(cloneTasks(HOSPITAL_DEMO_WORKLOAD));
  runToCompletion(amq);
  const { rows, util } = report(amq);

  const emgRows = rows.filter(r => r.queue === 'Emergency');
  const emgAvg = emgRows.reduce((s, r) => s + r.response, 0) / emgRows.length;
  const avgWait = rows.reduce((s, r) => s + r.waiting, 0) / rows.length;
  const bgRows = rows.filter(r => r.queue === 'Background');
  const promotions = bgRows.reduce((s, r) => s + r.promotions, 0);
  const bgStarved = bgRows.some(r => r.starved);

  const fcfs = runFcfsBaseline(HOSPITAL_DEMO_WORKLOAD);
  const fcfsEmg = fcfs.rows.filter(r => r.queue === 'Emergency');
  const fcfsEmgAvg = fcfsEmg.reduce((s, r) => s + r.response, 0) / fcfsEmg.length;
  const reduction = fcfsEmgAvg > 0 ? 100 * (fcfsEmgAvg - emgAvg) / fcfsEmgAvg : 0;

  document.getElementById('snapEmerg').textContent = emgAvg.toFixed(1);
  document.getElementById('snapWait').textContent = avgWait.toFixed(1);
  document.getElementById('snapUtil').textContent = util.toFixed(0) + '%';
  document.getElementById('snapBg').textContent = bgStarved ? 'STARVED' : (promotions > 0 ? 'AGED ×' + promotions : 'OK');
  document.getElementById('snapReduction').textContent = reduction.toFixed(0) + '%';
})();
