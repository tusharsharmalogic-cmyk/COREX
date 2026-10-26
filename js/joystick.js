// ============================================
// VirtualJoystick - touch/pointer based joystick
// Works on both DOM elements and reports vector + magnitude
// ============================================

class VirtualJoystick {
  constructor(baseEl, knobEl) {
    this.base = baseEl;
    this.knob = knobEl;
    this.radius = baseEl.clientWidth / 2;
    this.maxDist = this.radius * 0.60;
    this.active = false;
    this.pointerId = null;
    this.vec = { x: 0, y: 0 };
    this.magnitude = 0;
    this.fullPull = false;
    this.fireThreshold = 0.80;
    this.deadzone = 0.12;

    this._onStart = this._onStart.bind(this);
    this._onMove  = this._onMove.bind(this);
    this._onEnd   = this._onEnd.bind(this);

    baseEl.addEventListener('pointerdown', this._onStart);
    window.addEventListener('pointermove', this._onMove);
    window.addEventListener('pointerup', this._onEnd);
    window.addEventListener('pointercancel', this._onEnd);

    this.onChange = null;
    this.onRelease = null;
  }

  _getCenter() {
    const r = this.base.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  _onStart(e) {
    if (this.active) return;
    this.active = true;
    this.pointerId = e.pointerId;
    this.base.setPointerCapture?.(e.pointerId);
    this._updateFromEvent(e);
  }

  _onMove(e) {
    if (!this.active || e.pointerId !== this.pointerId) return;
    this._updateFromEvent(e);
  }

  _onEnd(e) {
    if (!this.active || e.pointerId !== this.pointerId) return;
    this.active = false;
    this.pointerId = null;
    this.vec.x = 0; this.vec.y = 0;
    this.magnitude = 0;
    this.fullPull = false;
    this._setKnob(0, 0);
    this.base.classList.remove('aiming');
    if (this.onChange) this.onChange(this.vec, 0);
    if (this.onRelease) this.onRelease();
  }

  _updateFromEvent(e) {
    const c = this._getCenter();
    let dx = e.clientX - c.x;
    let dy = e.clientY - c.y;
    const dist = Math.hypot(dx, dy);

    let kx = dx, ky = dy;
    if (dist > this.maxDist) {
      const s = this.maxDist / dist;
      kx = dx * s; ky = dy * s;
    }
    this._setKnob(kx, ky);

    const m = Math.min(dist / this.maxDist, 1);
    this.magnitude = m;
    if (dist > 0.001) {
      this.vec.x = (dx / dist) * m;
      this.vec.y = (dy / dist) * m;
    } else {
      this.vec.x = 0; this.vec.y = 0;
    }

    // Fire when pulled past threshold — release instantly when back inside
    const wasFull = this.fullPull;
    this.fullPull = m >= this.fireThreshold;
    if (this.fullPull !== wasFull) {
      this.base.classList.toggle('aiming', this.fullPull);
    }

    if (m < this.deadzone) {
      this.vec.x = 0; this.vec.y = 0;
    }

    if (this.onChange) this.onChange(this.vec, m);
  }

  _setKnob(x, y) {
    this.knob.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
  }

  destroy() {
    this.base.removeEventListener('pointerdown', this._onStart);
    window.removeEventListener('pointermove', this._onMove);
    window.removeEventListener('pointerup', this._onEnd);
    window.removeEventListener('pointercancel', this._onEnd);
  }
}

window.VirtualJoystick = VirtualJoystick;