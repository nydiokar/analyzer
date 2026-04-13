const $ = (selector) => document.querySelector(selector);

const state = {
  data: null,
  selectedMint: null,
};

const walletsFromQuery = new URL(window.location.href).searchParams.get('wallet') ?? '';
$('#wallet-input').value = walletsFromQuery;

function shortMint(mint) {
  return `${mint.slice(0, 6)}...${mint.slice(-4)}`;
}

function formatSignedSol(value) {
  if (value == null || Number.isNaN(value)) return 'n/a';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)} SOL`;
}

function formatPct(value) {
  if (value == null || Number.isNaN(value)) return 'n/a';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function formatMoney(value) {
  if (value == null || Number.isNaN(value)) return 'n/a';
  return `$${Math.abs(value).toFixed(0)}`;
}

function formatWholeNumber(value) {
  if (value == null || Number.isNaN(value)) return 'n/a';
  return Math.trunc(value).toLocaleString();
}

function formatTime(value) {
  if (value == null) return 'n/a';
  return new Date(value * 1000).toLocaleString();
}

function formatYesNo(value) {
  return value ? 'Yes' : 'No';
}

function setStatus(message, kind = 'info') {
  const el = $('#status-line');
  el.textContent = message;
  el.dataset.kind = kind;
}

function outcomeClass(outcome) {
  if (outcome === 'WIN') return 'win';
  if (outcome === 'LOSS') return 'loss';
  return 'flat';
}

function updateUrl(wallet) {
  const next = new URL(window.location.href);
  next.searchParams.set('wallet', wallet);
  window.history.replaceState({}, '', next);
}

async function loadStrategy(wallet) {
  const normalized = wallet.trim();
  if (!normalized) {
    setStatus('Paste a wallet address first.', 'warn');
    return;
  }

  setStatus(`Loading ${shortMint(normalized)}...`, 'loading');
  const response = await fetch(`/api/strategy?wallet=${encodeURIComponent(normalized)}`);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.message ?? 'Failed to load wallet strategy.');
  }

  state.data = payload;
  state.selectedMint = payload.tokens?.[0]?.mint ?? null;
  render();
  updateUrl(normalized);
  setStatus(`Loaded ${payload.summary.totalTokens} tokens for ${shortMint(normalized)}.`, 'ok');
}

function renderMetrics(data) {
  const grid = $('#summary-grid');
  const totalNet = (data.summary.totalWinSol ?? 0) + (data.summary.totalLossSol ?? 0);
  const metrics = [
    ['Win rate', `${data.summary.winRatePct.toFixed(1)}%`, `${data.summary.winCount} wins / ${data.summary.lossCount} losses`],
    ['Net realized', formatSignedSol(totalNet), `Wins ${formatSignedSol(data.summary.totalWinSol)} · Losses ${formatSignedSol(data.summary.totalLossSol)}`],
    ['Longest win streak', `${data.summary.longestWinStreak}`, `Longest loss streak ${data.summary.longestLossStreak}`],
    ['Tokens', `${data.summary.totalTokens}`, `Flat ${data.summary.flatCount} · gap buckets ${Object.keys(data.summary.gapBetweenWins ?? {}).length}`],
  ];

  grid.innerHTML = metrics.map(([label, value, sub]) => `
    <article class="metric">
      <div class="label">${label}</div>
      <div class="value">${value}</div>
      <div class="sub">${sub}</div>
    </article>
  `).join('');
  grid.classList.remove('hidden');
}

function renderSequence(data) {
  const strip = $('#sequence-strip');
  strip.innerHTML = data.orderedOutcomes.map((item) => `
    <button class="seq-chip ${outcomeClass(item.outcome)} ${item.mint === state.selectedMint ? 'active' : ''}" data-mint="${item.mint}">
      <div class="topline">
        <span>#${item.sequenceIndex}</span>
        <span>${item.outcome}</span>
      </div>
      <div class="mint">${shortMint(item.mint)}</div>
      <div class="pnl">${formatSignedSol(item.realizedPnlSol)}</div>
    </button>
  `).join('');

  strip.querySelectorAll('[data-mint]').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedMint = button.dataset.mint;
      render();
    });
  });
}

function renderGapBars(data) {
  const gapEntries = Object.entries(data.summary.gapBetweenWins ?? {})
    .map(([gap, count]) => ({ gap: Number(gap), count }))
    .sort((a, b) => a.gap - b.gap);

  const gapBars = $('#gap-bars');
  const max = Math.max(...gapEntries.map((entry) => entry.count), 1);
  gapBars.innerHTML = gapEntries.length === 0
    ? '<div class="inline-note">Not enough wins to compute gaps.</div>'
    : gapEntries.map((entry) => `
      <div class="bar-row">
        <div class="meta"><span>Gap ${entry.gap}</span><span>${entry.count}</span></div>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.max((entry.count / max) * 100, 6)}%"></div></div>
      </div>
    `).join('');

  const gapSummary = $('#gap-summary');
  gapSummary.textContent = gapEntries.length === 0
    ? 'No gap distribution yet'
    : `0-gap wins: ${gapEntries.find((entry) => entry.gap === 0)?.count ?? 0}`;
}

function renderTokenList(data) {
  const list = $('#token-list');
  const tokens = [...data.tokens].sort((a, b) => Math.abs(b.realizedPnlSol ?? 0) - Math.abs(a.realizedPnlSol ?? 0));

  list.innerHTML = tokens.map((token) => `
    <div class="token-row ${token.mint === state.selectedMint ? 'active' : ''}" data-mint="${token.mint}">
      <div class="row-top">
        <div class="left">
          <div class="mint">${shortMint(token.mint)}</div>
          <div class="meta">#${token.sequenceIndex} · ${token.sellCount} sells · first sell ${formatPct(token.firstSellPctInitial)}</div>
        </div>
        <div class="right right-align">
          <div class="${(token.realizedPnlSol ?? 0) >= 0 ? 'good' : 'bad'}">${formatSignedSol(token.realizedPnlSol)}</div>
          <div class="meta">max pump ${formatPct(token.maxSellPumpPct)}</div>
        </div>
      </div>
      <div class="pill-row">
        <span class="pill ${outcomeClass(token.outcome)}">${token.outcome}</span>
        <span class="pill">second sell ${formatPct(token.secondSellPctInitial)}</span>
        <span class="pill">sold ${formatPct(token.totalSoldPctOfTotalBought)}</span>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('[data-mint]').forEach((row) => {
    row.addEventListener('click', () => {
      state.selectedMint = row.dataset.mint;
      render();
    });
  });
}

