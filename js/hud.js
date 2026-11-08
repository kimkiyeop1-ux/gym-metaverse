// 화면 표시: 동작 버튼, 키 안내, 조준점, 힘 게이지, 점수, 골 팝업
export class Hud {
  constructor() {
    this.slots = [...document.querySelectorAll('.act-btn.slot')];
    this.keyHints = document.getElementById('key-hints');
    this.reticle = document.getElementById('reticle');
    this.gauge = document.getElementById('gauge');
    this.gaugeFill = document.getElementById('gauge-fill');
    this.gaugeSweet = document.getElementById('gauge-sweet');
    this.gaugeLabel = document.getElementById('gauge-label');
    this.score = document.getElementById('score');
    this.popupEl = document.getElementById('popup');
    this.counterEl = document.getElementById('counter');
    this.lastCounter = '';
    this.lastSig = '';
    this.lastScore = '';
  }

  // actions: [{id, label, key, color}]
  setActions(actions) {
    const sig = actions.map((a) => a.id + a.label).join('|');
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    this.slots.forEach((btn, i) => {
      const a = actions[i];
      if (a) {
        btn.dataset.action = a.id;
        btn.dataset.color = a.color || '';
        btn.textContent = a.label;
        btn.classList.remove('hidden');
      } else {
        btn.dataset.action = '';
        btn.classList.add('hidden');
      }
    });
    this.keyHints.innerHTML = actions
      .map((a) => `<span class="hint-chip"><kbd>${a.key}</kbd>${a.label.replace('\n', ' ')}${a.hold ? ' (꾹)' : ''}</span>`)
      .join('');
  }

  setAim(show) {
    this.reticle.classList.toggle('show', show);
  }

  // power: 0~1 또는 null(숨김), sweet: [시작, 끝] 또는 null
  setGauge(power, sweet, label) {
    if (power === null) {
      this.gauge.classList.remove('show');
      return;
    }
    this.gauge.classList.add('show');
    this.gauge.classList.toggle('shot', !!sweet);
    if (sweet) {
      this.gaugeSweet.style.left = `${sweet[0] * 100}%`;
      this.gaugeSweet.style.width = `${(sweet[1] - sweet[0]) * 100}%`;
    }
    this.gaugeFill.style.width = `${power * 100}%`;
    this.gaugeLabel.textContent = label;
  }

  setScore(goals, flags) {
    const key = `${goals}/${flags}`;
    if (key === this.lastScore) return;
    this.lastScore = key;
    const parts = [];
    if (goals > 0) parts.push(`<span>🏀 골 ${goals}</span>`);
    if (flags > 0) parts.push(`<span>🚩 플래그 ${flags}</span>`);
    this.score.innerHTML = parts.join('');
  }

  // 줄넘기·훌라후프 횟수 표시 (null 이면 숨김)
  setCounter(title, value, sub) {
    const key = title === null ? '' : `${title}|${value}|${sub}`;
    if (key === this.lastCounter) return;
    this.lastCounter = key;
    if (title === null) {
      this.counterEl.classList.remove('show');
      return;
    }
    this.counterEl.innerHTML = `<div class="small">${title}</div><div class="big">${value}</div><div class="small">${sub}</div>`;
    this.counterEl.classList.add('show');
  }

  popup(text) {
    const el = this.popupEl;
    el.textContent = text;
    el.classList.remove('show');
    void el.offsetWidth; // 애니메이션 다시 시작
    el.classList.add('show');
  }
}
