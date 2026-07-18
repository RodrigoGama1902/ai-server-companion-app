(function () {
  'use strict';

  const CARD_TAG = 'lovelace-ai-server';

  // ─── Helpers ──────────────────────────────────────────────────────────────

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function formatNum(raw, decimals = 1) {
    const n = parseFloat(raw);
    return isNaN(n) ? '--' : n.toFixed(decimals);
  }

  function fmtTokens(raw) {
    const n = parseFloat(raw);
    if (isNaN(n) || n < 0) return '--';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return String(Math.round(n));
  }

  function usageColor(raw) {
    const v = parseFloat(raw);
    if (isNaN(v)) return '#475569';
    if (v < 50) return '#22c55e';  // green
    if (v < 80) return '#f59e0b';  // amber
    return '#ef4444';              // red
  }

  function ringProgress(pct, color) {
    const r = 25;
    const C = +(2 * Math.PI * r).toFixed(3);
    const p = clamp(parseFloat(pct) || 0, 0, 100);
    const offset = +(C * (1 - p / 100)).toFixed(3);
    return `<svg viewBox="0 0 60 60" style="width:100%;height:100%">
      <circle cx="30" cy="30" r="${r}" fill="none"
        stroke="var(--divider-color, rgba(0,0,0,.1))" stroke-width="5"/>
      <circle cx="30" cy="30" r="${r}" fill="none"
        stroke="${color}" stroke-width="5"
        stroke-dasharray="${C}" stroke-dashoffset="${offset}"
        stroke-linecap="round" transform="rotate(-90 30 30)"
        style="transition:stroke-dashoffset .6s ease"/>
    </svg>`;
  }

  const PWR_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M18.36 6.64a9 9 0 1 1-12.73 0"/>
    <line x1="12" y1="2" x2="12" y2="12"/>
  </svg>`;

  // ─── Styles ───────────────────────────────────────────────────────────────

  const STYLES = `
    :host { display: block; }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    .card {
      background: var(--ha-card-background, var(--card-background-color, #fff));
      border-radius: var(--ha-card-border-radius, 12px);
      padding: 20px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      color: var(--primary-text-color, #f1f5f9);
      transition: filter .4s ease, opacity .4s ease;
      overflow: hidden;
    }

    .card--off {
      filter: grayscale(.45);
      opacity: .65;
    }

    /* ── Header ─────────────────────────────────────────────── */
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 0;
      cursor: pointer;
      user-select: none;
      transition: margin-bottom .35s ease;
    }
    .card--on:not(.card--collapsed) .header { margin-bottom: 20px; }
    .header__left {
      display: flex;
      align-items: center;
      gap: 9px;
    }
    .header__right {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .chevron {
      width: 18px; height: 18px;
      color: var(--secondary-text-color, #64748b);
      transition: transform .35s ease;
      flex-shrink: 0;
      pointer-events: none;
    }
    .card--collapsed .chevron { transform: rotate(-90deg); }
    .body {
      overflow: hidden;
      max-height: 1500px;
      opacity: 1;
      transition: max-height .4s ease, opacity .3s ease;
    }
    .card--collapsed .body {
      max-height: 0;
      opacity: 0;
      pointer-events: none;
    }
    .dot {
      width: 8px; height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
      transition: background .4s, box-shadow .4s;
    }
    .dot--on  { background: #22c55e; box-shadow: 0 0 8px #22c55e99; }
    .dot--off { background: #334155; }
    .dot--processing {
      background: #6366f1;
      box-shadow: 0 0 8px #6366f199;
      animation: dot-proc 1.4s ease-in-out infinite;
    }
    .dot--sleeping {
      background: #3b82f6;
      box-shadow: 0 0 6px #3b82f666;
    }
    @keyframes dot-proc {
      0%, 100% { box-shadow: 0 0 4px #6366f180; }
      50%       { box-shadow: 0 0 14px #6366f1cc, 0 0 22px #6366f140; }
    }

    .title {
      font-size: 12px;
      font-weight: 700;
      color: var(--secondary-text-color, #64748b);
      text-transform: uppercase;
      letter-spacing: .1em;
    }

    /* ── Power button ────────────────────────────────────────── */
    .pwr {
      width: 34px; height: 34px;
      display: flex; align-items: center; justify-content: center;
      border-radius: 50%;
      border: 1.5px solid;
      background: none;
      cursor: pointer;
      flex-shrink: 0;
      transition: background .2s, transform .15s, box-shadow .2s;
    }
    .pwr svg { width: 16px; height: 16px; }
    .pwr:focus-visible { outline: 2px solid #818cf8; outline-offset: 2px; }
    .pwr:hover { transform: scale(1.08); }
    .pwr:active { transform: scale(.96); }

    .pwr--on {
      background: rgba(239, 68, 68, .08);
      border-color: rgba(239, 68, 68, .3);
      color: #f87171;
    }
    .pwr--on:hover {
      background: rgba(239, 68, 68, .2);
      box-shadow: 0 0 16px rgba(239, 68, 68, .25);
    }

    .pwr--off {
      background: rgba(99, 102, 241, .08);
      border-color: rgba(99, 102, 241, .3);
      color: #818cf8;
      animation: pwr-pulse 2.8s ease-in-out infinite;
    }
    .pwr--off:hover {
      background: rgba(99, 102, 241, .2);
      box-shadow: 0 0 16px rgba(99, 102, 241, .3);
      animation: none;
    }

    @keyframes pwr-pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(99, 102, 241, .25); }
      50%       { box-shadow: 0 0 0 6px rgba(99, 102, 241, .0); }
    }

    /* ── Metrics grid ────────────────────────────────────────── */
    .metrics {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
      margin-bottom: 16px;
    }
    .metric {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
    }
    .ring-wrap {
      position: relative;
      width: 64px; height: 64px;
    }
    .ring-val {
      position: absolute;
      top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      font-size: 12px;
      font-weight: 700;
      color: var(--primary-text-color, #e2e8f0);
      pointer-events: none;
      white-space: nowrap;
    }
    .metric-lbl {
      font-size: 10px;
      font-weight: 700;
      color: var(--secondary-text-color, #475569);
      text-transform: uppercase;
      letter-spacing: .08em;
    }
    .metric-sublbl {
      font-size: 10px;
      font-weight: 600;
      color: var(--primary-text-color, #94a3b8);
      margin-top: -2px;
    }

    /* ── State tag ───────────────────────────────────────────── */
    .state-tag {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .07em;
      padding: 2px 7px;
      border-radius: 20px;
    }
    .state-tag--processing {
      background: rgba(99,102,241,.15);
      color: #818cf8;
      border: 1px solid rgba(99,102,241,.25);
      animation: tag-proc 1.4s ease-in-out infinite;
    }
    .state-tag--sleeping {
      background: rgba(59,130,246,.12);
      color: #60a5fa;
      border: 1px solid rgba(59,130,246,.2);
    }
    .state-tag--unknown {
      background: rgba(100,116,139,.12);
      color: #64748b;
      border: 1px solid rgba(100,116,139,.2);
    }
    @keyframes tag-proc {
      0%, 100% { opacity: 1; }
      50%       { opacity: .6; }
    }

    /* ── Context bar ─────────────────────────────────────────── */
    .context-section {
      margin-bottom: 14px;
    }
    .ctx-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 7px;
    }
    .ctx-label {
      font-size: 10px;
      font-weight: 700;
      color: var(--secondary-text-color, #475569);
      text-transform: uppercase;
      letter-spacing: .08em;
    }
    .ctx-pct {
      font-size: 13px;
      font-weight: 700;
      color: var(--primary-text-color, #e2e8f0);
    }
    .ctx-pct--na {
      color: var(--secondary-text-color, #64748b);
      font-style: italic;
    }
    .ctx-bar-track {
      width: 100%;
      height: 6px;
      background: var(--divider-color, rgba(0,0,0,.1));
      border-radius: 3px;
      overflow: hidden;
      margin-bottom: 6px;
    }
    .ctx-bar-fill {
      height: 100%;
      border-radius: 3px;
      transition: width .6s ease;
    }
    .ctx-tokens {
      font-size: 10px;
      color: var(--secondary-text-color, #475569);
      font-variant-numeric: tabular-nums;
    }

    /* ── Speed row ───────────────────────────────────────────── */
    .speed-row {
      display: flex;
      align-items: center;
      padding: 12px 0 14px;
      border-top: 1px solid var(--divider-color, rgba(0,0,0,.08));
      margin-bottom: 0;
    }
    .speed-item {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 3px;
    }
    .speed-item + .speed-item {
      border-left: 1px solid var(--divider-color, rgba(0,0,0,.08));
    }
    .speed-val {
      font-size: 16px;
      font-weight: 700;
      color: var(--primary-text-color, #e2e8f0);
      font-variant-numeric: tabular-nums;
      letter-spacing: -.01em;
    }
    .speed-val--active { color: #818cf8; }
    .speed-val--queue  { color: #f59e0b; }
    .speed-lbl {
      font-size: 10px;
      font-weight: 700;
      color: var(--secondary-text-color, #475569);
      text-transform: uppercase;
      letter-spacing: .08em;
    }

    /* ── Cost footer ─────────────────────────────────────────── */
    .costs {
      display: flex;
      gap: 0;
      padding-top: 14px;
      border-top: 1px solid var(--divider-color, rgba(0,0,0,.08));
    }
    .cost {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 0 16px;
    }
    .cost:first-child { padding-left: 2px; }
    .cost + .cost {
      border-left: 1px solid var(--divider-color, rgba(0,0,0,.08));
    }
    .cost__label {
      font-size: 10px;
      font-weight: 700;
      color: var(--secondary-text-color, #475569);
      text-transform: uppercase;
      letter-spacing: .08em;
    }
    .cost__value {
      font-size: 16px;
      font-weight: 700;
      color: var(--primary-text-color, #e2e8f0);
      letter-spacing: -.01em;
    }
  `;

  // ─── Card element ─────────────────────────────────────────────────────────

  class LovelaceAiServerCard extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this._collapsed = false;
    }

    /** Called by HA / dev preview with the YAML config object */
    setConfig(config) {
      if (!config.server_entity) {
        throw new Error('[lovelace-ai-server] Defina "server_entity" na configuração do card.');
      }
      this._config = {
        title: 'AI Server',
        server_entity:              null,
        cpu_entity:                 null,
        gpu_entity:                 null,
        gpu_temp_entity:            null,
        ram_entity:                 null,
        vram_entity:                null,
        context_entity:             null,
        context_tokens_entity:      null,
        llama_state_entity:         null,
        llama_gen_tps_entity:       null,
        llama_prompt_tps_entity:    null,
        llama_requests_deferred_entity: null,
        cost_entity:                null,
        monthly_cost_entity:        null,
        ...config,
      };
      this._render();
    }

    /** Called by HA on every state change */
    set hass(hass) {
      this._hass = hass;
      this._render();
    }

    // ── Private ────────────────────────────────────────────────────────────

    _stateOf(entityId) {
      if (!this._hass || !entityId) return null;
      const entity = this._hass.states[entityId];
      return entity ? entity.state : null;
    }

    _isOn() {
      const s = this._stateOf(this._config.server_entity);
      return s === 'on' || s === 'true' || s === '1';
    }

    _toggle() {
      if (!this._hass) return;
      const { server_entity } = this._config;
      const domain = server_entity.split('.')[0];
      const svc = this._isOn() ? 'turn_off' : 'turn_on';
      this._hass.callService(domain, svc, { entity_id: server_entity });
    }

    _toggleCollapse() {
      this._collapsed = !this._collapsed;
      const card = this.shadowRoot.querySelector('.card');
      if (card) card.classList.toggle('card--collapsed', this._collapsed);
    }

    _dotClass() {
      if (!this._isOn()) return 'dot--off';
      const state = this._stateOf(this._config.llama_state_entity);
      if (state === 'processing') return 'dot--processing';
      if (state === 'sleeping')   return 'dot--sleeping';
      return 'dot--on';
    }

    _stateTag() {
      if (!this._isOn()) return '';
      const state = this._stateOf(this._config.llama_state_entity);
      if (!state || state === 'idle') return '';
      return `<span class="state-tag state-tag--${state}">${state}</span>`;
    }

    _metricHTML(label, raw, color, sublabel = null) {
      const display = raw !== null ? formatNum(raw, 0) + '%' : '--';
      const sub = sublabel ? `<span class="metric-sublbl">${sublabel}</span>` : '';
      return `
        <div class="metric">
          <div class="ring-wrap">
            ${ringProgress(raw, color)}
            <span class="ring-val">${display}</span>
          </div>
          <span class="metric-lbl">${label}</span>
          ${sub}
        </div>`;
    }

    _render() {
      if (!this._config) return;

      const cfg = this._config;
      const on  = this._isOn();

      const cpu          = this._stateOf(cfg.cpu_entity);
      const gpu          = this._stateOf(cfg.gpu_entity);
      const gpuTemp      = this._stateOf(cfg.gpu_temp_entity);
      const ram          = this._stateOf(cfg.ram_entity);
      const vram         = this._stateOf(cfg.vram_entity);
      const ctxPct       = this._stateOf(cfg.context_entity);
      const ctxTokens    = this._stateOf(cfg.context_tokens_entity);
      const promptTps    = this._stateOf(cfg.llama_prompt_tps_entity);
      const genTps       = this._stateOf(cfg.llama_gen_tps_entity);
      const queueDepth   = this._stateOf(cfg.llama_requests_deferred_entity);
      const cost         = this._stateOf(cfg.cost_entity);
      const monthlyCost  = this._stateOf(cfg.monthly_cost_entity);

      // GPU temperature sublabel
      const gpuTempLabel = gpuTemp !== null ? `${formatNum(gpuTemp, 0)}°C` : null;

      // Context section
      let contextHTML = '';
      if (cfg.context_entity && ctxPct !== null) {
        const pct = parseFloat(ctxPct);
        const unavail = isNaN(pct) || pct < 0;
        const color = unavail ? 'var(--secondary-text-color, #64748b)' : usageColor(pct);
        const usedN = parseFloat(ctxTokens);
        let tokensLine = '';
        if (!unavail && !isNaN(usedN) && usedN >= 0) {
          if (pct > 0) {
            const total = Math.round(usedN / (pct / 100));
            tokensLine = `${fmtTokens(usedN)}&thinsp;/&thinsp;${fmtTokens(total)} tokens`;
          } else {
            tokensLine = `${fmtTokens(usedN)} tokens`;
          }
        }
        contextHTML = `
          <div class="context-section">
            <div class="ctx-header">
              <span class="ctx-label">Contexto</span>
              <span class="ctx-pct ${unavail ? 'ctx-pct--na' : ''}">${unavail ? 'N/A' : pct.toFixed(1) + '%'}</span>
            </div>
            <div class="ctx-bar-track">
              <div class="ctx-bar-fill"
                style="width:${unavail ? 0 : Math.max(0, Math.min(pct, 100))}%;background:${color}"></div>
            </div>
            ${tokensLine ? `<span class="ctx-tokens">${tokensLine}</span>` : (unavail ? '<span class="ctx-tokens">Servidor llama.cpp indisponível</span>' : '')}
          </div>`;
      }

      // Speed row
      let speedHTML = '';
      if (cfg.llama_prompt_tps_entity || cfg.llama_gen_tps_entity || cfg.llama_requests_deferred_entity) {
        const pTps = parseFloat(promptTps);
        const gTps = parseFloat(genTps);
        const queue = parseFloat(queueDepth);
        const isActive = !isNaN(gTps) && gTps > 0;
        const queueVal = (!isNaN(queue) && queue >= 0) ? Math.round(queue) : '--';
        const promptItem = cfg.llama_prompt_tps_entity
          ? `<div class="speed-item">
              <span class="speed-val">${isNaN(pTps) || pTps < 0 ? '--' : pTps.toFixed(1)}</span>
              <span class="speed-lbl">prompt t/s</span>
            </div>` : '';
        const genItem = cfg.llama_gen_tps_entity
          ? `<div class="speed-item">
              <span class="speed-val ${isActive ? 'speed-val--active' : ''}">${isNaN(gTps) || gTps < 0 ? '--' : gTps.toFixed(1)}</span>
              <span class="speed-lbl">gen t/s</span>
            </div>` : '';
        const queueItem = cfg.llama_requests_deferred_entity
          ? `<div class="speed-item">
              <span class="speed-val ${queueVal > 0 ? 'speed-val--queue' : ''}">${isNaN(queue) || queue < 0 ? '--' : queueVal}</span>
              <span class="speed-lbl">na fila</span>
            </div>` : '';
        speedHTML = `<div class="speed-row">${promptItem}${genItem}${queueItem}</div>`;
      }

      // Costs
      const costDailyHTML = cfg.cost_entity
        ? `<div class="cost">
            <span class="cost__label">Hoje</span>
            <span class="cost__value">R$&nbsp;${formatNum(cost, 2)}</span>
          </div>`
        : '';
      const costMonthlyHTML = cfg.monthly_cost_entity
        ? `<div class="cost">
            <span class="cost__label">Mensal</span>
            <span class="cost__value">R$&nbsp;${formatNum(monthlyCost, 2)}</span>
          </div>`
        : '';
      const costsHTML = (costDailyHTML || costMonthlyHTML)
        ? `<div class="costs">${costDailyHTML}${costMonthlyHTML}</div>`
        : '';

      const body = on
        ? `<div class="metrics">
            ${this._metricHTML('CPU',  cpu,  usageColor(cpu))}
            ${this._metricHTML('GPU',  gpu,  usageColor(gpu), gpuTempLabel)}
            ${this._metricHTML('RAM',  ram,  usageColor(ram))}
            ${this._metricHTML('VRAM', vram, usageColor(vram))}
          </div>
          ${contextHTML}
          ${speedHTML}
          ${costsHTML}`
        : '';

      const pwrLabel = on ? 'Desligar servidor' : 'Ligar servidor';
      const pwrClass = on ? 'pwr--on' : 'pwr--off';
      const dotClass = this._dotClass();
      const stateTag = this._stateTag();

      this.shadowRoot.innerHTML = `
        <style>${STYLES}</style>
        <ha-card>
          <div class="card ${on ? 'card--on' : 'card--off'}${this._collapsed ? ' card--collapsed' : ''}">
            <div class="header" data-header>
              <div class="header__left">
                <span class="dot ${dotClass}"></span>
                <span class="title">${cfg.title}</span>
                ${stateTag}
              </div>
              <div class="header__right">
                <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                <button class="pwr ${pwrClass}" data-pwr aria-label="${pwrLabel}">${PWR_ICON}</button>
              </div>
            </div>
            <div class="body">${body}</div>
          </div>
        </ha-card>`;

      this.shadowRoot.querySelector('[data-header]').addEventListener('click', e => {
        if (!e.target.closest('[data-pwr]')) this._toggleCollapse();
      });
      this.shadowRoot.querySelectorAll('[data-pwr]').forEach(btn => {
        btn.addEventListener('click', e => { e.stopPropagation(); this._toggle(); });
      });
    }

    getCardSize() { return this._collapsed ? 1 : (this._isOn() ? 3 : 2); }

    static getStubConfig() {
      return {
        title:                          'AI Server',
        server_entity:                  'switch.ai_server',
        cpu_entity:                     'sensor.ai_server_cpu_usage',
        gpu_entity:                     'sensor.ai_server_gpu_usage',
        gpu_temp_entity:                'sensor.ai_server_gpu_temperature',
        ram_entity:                     'sensor.ai_server_ram_usage',
        vram_entity:                    'sensor.ai_server_vram_usage',
        context_entity:                 'sensor.ai_server_context_usage',
        context_tokens_entity:          'sensor.ai_server_context_tokens_used',
        llama_state_entity:             'sensor.ai_server_llama_state',
        llama_gen_tps_entity:           'sensor.ai_server_llama_gen_tps',
        llama_prompt_tps_entity:        'sensor.ai_server_llama_prompt_tps',
        llama_requests_deferred_entity: 'sensor.ai_server_llama_requests_deferred',
        cost_entity:                    'sensor.custo_diario_ai_machine',
        monthly_cost_entity:            'sensor.custo_mensal_ai_machine',
      };
    }
  }

  customElements.define(CARD_TAG, LovelaceAiServerCard);

  window.customCards = window.customCards || [];
  window.customCards.push({
    type:        CARD_TAG,
    name:        'AI Server Card',
    description: 'Monitor de recursos do servidor de IA (CPU, GPU, RAM, VRAM) com custo diário.',
    preview:     true,
  });
})();
