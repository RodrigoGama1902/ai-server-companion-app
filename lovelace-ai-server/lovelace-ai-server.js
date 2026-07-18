(function () {
  'use strict';

  const CARD_TAG = 'lovelace-ai-server';

  // ─── Helpers ──────────────────────────────────────────────────────────────

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function formatNum(raw, decimals = 1) {
    const n = parseFloat(raw);
    return isNaN(n) ? '--' : n.toFixed(decimals);
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
        stroke="rgba(255,255,255,0.07)" stroke-width="5"/>
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
      background: linear-gradient(160deg, #0d1526 0%, #0f172a 60%, #111827 100%);
      border-radius: 16px;
      padding: 20px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      color: #f1f5f9;
      box-shadow: 0 4px 32px rgba(0, 0, 0, .55);
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
    }
    .card--on .header { margin-bottom: 20px; }
    .header__left {
      display: flex;
      align-items: center;
      gap: 9px;
    }
    .dot {
      width: 8px; height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
      transition: background .4s, box-shadow .4s;
    }
    .dot--on  { background: #22c55e; box-shadow: 0 0 8px #22c55e99; }
    .dot--off { background: #334155; }

    .title {
      font-size: 12px;
      font-weight: 700;
      color: #64748b;
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
      gap: 7px;
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
      color: #e2e8f0;
      pointer-events: none;
      white-space: nowrap;
    }
    .metric-lbl {
      font-size: 10px;
      font-weight: 700;
      color: #475569;
      text-transform: uppercase;
      letter-spacing: .08em;
    }

    /* ── Cost footer ─────────────────────────────────────────── */
    .costs {
      display: flex;
      gap: 0;
      padding-top: 14px;
      border-top: 1px solid rgba(255, 255, 255, .06);
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
      border-left: 1px solid rgba(255, 255, 255, .07);
    }
    .cost__label {
      font-size: 10px;
      font-weight: 700;
      color: #475569;
      text-transform: uppercase;
      letter-spacing: .08em;
    }
    .cost__value {
      font-size: 16px;
      font-weight: 700;
      color: #e2e8f0;
      letter-spacing: -.01em;
    }
  `;

  // ─── Card element ─────────────────────────────────────────────────────────

  class LovelaceAiServerCard extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
    }

    /** Called by HA / dev preview with the YAML config object */
    setConfig(config) {
      if (!config.server_entity) {
        throw new Error('[lovelace-ai-server] Defina "server_entity" na configuração do card.');
      }
      this._config = {
        title: 'AI Server',
        server_entity:         null,
        cpu_entity:            null,
        gpu_entity:            null,
        ram_entity:            null,
        vram_entity:           null,
        cost_entity:           null,
        monthly_cost_entity:   null,
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

    _metricHTML(label, raw, color) {
      const display = raw !== null ? formatNum(raw, 0) + '%' : '--';
      return `
        <div class="metric">
          <div class="ring-wrap">
            ${ringProgress(raw, color)}
            <span class="ring-val">${display}</span>
          </div>
          <span class="metric-lbl">${label}</span>
        </div>`;
    }

    _render() {
      if (!this._config) return;

      const cfg = this._config;
      const on  = this._isOn();

      const cpu          = this._stateOf(cfg.cpu_entity);
      const gpu          = this._stateOf(cfg.gpu_entity);
      const ram          = this._stateOf(cfg.ram_entity);
      const vram         = this._stateOf(cfg.vram_entity);
      const cost         = this._stateOf(cfg.cost_entity);
      const monthlyCost  = this._stateOf(cfg.monthly_cost_entity);

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
            ${this._metricHTML('GPU',  gpu,  usageColor(gpu))}
            ${this._metricHTML('RAM',  ram,  usageColor(ram))}
            ${this._metricHTML('VRAM', vram, usageColor(vram))}
          </div>
          ${costsHTML}`
        : '';

      const pwrLabel = on ? 'Desligar servidor' : 'Ligar servidor';
      const pwrClass = on ? 'pwr--on' : 'pwr--off';

      this.shadowRoot.innerHTML = `
        <style>${STYLES}</style>
        <ha-card>
          <div class="card ${on ? 'card--on' : 'card--off'}">
            <div class="header">
              <div class="header__left">
                <span class="dot ${on ? 'dot--on' : 'dot--off'}"></span>
                <span class="title">${cfg.title}</span>
              </div>
              <button class="pwr ${pwrClass}" data-pwr aria-label="${pwrLabel}">${PWR_ICON}</button>
            </div>
            ${body}
          </div>
        </ha-card>`;

      this.shadowRoot.querySelectorAll('[data-pwr]').forEach(btn => {
        btn.addEventListener('click', e => { e.stopPropagation(); this._toggle(); });
      });
    }

    getCardSize() { return this._isOn() ? 3 : 2; }

    static getStubConfig() {
      return {
        title:               'AI Server',
        server_entity:       'switch.ai_server',
        cpu_entity:          'sensor.ai_server_cpu_usage',
        gpu_entity:          'sensor.ai_server_gpu_usage',
        ram_entity:          'sensor.ai_server_ram_usage',
        vram_entity:         'sensor.ai_server_vram_usage',
        cost_entity:         'sensor.custo_diario_ai_machine',
        monthly_cost_entity: 'sensor.custo_mensal_ai_machine',
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
