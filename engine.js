/* ==========================================================================
   AMQ Scheduler Engine — shared by every page.
   Ported from backend/amq_scheduler.py and backend/workload_generator.py.
   Pure logic, no DOM access, so it can be reused on the dashboard,
   simulator, and results pages without duplication.
   ========================================================================== */

const EMERGENCY = 0, INTERACTIVE = 1, BACKGROUND = 2;
const QUEUE_NAME = { 0: 'Emergency', 1: 'Interactive', 2: 'Background' };

const RR_QUANTUM = 4;
const AGING_PROMOTION_BASE = 8; // threshold(ticks) = AGING_PROMOTION_BASE / agingSlopeBackground

let _nextPid = 1;
function makeProcess(name, queue, arrival, burst, basePriority) {
  return {
    pid: 'P' + (_nextPid++), name, queue, arrival, burst,
    basePriority, remaining: burst, waitingSince: arrival,
    firstRun: null, completion: null, quantumLeft: RR_QUANTUM, promotions: 0,
  };
}
function cloneTasks(tasks) {
  _nextPid = 1;
  return tasks.map(t => makeProcess(t.name, t.queue, t.arrival, t.burst, t.basePriority));
}

/* ---------------- core engine ---------------- */
function newEngine(tasks, agingSlopeBackground = 0.2) {
  return {
    all: [...tasks].sort((a, b) => a.arrival - b.arrival),
    queues: { 0: [], 1: [], 2: [] },
    time: 0, gantt: [], idle: 0, done: false,
    agingSlopeBackground,
    current: null, currentQ: null, runningRef: null,
  };
}
function flat(e) { return [...e.queues[0], ...e.queues[1], ...e.queues[2]]; }
function admitArrivals(e) {
  for (const p of e.all) {
    if (p.arrival === e.time && p.completion === null && !flat(e).includes(p) && e.runningRef !== p) {
      e.queues[p.queue].push(p);
    }
  }
}
function applyAging(e) {
  if (e.agingSlopeBackground <= 0) return;
  const threshold = AGING_PROMOTION_BASE / e.agingSlopeBackground;
  for (const p of [...e.queues[BACKGROUND]]) {
    if ((e.time - p.waitingSince) >= threshold) {
      e.queues[BACKGROUND] = e.queues[BACKGROUND].filter(x => x !== p);
      p.waitingSince = e.time; p.quantumLeft = RR_QUANTUM; p.promotions++;
      e.queues[INTERACTIVE].push(p);
    }
  }
}
function pickEmergency(e) {
  if (e.queues[0].length === 0) return null;
  e.queues[0].sort((a, b) => a.basePriority - b.basePriority || a.arrival - b.arrival);
  return e.queues[0][0];
}

function tickOnce(e) {
  if (e.done) return null;
  admitArrivals(e);
  applyAging(e);

  const emg = pickEmergency(e);
  let chosen = null, chosenQ = null;
  if (emg) {
    chosen = emg; chosenQ = EMERGENCY;
    if (e.current && e.current !== chosen && !e.queues[e.currentQ].includes(e.current)) {
      e.queues[e.currentQ].unshift(e.current);
    }
  } else if (e.queues[INTERACTIVE].length > 0) {
    chosen = e.queues[INTERACTIVE][0]; chosenQ = INTERACTIVE;
  } else if (e.queues[BACKGROUND].length > 0) {
    chosen = e.queues[BACKGROUND][0]; chosenQ = BACKGROUND;
  }

  if (!chosen) {
    e.idle++; e.time++;
    if (e.all.every(p => p.completion !== null)) e.done = true;
    return { idle: true, time: e.time };
  }

  e.queues[chosenQ] = e.queues[chosenQ].filter(x => x !== chosen);
  e.runningRef = chosen;
  if (chosen.firstRun === null) chosen.firstRun = e.time;

  const startT = e.time;
  e.gantt.push([startT, startT + 1, chosen.pid, chosenQ, chosen.name]);
  chosen.remaining--;
  e.time++;
  admitArrivals(e);

  if (chosen.remaining <= 0) {
    chosen.completion = e.time;
    e.current = null; e.currentQ = null; e.runningRef = null;
  } else if (chosenQ === EMERGENCY) {
    chosen.waitingSince = e.time;
    e.queues[EMERGENCY].push(chosen);
    e.current = chosen; e.currentQ = EMERGENCY; e.runningRef = chosen;
  } else if (chosenQ === INTERACTIVE) {
    chosen.quantumLeft--;
    if (chosen.quantumLeft <= 0 || pickEmergency(e)) {
      chosen.quantumLeft = RR_QUANTUM; chosen.waitingSince = e.time;
      e.queues[INTERACTIVE].push(chosen);
      e.current = null; e.currentQ = null; e.runningRef = null;
    } else {
      e.queues[INTERACTIVE].unshift(chosen);
      e.current = chosen; e.currentQ = INTERACTIVE; e.runningRef = chosen;
    }
  } else {
    e.queues[BACKGROUND].unshift(chosen);
    e.current = chosen; e.currentQ = BACKGROUND; e.runningRef = chosen;
  }

  if (e.all.every(p => p.completion !== null)) e.done = true;
  return { idle: false, time: e.time, pid: chosen.pid, name: chosen.name, queue: chosenQ };
}

function runToCompletion(e, maxTicks = 500) {
  let guard = 0;
  while (!e.done && guard < maxTicks) { tickOnce(e); guard++; }
  return e;
}

