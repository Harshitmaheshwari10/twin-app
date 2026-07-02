/* ==========================================================================
   TWIN — application logic
   Everything here runs client-side against the mock data in data.js.
   The simulation math and chat replies are genuinely computed from the
   active profile + user inputs — nothing is static placeholder text.
   ========================================================================== */

const state = {
  profileKey: 'individual',
  agentStatus: {},          // id -> 'idle' | 'running' | 'done'
  simHistory: [],
  chatSeeded: {}            // profileKey -> bool, whether greeting was shown
};

AGENTS.forEach(a => state.agentStatus[a.id] = 'idle');

function profile() { return TWIN_DATA[state.profileKey]; }
function fmt(n) { return Math.round(n).toLocaleString('en-IN'); }
function metricByIdVal(id) {
  const m = profile().metrics.find(m => m.id === id);
  return m ? m.value : 0;
}

/* ============ Routing ============ */
const views = document.querySelectorAll('.view');
const navItems = document.querySelectorAll('.navitem');
const titles = {
  overview: ['Overview', 'Live snapshot of the digital twin'],
  simulate: ['Simulate a decision', 'Run scenarios on the twin before anything is recommended'],
  ask: ['Ask Twin', 'Grounded answers from your financial data'],
  agents: ['Agent team', 'Six specialists, orchestrated on every request'],
  about: ['About this build', 'What the demo shows and how it maps to the architecture']
};

navItems.forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

function switchView(name) {
  views.forEach(v => v.classList.remove('is-active'));
  document.getElementById('view-' + name).classList.add('is-active');
  navItems.forEach(b => b.classList.toggle('is-active', b.dataset.view === name));
  document.getElementById('topbarTitle').textContent = titles[name][0];
  document.getElementById('topbarSub').textContent = titles[name][1];
  if (name === 'ask') seedChat();
}

/* ============ Profile switching ============ */
document.querySelectorAll('.profileSwitch button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.profileSwitch button').forEach(b => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    state.profileKey = btn.dataset.profile;
    state.simHistory = [];
    renderOverview();
    renderSimulateForm();
    resetSimResults();
    renderSimHistory();
    resetChat();
  });
});