function renderTokenDetail(data) {
  const token = data.tokens.find((entry) => entry.mint === state.selectedMint) ?? data.tokens[0];
  const detail = $('#token-detail');
  if (!token) {
    detail.className = 'token-detail empty';
    detail.textContent = 'Select a token to inspect its sells.';
    return;
  }

  state.selectedMint = token.mint;
  detail.className = 'token-detail';
  detail.innerHTML = `
    <div class="detail-grid">
      <div class="detail-card"><div class="label">Mint</div><div class="value">${token.mint}</div></div>
      <div class="detail-card"><div class="label">Outcome</div><div class="value">${token.outcome}</div></div>
      <div class="detail-card"><div class="label">First buy mcap</div><div class="value">${formatMoney(token.firstBuyMarketCapUsd)}</div></div>
      <div class="detail-card"><div class="label">Second buy mcap</div><div class="value">${formatMoney(token.secondBuyMarketCapUsd)}</div></div>
      <div class="detail-card"><div class="label">First sell mcap</div><div class="value">${formatMoney(token.firstSellMarketCapUsd)}</div></div>
      <div class="detail-card"><div class="label">Re-entry</div><div class="value">${formatYesNo(token.hasReentry)}</div></div>
      <div class="detail-card"><div class="label">Max pump</div><div class="value">${formatPct(token.maxSellPumpPct)}</div></div>
      <div class="detail-card"><div class="label">Initial inventory</div><div class="value">${token.totalBoughtBeforeFirstSell?.toLocaleString() ?? 'n/a'}</div></div>
      <div class="detail-card"><div class="label">Total sold</div><div class="value">${formatPct(token.totalSoldPctOfTotalBought)}</div></div>
    </div>
    <div class="sell-table">
      <div class="head">
        <span>Type</span><span>#</span><span>Time</span><span>Amount</span><span>Sold %</span><span>Pump</span><span>Mcap</span>
      </div>
      <div class="rows">
        ${token.activityEvents.map((event) => `
          <div class="row ${event.eventType === 'BUY' ? 'buy-row' : 'sell-row'}">
            <span class="pill ${event.eventType === 'BUY' ? 'buy' : 'sell'}">${event.eventType}</span>
            <span class="mono">#${event.activityIndex}</span>
            <span>${formatTime(event.timestamp)}</span>
            <span class="mono">${formatWholeNumber(event.amount)}</span>
            <span class="mono">${formatPct(event.sellPctOfInitialInventory)}</span>
            <span class="mono ${(event.pumpVsFirstBuyPct ?? 0) >= 0 ? 'good' : 'bad'}">${formatPct(event.pumpVsFirstBuyPct)}</span>
            <span class="mono">${formatMoney(event.marketCapUsd)}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function render(data = state.data) {
  if (!data) return;
  renderMetrics(data);
  renderSequence(data);
  renderGapBars(data);
  renderTokenList(data);
  renderTokenDetail(data);
}

$('#wallet-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await loadStrategy($('#wallet-input').value);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Failed to load strategy.', 'error');
  }
});

document.querySelectorAll('[data-wallet]').forEach((button) => {
  button.addEventListener('click', async () => {
    const wallet = button.getAttribute('data-wallet');
    if (!wallet) return;
    $('#wallet-input').value = wallet;
    try {
      await loadStrategy(wallet);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to load strategy.', 'error');
    }
  });
});

(async () => {
  const initial = $('#wallet-input').value.trim();
  if (!initial) {
    setStatus('Ready. Paste a wallet or pick the sample target.');
    return;
  }

  try {
    await loadStrategy(initial);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Failed to load strategy.', 'error');
  }
})();