function report(e) {
  const rows = [];
  for (const p of [...e.all].sort((a, b) => a.pid.localeCompare(b.pid, undefined, { numeric: true }))) {
    const executed = p.burst - p.remaining;
    let turnaround = null, waiting, response, starved;
    if (p.completion !== null) {
      turnaround = p.completion - p.arrival;
      waiting = turnaround - p.burst;
      response = p.firstRun !== null ? p.firstRun - p.arrival : null;
      starved = false;
    } else {
      waiting = (e.time - p.arrival) - executed;
      response = p.firstRun !== null ? p.firstRun - p.arrival : null;
      starved = true;
    }
    rows.push({
      pid: p.pid, name: p.name, queue: QUEUE_NAME[p.queue], arrival: p.arrival, burst: p.burst,
      completion: p.completion, turnaround, waiting, response, promotions: p.promotions, starved,
    });
  }
  const util = e.time > 0 ? 100 * (e.time - e.idle) / e.time : 0;
  return { rows, util };
}

/* ---------------- FCFS baseline (instant, no ticking needed) ---------------- */
function runFcfsBaseline(tasks) {
  const procs = cloneTasks(tasks).sort((a, b) => a.arrival - b.arrival);
  let t = 0;
  const rows = [];
  for (const p of procs) {
    const start = Math.max(t, p.arrival);
    const end = start + p.burst;
    t = end;
    rows.push({
      pid: p.pid, name: p.name, queue: QUEUE_NAME[p.queue], arrival: p.arrival, burst: p.burst,
      completion: end, turnaround: end - p.arrival, waiting: (end - p.arrival) - p.burst,
      response: start - p.arrival,
    });
  }
  return { rows, totalTime: t };
}

/* ---------------- preset workloads ---------------- */
const HOSPITAL_DEMO_WORKLOAD = [
  { name: 'ECG Alert - Bed 12', queue: 0, arrival: 0, burst: 3, basePriority: 1 },
  { name: 'ICU Monitor - Bed 04', queue: 0, arrival: 6, burst: 2, basePriority: 1 },
  { name: 'Code Blue Alert - ER', queue: 0, arrival: 10, burst: 2, basePriority: 0 },
  { name: 'Doctor Dashboard', queue: 1, arrival: 0, burst: 10, basePriority: 5 },
  { name: 'EMR Lookup', queue: 1, arrival: 1, burst: 8, basePriority: 5 },
  { name: 'Nurse Chart Update', queue: 1, arrival: 3, burst: 6, basePriority: 5 },
  { name: 'Billing Batch Job', queue: 2, arrival: 0, burst: 14, basePriority: 9 },
  { name: 'Nightly DB Backup', queue: 2, arrival: 2, burst: 12, basePriority: 9 },
];

/* Seeded PRNG (mulberry32) so "random" workloads are reproducible, matching
   the seeded Python generator used in backend/workload_generator.py. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randInt(rng, min, max) { return Math.floor(rng() * (max - min + 1)) + min; }

/* Adversarial workload used to test starvation, mirrors
   generate_starvation_stress_workload() in backend/workload_generator.py. */
function generateStarvationStressWorkload(seed, horizon = 150) {
  const rng = mulberry32(seed);
  const tasks = [];
  for (let i = 0; i < 2; i++) {
    tasks.push({ name: `Background Job #${i + 1}`, queue: BACKGROUND, arrival: 0, burst: randInt(rng, 14, 20), basePriority: 9 });
  }
  let t = randInt(rng, 5, 15);
  while (t < horizon) {
    tasks.push({ name: 'Emergency Alert', queue: EMERGENCY, arrival: t, burst: randInt(rng, 1, 3), basePriority: randInt(rng, 0, 2) });
    t += randInt(rng, 25, 40);
  }
  t = 0;
  while (t < horizon) {
    tasks.push({ name: 'Interactive Task', queue: INTERACTIVE, arrival: t, burst: randInt(rng, 2, 4), basePriority: 5 });
    t += randInt(rng, 3, 6);
  }
  return tasks;
}

/* ---------------- aging-slope sweep (mirrors backend/experiments.py) ---------------- */
function runAgingSweep(seeds = 20, horizon = 150) {
  const configs = [
    { label: 'No aging', slope: 0.0 },
    { label: 'Proposed (0.2)', slope: 0.2 },
    { label: 'Aggressive (1.0)', slope: 1.0 },
  ];
  const results = [];
  for (const cfg of configs) {
    let starvedCount = 0;
    let waitSum = 0, waitN = 0, maxBgWaitSum = 0;
    for (let seed = 1; seed <= seeds; seed++) {
      const tasks = generateStarvationStressWorkload(seed, horizon);
      const e = newEngine(cloneTasks(tasks), cfg.slope);
      runToCompletion(e, horizon);
      const { rows } = report(e);
      const bgRows = rows.filter(r => r.queue === 'Background');
      if (bgRows.some(r => r.starved)) starvedCount++;
      const maxBgWait = Math.max(...bgRows.map(r => r.waiting), 0);
      maxBgWaitSum += maxBgWait;
      for (const r of rows.filter(r => !r.starved)) { waitSum += r.waiting; waitN++; }
    }
    results.push({
      label: cfg.label, slope: cfg.slope, seeds,
      starvedCount, starvedPct: 100 * starvedCount / seeds,
      avgWait: waitN ? waitSum / waitN : 0,
      avgMaxBackgroundWait: maxBgWaitSum / seeds,
    });
  }
  return results;
}