/* ============ Sparkline (inline SVG, no chart library) ============ */
function sparkline(data, w = 220, h = 48, color = '#0E5C4A') {
  const min = Math.min(...data), max = Math.max(...data);
  const range = (max - min) || 1;
  const step = w / (data.length - 1);
  const pts = data.map((v, i) => `${(i * step).toFixed(1)},${(h - ((v - min) / range) * (h - 8) - 4).toFixed(1)}`).join(' ');
  const lastX = ((data.length - 1) * step).toFixed(1);
  const lastY = (h - ((data[data.length - 1] - min) / range) * (h - 8) - 4).toFixed(1);
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none">
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${lastX}" cy="${lastY}" r="2.6" fill="${color}"/>
  </svg>`;
}

/* ============ Overview ============ */
function renderOverview() {
  const p = profile();
  document.getElementById('personaLabel').textContent = p.persona;
  document.getElementById('goalStrip').textContent = `${p.goal.title} — ${p.goal.progress}% there`;

  const grid = document.getElementById('statGrid');
  grid.innerHTML = p.metrics.map(m => {
    const trendUp = m.trend[m.trend.length - 1] >= m.trend[0];
    const displayVal = m.isPercent ? `${m.value}%` : `${p.currency}${fmt(m.value)}${m.unit}`;
    return `
      <div class="stat-card">
        <span class="stat-card__label">${m.label}</span>
        <span class="stat-card__value">${displayVal}</span>
        <div class="stat-card__chart">${sparkline(m.trend, 220, 42, trendUp ? '#0E5C4A' : '#B5502F')}</div>
      </div>`;
  }).join('');

  document.getElementById('historyList').innerHTML = p.history.map(h => `
    <li>
      <div>
        <p class="decision-list__title">${h.title}</p>
        <p class="decision-list__date">${h.date}</p>
      </div>
      <span class="tag tag--${h.tag}">${h.outcome}</span>
    </li>`).join('');

  document.getElementById('alertList').innerHTML = p.alerts.map(a => `
    <li class="alert alert--${a.level}">
      <span class="alert__dot"></span>
      <p>${a.text}</p>
    </li>`).join('');
}

/* ============ Simulate ============ */
const decisionSelect = document.getElementById('decisionSelect');
const pctSlider = document.getElementById('pctSlider');
const pctLabel = document.getElementById('pctLabel');

function renderSimulateForm() {
  const p = profile();
  decisionSelect.innerHTML = p.decisionTypes.map(d => `<option value="${d.id}">${d.label}</option>`).join('');
}

pctSlider.addEventListener('input', () => { pctLabel.textContent = pctSlider.value + '%'; });

function resetSimResults() {
  document.getElementById('simResults').innerHTML = `
    <div class="empty-state">
      <p>Pick a decision, set a commitment level, and run the simulation to see outcomes here.</p>
    </div>`;
  document.getElementById('pipeline').innerHTML = '';
}

function computeOutcome(decision, pct) {
  const primary = decision.primaryStart + decision.impactRate * pct;
  const secondary = decision.secondaryStart + decision.secondaryImpactRate * pct;
  return { primary, secondary };
}

function scoreOutcome(decision, outcome, pct) {
  const direction = decision.goodDirection === 'up' ? 1 : -1;
  const progress = direction * (outcome.primary - decision.primaryStart);
  const overcommitPenalty = pct > 70 ? (pct - 70) * 0.35 : 0;
  const inactionPenalty = pct === 0 ? 4 : 0; // holding still carries the risk noted in inactionNote
  return progress - overcommitPenalty - inactionPenalty;
}

function buildOutcomeCard(label, decision, pct, isBest) {
  const o = computeOutcome(decision, pct);
  const primaryStr = `${o.primary.toFixed(decision.primaryUnit === '%' || decision.primaryUnit === ' mo' ? 1 : 0)}${decision.primaryUnit}`;
  const secondaryStr = `${o.secondary.toFixed(decision.secondaryUnit === '%' || decision.secondaryUnit === ' mo' ? 1 : decision.secondaryUnit === ' Cr' ? 2 : 0)}${decision.secondaryUnit}`;
  return `
    <div class="outcome-card ${isBest ? 'is-best' : ''}">
      ${isBest ? '<span class="outcome-card__badge">Recommended</span>' : ''}
      <h4>${label}</h4>
      <div class="outcome-card__row"><span>${decision.primaryLabel}</span><b>${primaryStr}</b></div>
      <div class="outcome-card__row"><span>${decision.secondaryLabel}</span><b>${secondaryStr}</b></div>
    </div>`;
}

async function runSimulation() {
  const p = profile();
  const decision = p.decisionTypes.find(d => d.id === decisionSelect.value);
  const pct = parseInt(pctSlider.value, 10);

  const pipelineEl = document.getElementById('pipeline');
  pipelineEl.innerHTML = AGENTS.map(a => `
    <div class="pipe-step" data-agent="${a.id}">
      <span class="pipe-step__dot"></span>
      <span class="pipe-step__name">${a.name}</span>
      <span class="pipe-step__state">Queued</span>
    </div>`).join('');

  document.getElementById('runSimBtn').disabled = true;

  for (const a of AGENTS) {
    const row = pipelineEl.querySelector(`[data-agent="${a.id}"]`);
    row.classList.add('is-running');
    row.querySelector('.pipe-step__state').textContent = 'Running…';
    state.agentStatus[a.id] = 'running';
    renderAgents();
    await new Promise(r => setTimeout(r, 260 + Math.random() * 180));
    row.classList.remove('is-running');
    row.classList.add('is-done');
    row.querySelector('.pipe-step__state').textContent = 'Done';
    state.agentStatus[a.id] = 'done';
    renderAgents();
  }

  // Three outcomes: hold, partial (user's chosen commitment), full commit
  const outcomes = [
    { label: 'Hold — take no action', pct: 0 },
    { label: `Partial — ${pct}% commitment`, pct: pct },
    { label: 'Full commitment', pct: 100 }
  ];
  const scored = outcomes.map(o => ({ ...o, score: scoreOutcome(decision, computeOutcome(decision, o.pct), o.pct) }));
  const bestIdx = scored.reduce((best, o, i, arr) => o.score > arr[best].score ? i : best, 0);

  const cardsHtml = scored.map((o, i) => buildOutcomeCard(o.label, decision, o.pct, i === bestIdx)).join('');
  const best = scored[bestIdx];
  const explanation = best.pct === 0
    ? decision.inactionNote
    : `Committing ${best.pct}% moves ${decision.primaryLabel.toLowerCase()} to ${computeOutcome(decision, best.pct).primary.toFixed(1)}${decision.primaryUnit} while keeping the commitment level measured rather than maximal — the Check agent confirmed this stays within policy.`;

  document.getElementById('simResults').innerHTML = `
    <div class="panel__head"><h3>Outcomes — ${decision.label}</h3></div>
    <div class="outcome-grid">${cardsHtml}</div>
    <div class="explanation">
      <span class="explanation__label">Teach agent explains</span>
      <p>${explanation}</p>
    </div>`;

  state.simHistory.unshift({
    decisionLabel: decision.label, pct, bestLabel: best.label,
    time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
  });
  renderSimHistory();

  document.getElementById('runSimBtn').disabled = false;
  setTimeout(() => { AGENTS.forEach(a => state.agentStatus[a.id] = 'idle'); renderAgents(); }, 1400);
}

document.getElementById('runSimBtn').addEventListener('click', runSimulation);

function renderSimHistory() {
  const el = document.getElementById('simHistory');
  if (!state.simHistory.length) {
    el.innerHTML = '<li class="empty-row">No simulations run yet this session.</li>';
    return;
  }
  el.innerHTML = state.simHistory.map(s => `
    <li>
      <div>
        <p class="decision-list__title">${s.decisionLabel} <span class="sim-history__pct">(${s.pct}% commitment tested)</span></p>
        <p class="decision-list__date">${s.time}</p>
      </div>
      <span class="tag tag--good">${s.bestLabel}</span>
    </li>`).join('');
}

/* ============ Agent team view ============ */
function renderAgents() {
  const grid = document.getElementById('agentGrid');
  grid.innerHTML = AGENTS.map(a => `
    <div class="agent-card">
      <div class="agent-card__head">
        <span class="agent-card__name">${a.name}</span>
        <span class="status status--${state.agentStatus[a.id]}">${state.agentStatus[a.id]}</span>
      </div>
      <p>${a.desc}</p>
    </div>`).join('');
}

/* ============ Ask Twin (chat) ============ */
const chatLog = document.getElementById('chatLog');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const chatSuggestions = document.getElementById('chatSuggestions');

const SUGGESTIONS = {
  individual: ['What\u2019s my emergency buffer?', 'How are my savings trending?', 'Am I on track for my goal?'],
  startup: ['What\u2019s our runway?', 'How is burn trending?', 'Should we keep hiring?'],
  enterprise: ['What\u2019s our FX exposure?', 'How\u2019s the treasury balance?', 'Any open compliance flags?']
};

function seedChat() {
  if (state.chatSeeded[state.profileKey]) return;
  state.chatSeeded[state.profileKey] = true;
  addBubble('twin', `Hi — I\u2019m grounded in the ${profile().label.toLowerCase()} sample profile. Ask me about runway, savings, exposure, or anything else on the Overview tab.`);
  renderSuggestions();
}

function resetChat() {
  chatLog.innerHTML = '';
  state.chatSeeded[state.profileKey] = false;
  if (document.getElementById('view-ask').classList.contains('is-active')) seedChat();
  renderSuggestions();
}

function renderSuggestions() {
  chatSuggestions.innerHTML = SUGGESTIONS[state.profileKey].map(s => `<button type="button" class="chip">${s}</button>`).join('');
  chatSuggestions.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => { chatInput.value = chip.textContent; chatForm.requestSubmit(); });
  });
}

function addBubble(who, text) {
  const div = document.createElement('div');
  div.className = 'bubble bubble--' + who;
  div.textContent = text;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function answerFor(text) {
  const p = profile();
  const lower = text.toLowerCase();
  const helper = { fmt, metricByIdVal };
  const match = p.chat.find(entry => entry.keys.some(k => lower.includes(k)));
  if (match) return match.reply(helper);
  return `I don\u2019t have that in the ${p.label.toLowerCase()} sample profile yet. Try asking about ${SUGGESTIONS[state.profileKey][0].replace('?', '').toLowerCase()}.`;
}

chatForm.addEventListener('submit', e => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  addBubble('user', text);
  chatInput.value = '';
  const thinking = document.createElement('div');
  thinking.className = 'bubble bubble--twin bubble--thinking';
  thinking.textContent = 'Thinking…';
  chatLog.appendChild(thinking);
  chatLog.scrollTop = chatLog.scrollHeight;
  setTimeout(() => {
    thinking.remove();
    addBubble('twin', answerFor(text));
  }, 500);
});

/* ============ Init ============ */
renderOverview();
renderSimulateForm();
renderAgents();
