import { Joystick } from './joystick.js';

// 키보드·마우스·터치 입력을 하나로 모은다.
//   move  : {x: 오른쪽 +, y: 앞쪽 +}, 크기 0~1
//   look  : 이번 프레임의 시점 회전량 (라디안)
//   zoom  : 이번 프레임의 확대/축소량 (+ 이면 멀어짐)
//   actions : 버튼/키 눌림 (consume 하면 한 번만 처리)
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.look = { x: 0, y: 0 };
    this.zoom = 0;
    this.pressed = new Set();   // 이번 프레임에 새로 눌린 동작
    this.held = new Set();      // 누르고 있는 동작
    this.dragging = false;      // 사용자가 시점을 직접 돌리는 중
    this.isTouch = false;

    this.joystick = new Joystick(
      document.getElementById('joystick'),
      document.getElementById('joystick-knob')
    );
    this.lookPointers = new Map(); // pointerId -> {x, y}
    this.pinchDist = 0;
    this.mouseId = null;

    this.bindKeyboard();
    this.bindPointer();
    this.bindButtons();

    // 손가락 조작이 주인 기기(휴대폰·태블릿)면 처음부터 터치 화면 표시.
    // 터치스크린 노트북은 실제로 터치했을 때 전환된다.
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) this.setTouchMode(true);
  }

  setTouchMode(on) {
    if (this.isTouch === on) return;
    this.isTouch = on;
    document.body.classList.toggle('touch', on);
  }

  // ---------- 키보드 ----------
  bindKeyboard() {
    const keyAction = { Space: 'jump', KeyE: 'grab', KeyF: 'kick', KeyQ: 'throw' };
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
      this.keys.add(e.code);
      const a = keyAction[e.code];
      if (a && !e.repeat) this.press(a);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      const a = keyAction[e.code];
      if (a) this.held.delete(a);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.held.clear();
    });
  }

  // ---------- 마우스 / 터치 ----------
  bindPointer() {
    const c = this.canvas;
    const LOOK_SPEED_MOUSE = 0.005;
    const LOOK_SPEED_TOUCH = 0.008;

    c.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') {
        this.setTouchMode(true);
        if (e.clientX < window.innerWidth * 0.45 && !this.joystick.active) {
          this.joystick.start(e);
        } else {
          this.lookPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
          this.updatePinchBase();
        }
      } else {
        if (this.mouseId !== null) return;
        this.mouseId = e.pointerId;
        this.lastMouse = { x: e.clientX, y: e.clientY };
        c.classList.add('grabbing');
      }
      this.dragging = true;
      c.setPointerCapture(e.pointerId);
    });

    c.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') {
        if (this.joystick.pointerId === e.pointerId) {
          this.joystick.move(e);
          return;
        }
        const p = this.lookPointers.get(e.pointerId);
        if (!p) return;
        if (this.lookPointers.size >= 2) {
          p.x = e.clientX;
          p.y = e.clientY;
          const d = this.pinchDistance();
          if (this.pinchDist > 0 && d > 0) this.zoom += Math.log(this.pinchDist / d) * 1.2;
          this.pinchDist = d;
        } else {
          this.look.x += (e.clientX - p.x) * LOOK_SPEED_TOUCH;
          this.look.y += (e.clientY - p.y) * LOOK_SPEED_TOUCH;
          p.x = e.clientX;
          p.y = e.clientY;
        }
      } else if (e.pointerId === this.mouseId) {
        this.look.x += (e.clientX - this.lastMouse.x) * LOOK_SPEED_MOUSE;
        this.look.y += (e.clientY - this.lastMouse.y) * LOOK_SPEED_MOUSE;
        this.lastMouse = { x: e.clientX, y: e.clientY };
      }
    });

    const up = (e) => {
      if (this.joystick.pointerId === e.pointerId) this.joystick.end();
      if (this.lookPointers.delete(e.pointerId)) this.updatePinchBase();
      if (e.pointerId === this.mouseId) {
        this.mouseId = null;
        c.classList.remove('grabbing');
      }
      this.dragging = this.lookPointers.size > 0 || this.mouseId !== null;
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);

    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoom += Math.sign(e.deltaY) * 0.12;
    }, { passive: false });

    c.addEventListener('contextmenu', (e) => e.preventDefault());
    // iOS 사파리 핀치 확대 방지
    document.addEventListener('gesturestart', (e) => e.preventDefault());
  }

  pinchDistance() {
    const pts = [...this.lookPointers.values()];
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }

  updatePinchBase() {
    this.pinchDist = this.pinchDistance();
  }

  // ---------- 화면 동작 버튼 ----------
  bindButtons() {
    for (const btn of document.querySelectorAll('[data-action]')) {
      const action = btn.dataset.action;
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        btn.classList.add('down');
        this.press(action);
      });
      const release = () => {
        btn.classList.remove('down');
        this.held.delete(action);
      };
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', release);
      btn.addEventListener('pointerleave', release);
    }
  }

  press(action) {
    this.pressed.add(action);
    this.held.add(action);
  }

  // 이번 프레임에 눌렸는지 (한 번만 true)
  consume(action) {
    const had = this.pressed.has(action);
    this.pressed.delete(action);
    return had;
  }

  // 이동 입력 (키보드 + 조이스틱)
  getMove() {
    const k = this.keys;
    let x = 0, y = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) y += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (x || y) {
      const len = Math.hypot(x, y);
      return { x: x / len, y: y / len };
    }
    return { x: this.joystick.x, y: this.joystick.y };
  }

  takeLook() {
    const l = { x: this.look.x, y: this.look.y };
    this.look.x = 0;
    this.look.y = 0;
    return l;
  }

  takeZoom() {
    const z = this.zoom;
    this.zoom = 0;
    return z;
  }

  endFrame() {
    this.pressed.clear();
  }
}
