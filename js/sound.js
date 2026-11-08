import { storage } from './storage.js';

// 효과음: 소리 파일 없이 브라우저(Web Audio)로 직접 만든다 → 앱 용량이 늘지 않음.
// 브라우저 정책상 첫 터치/클릭(입장하기) 뒤에만 소리가 난다.
export class Sound {
  constructor() {
    this.enabled = storage.get('sound', true);
    this.ctx = null;
    this.recent = 0;      // 너무 많은 소리가 겹치지 않도록
    this.recentReset = 0;
  }

  unlock() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!this.ctx) {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
      // 짧은 잡음 버퍼 (공 튀는 소리 등에 섞음)
      const len = Math.floor(this.ctx.sampleRate * 0.4);
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setEnabled(on) {
    this.enabled = on;
    storage.set('sound', on);
    if (on) this.unlock();
  }

  ok() {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return false;
    const now = this.ctx.currentTime;
    if (now - this.recentReset > 0.1) { this.recentReset = now; this.recent = 0; }
    return ++this.recent <= 6;
  }

  tone(freq, dur, { type = 'sine', vol = 0.3, to = null, delay = 0, attack = 0.005 } = {}) {
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  noise(dur, { vol = 0.2, freq = 1200, q = 1, delay = 0, type = 'bandpass' } = {}) {
    const c = this.ctx, t = c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t);
    s.stop(t + dur + 0.02);
  }

  // 공이 부딪힘: 종류별로 높낮이·느낌이 다름. speed = 부딪힌 속도(m/s)
  impact(type, speed) {
    if (!this.ok()) return;
    const v = Math.min(1, speed / 9);
    switch (type) {
      case 'basketball':
        this.tone(150, 0.12, { vol: 0.35 * v + 0.05, to: 90 });
        this.noise(0.06, { vol: 0.15 * v, freq: 700 });
        break;
      case 'kinball':
      case 'bigvolley':
        this.tone(90, 0.18, { vol: 0.25 * v + 0.04, to: 60 });
        this.noise(0.1, { vol: 0.08 * v, freq: 300 });
        break;
      case 'shuttle':
        this.noise(0.03, { vol: 0.12 * v + 0.02, freq: 4000, q: 3 });
        break;
      case 'frisbee':
      case 'racket':
      case 'jumprope':
      case 'hulahoop':
        this.noise(0.05, { vol: 0.15 * v + 0.03, freq: 2200, q: 2 });
        break;
      default: // 풋살·피구·배구·풋볼
        this.tone(220, 0.08, { vol: 0.25 * v + 0.04, to: 130 });
        this.noise(0.05, { vol: 0.12 * v, freq: 1100 });
    }
  }

  kick() {
    if (!this.ok()) return;
    this.tone(120, 0.1, { vol: 0.4, to: 60 });
    this.noise(0.08, { vol: 0.25, freq: 900 });
  }

  throw() {
    if (!this.ok()) return;
    this.noise(0.15, { vol: 0.12, freq: 1800, q: 0.7 });
  }

  goal() {
    if (!this.enabled || !this.ctx) return;
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.25, { type: 'triangle', vol: 0.25, delay: i * 0.09 }));
    this.noise(0.9, { vol: 0.08, freq: 2500, q: 0.5, delay: 0.3 }); // 환호 느낌
  }

  flag() {
    if (!this.enabled || !this.ctx) return;
    [880, 1175, 1568].forEach((f, i) => this.tone(f, 0.15, { type: 'square', vol: 0.08, delay: i * 0.06 }));
  }

  chuk() {
    if (!this.ok()) return;
    this.tone(300, 0.25, { type: 'triangle', vol: 0.25, to: 700 });
  }

  rope() {
    if (!this.ok()) return;
    this.noise(0.08, { vol: 0.1, freq: 3000, q: 2 });
    this.tone(660, 0.06, { type: 'triangle', vol: 0.08, delay: 0.02 });
  }

  fail() {
    if (!this.enabled || !this.ctx) return;
    this.tone(220, 0.3, { type: 'sawtooth', vol: 0.08, to: 110 });
  }

  whistle() {
    if (!this.enabled || !this.ctx) return;
    this.tone(2100, 0.25, { type: 'sine', vol: 0.15 });
    this.tone(2160, 0.25, { type: 'sine', vol: 0.08 });
    this.tone(2100, 0.35, { type: 'sine', vol: 0.15, delay: 0.3 });
  }

  pop() {
    if (!this.ok()) return;
    this.tone(500, 0.08, { type: 'sine', vol: 0.15, to: 900 });
  }
}
