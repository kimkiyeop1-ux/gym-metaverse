// 모바일 가상 조이스틱 (화면 왼쪽 아무 곳이나 누르면 그 자리에 나타남)
export class Joystick {
  constructor(baseEl, knobEl) {
    this.base = baseEl;
    this.knob = knobEl;
    this.radius = 50;    // 손잡이가 움직일 수 있는 최대 거리(px)
    this.pointerId = null;
    this.cx = 0;
    this.cy = 0;
    this.x = 0;          // -1 ~ 1 (오른쪽 +)
    this.y = 0;          // -1 ~ 1 (앞쪽 +)
  }

  get active() {
    return this.pointerId !== null;
  }

  start(e) {
    this.pointerId = e.pointerId;
    this.cx = e.clientX;
    this.cy = e.clientY;
    this.base.style.left = `${this.cx}px`;
    this.base.style.top = `${this.cy}px`;
    this.base.classList.add('active');
    this.move(e);
  }

  move(e) {
    let dx = e.clientX - this.cx;
    let dy = e.clientY - this.cy;
    const len = Math.hypot(dx, dy);
    if (len > this.radius) {
      dx *= this.radius / len;
      dy *= this.radius / len;
    }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    // 가운데 근처 작은 떨림 무시
    const dead = 0.12;
    let nx = dx / this.radius, ny = -dy / this.radius;
    const m = Math.hypot(nx, ny);
    if (m < dead) { nx = 0; ny = 0; }
    else {
      const s = (m - dead) / (1 - dead) / m;
      nx *= s; ny *= s;
    }
    this.x = nx;
    this.y = ny;
  }

  end() {
    this.pointerId = null;
    this.x = 0;
    this.y = 0;
    this.knob.style.transform = 'translate(0px, 0px)';
    this.base.classList.remove('active');
    // 기본 위치로 복귀
    this.base.style.left = '';
    this.base.style.top = '';
  }
}
