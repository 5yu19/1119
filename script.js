  (() => {
    'use strict';

    const canvas = document.getElementById('clock');
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;
    const timeLabel = document.getElementById('accessible-time');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    const PALETTE = [
      { hex: '#FF4B57', rgb: [255, 75, 87] },
      { hex: '#7CFF5F', rgb: [124, 255, 95] },
      { hex: '#4F83FF', rgb: [79, 131, 255] },
      { hex: '#FF4B57', rgb: [255, 75, 87] },
      { hex: '#7CFF5F', rgb: [124, 255, 95] },
      { hex: '#4F83FF', rgb: [79, 131, 255] }
    ];

    const BASE_ALPHA = 0.36;
    const DENSITY_MULTIPLIER = 1.2;

    // MacBook Pro 14-inch: 3024×1964 physical pixels = 1512×982 CSS pixels.
    // Layout is always calculated on this fixed design canvas.
    const DESIGN_WIDTH = 1512;
    const DESIGN_HEIGHT = 982;

    let viewportWidth = 0, viewportHeight = 0;
    let viewportScale = 1, offsetX = 0, offsetY = 0;

    const rand = (a, b) => a + Math.random() * (b - a);
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const mix = (a, b, t) => a + (b - a) * t;
    const easeOut = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
    const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
    const TAU = Math.PI * 2;

    function makeDiscSprite(rgb) {
      const sprite = document.createElement('canvas');
      const size = 120;
      sprite.width = sprite.height = size;
      const sctx = sprite.getContext('2d');
      const cx = size / 2;
      const cy = size / 2;
      const radius = size * 0.42;
      const cell = 4;
      sctx.fillStyle = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
      for (let y = cell / 2; y < size; y += cell) {
        for (let x = cell / 2; x < size; x += cell) {
          const dx = x - cx;
          const dy = y - cy;
          const dist = Math.hypot(dx, dy);
          if (dist > radius) continue;
          const edge = 1 - dist / radius;
          const keep = dist < radius * 0.86 ? 0.96 : mix(0.96, 0.50, 1 - edge / 0.14);
          if (Math.random() > keep) continue;
          const r = dist < radius * 0.82 ? rand(1.2, 1.9) : rand(0.8, 1.35);
          sctx.beginPath();
          sctx.arc(x + rand(-0.28, 0.28), y + rand(-0.28, 0.28), r, 0, TAU);
          sctx.fill();
        }
      }
      return sprite;
    }
    const sprites = PALETTE.map(c => makeDiscSprite(c.rgb));

    let width = 0, height = 0, dpr = 1, scale = 1, dotStep = 13, particleRadius = 20;
    let positions = [], slots = [], dust = [];
    let timeText = '', ready = false, lastFrame = 0, lastTick = 0;
    let use24Hour = true;
    const pointer = { x: -9999, y: -9999, vx: 0, vy: 0, active: false, lastMove: 0 };
    const dragToggle = {
      pointerId: null,
      armed: false,
      active: false,
      moved: false,
      startX: 0,
      startY: 0,
      dx: 0,
      progress: 0,
      targetMode24: null,
      visual: 0,
      hintX: 0
    };

    function getDisplayTime() {
      const d = new Date();
      let h = d.getHours();
      if (!use24Hour) h = h % 12 || 12;
      return [h, d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':');
    }

    function computeLayout() {
      const ratios = [0.68, 0.68, 0.24, 0.68, 0.68, 0.24, 0.68, 0.68];
      if (width < 650 && height > width) {
        const topRatio = ratios.slice(0, 5).reduce((a, b) => a + b, 0);
        scale = Math.min(height * 0.27, width * 0.92 / topRatio, 250);
        dotStep = clamp((scale * 0.060) / Math.sqrt(DENSITY_MULTIPLIER), 9.1, 18.3);
        particleRadius = scale * 0.09;
        positions = [];
        let x = (width - topRatio * scale) / 2;
        for (let i = 0; i < 5; i++) {
          positions[i] = { x, y: height / 2 - scale * 0.69, w: ratios[i] * scale, h: scale };
          x += ratios[i] * scale;
        }
        positions[5] = { x: width / 2, y: height / 2, w: 0, h: scale, hidden: true };
        x = (width - (ratios[6] + ratios[7]) * scale) / 2;
        for (let i = 6; i <= 7; i++) {
          positions[i] = { x, y: height / 2 + scale * 0.69, w: ratios[i] * scale, h: scale };
          x += ratios[i] * scale;
        }
        return;
      }
      const totalRatio = ratios.reduce((a, b) => a + b, 0);
      scale = Math.min(height * 0.59, width * 0.89 / totalRatio, 335);
      dotStep = clamp((scale * 0.060) / Math.sqrt(DENSITY_MULTIPLIER), 9.1, 20.2);
      particleRadius = scale * 0.09;
      let x = (width - totalRatio * scale) / 2;
      positions = ratios.map((ratio) => {
        const box = { x, y: height / 2, w: ratio * scale, h: scale };
        x += box.w;
        return box;
      });
    }

    function sampleGlyph(char, index) {
      const box = positions[index];
      if (box.hidden) return [];
      const off = document.createElement('canvas');
      off.width = Math.max(1, Math.ceil(box.w));
      off.height = Math.max(1, Math.ceil(box.h));
      const c = off.getContext('2d', { willReadFrequently: true });
      c.fillStyle = '#fff';
      if (char === ':') {
        const r = scale * 0.082;
        c.beginPath(); c.arc(off.width / 2, off.height / 2 - scale * 0.17, r, 0, TAU); c.fill();
        c.beginPath(); c.arc(off.width / 2, off.height / 2 + scale * 0.17, r, 0, TAU); c.fill();
      } else {
        c.font = `900 ${scale * 1.11}px 'Inter Display', Inter, 'Arial Black', Arial, sans-serif`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(char, off.width / 2, off.height / 2 + scale * 0.035, off.width * 0.98);
      }
      const rgba = c.getImageData(0, 0, off.width, off.height).data;
      const targets = [];
      for (let py = dotStep * 0.55; py < off.height - dotStep * 0.45; py += dotStep) {
        for (let px = dotStep * 0.55; px < off.width - dotStep * 0.35; px += dotStep) {
          const xx = Math.floor(px), yy = Math.floor(py);
          if (rgba[(yy * off.width + xx) * 4 + 3] < 150) continue;
          targets.push({ x: box.x + px, y: box.y - scale / 2 + py });
        }
      }
      for (let i = targets.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [targets[i], targets[j]] = [targets[j], targets[i]];
      }
      return targets;
    }

    function newParticle(x, y, slotIndex) {
      return {
        x, y, sx: x, sy: y, tx: x, ty: y, bx: x, by: y,
        radius: particleRadius,
        slotIndex,
        color: Math.floor(Math.random() * PALETTE.length),
        alpha: 1, fromAlpha: 1, toAlpha: 1,
        phase: rand(0, TAU), speed: rand(0.75, 1.15),
        transition: null, brokenAt: -100000, repairAt: 0,
        repairDuration: 700, nextBreak: 0
      };
    }

    function beginMorph(slot, char, now, force = false) {
      if (slot.char === char && !force) return;
      const targets = sampleGlyph(char, slot.index);
      const list = slot.particles;
      const box = positions[slot.index];
      while (list.length < targets.length) {
        const anchor = list.length ? list[Math.floor(Math.random() * list.length)] : null;
        const x = anchor ? anchor.x : box.x + box.w / 2;
        const y = anchor ? anchor.y : box.y;
        const p = newParticle(x + rand(-13, 13), y + rand(-13, 13), slot.index);
        p.alpha = 0;
        list.push(p);
      }
      slot.char = char;
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        const target = targets[i];
        const destination = target || { x: box.x + box.w * 0.50, y: box.y };
        const angle = rand(-Math.PI, Math.PI);
        const radius = rand(scale * 0.16, scale * 0.44);
        p.sx = p.x; p.sy = p.y;
        p.tx = destination.x; p.ty = destination.y;
        p.bx = p.x + radius * Math.cos(angle) + rand(-scale * 0.09, scale * 0.09);
        p.by = p.y + radius * Math.sin(angle);
        p.fromAlpha = p.alpha;
        p.toAlpha = target ? 1 : 0;
        p.transition = {
          start: now + (reducedMotion.matches ? 0 : (force ? rand(0, 160) : rand(0, 65))),
          duration: reducedMotion.matches ? 1 : (force ? rand(920, 1240) : rand(520, 700)),
          type: 'morph'
        };
      }
    }

    function setTime(t, now, force = false) {
      for (let i = 0; i < t.length; i++) beginMorph(slots[i], t[i], now, force);
      timeText = t;
      timeLabel.dateTime = t;
      timeLabel.textContent = t;
      const modeLabel = use24Hour ? '24시간제' : '12시간제';
      canvas.setAttribute('aria-label', `현재 시간 ${t}, ${modeLabel}. 커서를 가까이 가져가면 입자가 모래처럼 부서집니다. 화면 어디에서나 오른쪽으로 드래그하면 12시간제와 24시간제를 전환할 수 있습니다.`);
    }

    function reset(intro = false) {
      // Keep a fixed MacBook Pro 14-inch layout; only scale the whole canvas.
      viewportWidth = window.innerWidth;
      viewportHeight = window.innerHeight;
      width = DESIGN_WIDTH;
      height = DESIGN_HEIGHT;
      viewportScale = Math.min(viewportWidth / width, viewportHeight / height);
      offsetX = (viewportWidth - width * viewportScale) / 2;
      offsetY = (viewportHeight - height * viewportScale) / 2;

      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(viewportWidth * dpr);
      canvas.height = Math.round(viewportHeight * dpr);
      canvas.style.width = viewportWidth + 'px';
      canvas.style.height = viewportHeight + 'px';
      ctx.setTransform(dpr * viewportScale, 0, 0, dpr * viewportScale, dpr * offsetX, dpr * offsetY);

      computeLayout();
      dust = [];
      dragToggle.progress = dragToggle.visual = 0;
      dragToggle.targetMode24 = null;
      const now = performance.now();
      const t = getDisplayTime();
      slots = Array.from(t, (char, i) => ({
        index: i,
        char,
        particles: sampleGlyph(char, i).map(({ x, y }) => newParticle(x, y, i))
      }));
      timeText = t;
      timeLabel.dateTime = t;
      timeLabel.textContent = t;
      const modeLabel = use24Hour ? '24시간제' : '12시간제';
      canvas.setAttribute('aria-label', `현재 시간 ${t}, ${modeLabel}. 커서를 가까이 가져가면 입자가 모래처럼 부서집니다. 화면 어디에서나 오른쪽으로 드래그하면 12시간제와 24시간제를 전환할 수 있습니다.`);
      ready = true;
      if (intro) {
        for (const slot of slots) for (const p of slot.particles) {
          p.tx = p.x; p.ty = p.y;
          p.sx = p.x + rand(-scale * 0.42, scale * 0.42);
          p.sy = p.y + rand(-scale * 0.44, scale * 0.44);
          p.x = p.sx; p.y = p.sy;
          p.alpha = 0;
          p.fromAlpha = 0; p.toAlpha = 1;
          p.transition = {
            start: now + rand(0, 310),
            duration: reducedMotion.matches ? 1 : rand(840, 1320),
            type: 'intro'
          };
        }
      }
    }

    // A right swipe anywhere toggles 12h <-> 24h; the previous hour-digit
    // compression is retained as the gesture feedback.
    function updateDragProgress(dx) {
      dragToggle.dx = dx;
      const rightwardTravel = Math.max(0, dx);
      dragToggle.progress = clamp(rightwardTravel / Math.max(80, scale * 0.42), 0, 1);
      dragToggle.visual = dragToggle.progress;
      dragToggle.targetMode24 = rightwardTravel > 0 ? !use24Hour : null;
    }

    function toggleHourMode(to24, now) {
      if (to24 === use24Hour) return;
      use24Hour = to24;
      dragToggle.progress = 0;
      dragToggle.visual = 0;
      dragToggle.targetMode24 = null;
      setTime(getDisplayTime(), now, true);
    }

    function shatter(p, now, pointerForce = 1) {
      p.brokenAt = now;
      p.repairAt = now + rand(640, 1020);
      p.repairDuration = rand(600, 900);
      p.nextBreak = now + rand(1450, 2100);
      const count = Math.floor(clamp(p.radius * 1.8 + rand(16, 28), 28, 55) * pointerForce);
      const maxDust = width < 700 ? 2600 : 7000;
      if (dust.length + count > maxDust) {
        dust.splice(0, Math.min(dust.length, dust.length + count - maxDust));
      }
      for (let i = 0; i < count; i++) {
        const a = rand(0, TAU);
        const seedR = rand(0, p.radius * 0.9);
        const force = rand(0.45, 3.30) * Math.min(1.35, dotStep / 10);
        dust.push({
          x: p.x + Math.cos(a) * seedR,
          y: p.y + Math.sin(a) * seedR,
          vx: Math.cos(a) * force + pointer.vx * rand(0.08, 0.20),
          vy: Math.sin(a) * force + pointer.vy * rand(0.08, 0.20) - rand(0, 0.2),
          radius: Math.random() < 0.72 ? rand(0.9, 1.9) : rand(1.9, 2.7),
          color: p.color,
          born: now,
          life: rand(800, 1550),
          drag: rand(0.94, 0.985),
          gravity: rand(-0.010, 0.026),
          alpha: rand(0.72, 1.0),
          phase: rand(0, TAU)
        });
      }
    }

    function hoverToDust(now) {
      if (!pointer.active || reducedMotion.matches || dragToggle.active) return;
      const reach = clamp(scale * 0.23, 40, 100);
      const r2 = reach * reach;
      let breaks = 0;
      for (const slot of slots) {
        for (const p of slot.particles) {
          if (p.alpha < 0.10 || now < p.nextBreak) continue;
          const dx = p.x - pointer.x;
          const dy = p.y - pointer.y;
          const rr = r2 + p.radius * p.radius;
          if (dx * dx + dy * dy < rr) {
            if (breaks < 18) { shatter(p, now); breaks++; }
          }
        }
      }
    }

    function renderDust(now, dt) {
      ctx.globalCompositeOperation = 'screen';
      for (let i = dust.length - 1; i >= 0; i--) {
        const d = dust[i];
        const life = (now - d.born) / d.life;
        if (life >= 1) {
          dust[i] = dust[dust.length - 1]; dust.pop();
          continue;
        }
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        const drag = Math.pow(d.drag, dt);
        d.vx *= drag;
        d.vy = d.vy * drag + d.gravity * dt;
        d.x += Math.sin(now * 0.003 + d.phase) * 0.05 * dt;
        const fade = Math.pow(1 - smooth(life), 1.05);
        const rgb = PALETTE[d.color].rgb;
        ctx.globalAlpha = BASE_ALPHA * 1.15 * d.alpha * fade;
        ctx.fillStyle = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.radius * (0.96 - 0.22 * life), 0, TAU);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    function updateParticlePositionOnly(p, now) {
      const tr = p.transition;
      if (!tr) return;
      if (now < tr.start) { p.x = p.sx; p.y = p.sy; return; }
      const t = clamp((now - tr.start) / tr.duration, 0, 1);
      if (tr.type === 'intro') {
        const e = easeOut(t);
        p.x = mix(p.sx, p.tx, e);
        p.y = mix(p.sy, p.ty, e);
        p.alpha = e;
      } else if (t < 0.29) {
        const e = easeOut(t / 0.29);
        p.x = mix(p.sx, p.bx, e);
        p.y = mix(p.sy, p.by, e);
        p.alpha = mix(p.fromAlpha, Math.min(1, p.fromAlpha + 0.12), e);
      } else {
        const e = smooth((t - 0.29) / 0.71);
        p.x = mix(p.bx, p.tx, e);
        p.y = mix(p.by, p.ty, e);
        p.alpha = mix(Math.max(p.fromAlpha, 0.57), p.toAlpha, e);
      }
      if (t >= 1) {
        p.x = p.tx; p.y = p.ty; p.alpha = p.toAlpha;
        p.transition = null;
      }
    }

    function transformedParticleXY(p, now) {
      const driftX = reducedMotion.matches ? 0 : Math.sin(now * 0.00040 * p.speed + p.phase) * 0.35;
      const driftY = reducedMotion.matches ? 0 : Math.cos(now * 0.00039 * p.speed + p.phase) * 0.35;
      let x = p.x + driftX;
      let y = p.y + driftY;
      if (p.slotIndex < 2 && dragToggle.visual > 0.001) {
        const left = positions[0].x;
        const right = positions[1].x + positions[1].w;
        const center = (left + right) / 2;
        const scaleX = 1 - 0.36 * dragToggle.visual;
        x = center + (x - center) * scaleX;
        x += dragToggle.dx * 0.10;
      }
      return { x, y };
    }

    function drawParticle(p, now) {
      if (p.alpha <= 0.015) return;
      const intactness = p.brokenAt < 0 ? 1 : (now < p.repairAt ? 0 : smooth((now - p.repairAt) / p.repairDuration));
      const opacity = p.alpha * intactness;
      if (opacity <= 0.012) return;
      const pos = transformedParticleXY(p, now);
      const extent = p.radius * 1.16;
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = BASE_ALPHA * opacity;
      ctx.drawImage(sprites[p.color], pos.x - extent, pos.y - extent, extent * 2, extent * 2);
      ctx.globalCompositeOperation = 'source-over';
    }

    function render(now) {
      requestAnimationFrame(render);
      if (!ready) return;
      const dt = clamp(lastFrame ? (now - lastFrame) / 16.67 : 1, 0.5, 2.0);
      lastFrame = now;
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#000';
      // Fill the entire viewport, including letterbox areas.
      ctx.fillRect(-offsetX / viewportScale, -offsetY / viewportScale,
                   viewportWidth / viewportScale, viewportHeight / viewportScale);

      // Restrict particles to the fixed 1512×982 design area.
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, width, height);
      ctx.clip();

      if (now - lastTick > 105) {
        const t = getDisplayTime();
        if (t !== timeText) setTime(t, now);
        lastTick = now;
      }
      if (!dragToggle.active) {
        dragToggle.visual += (0 - dragToggle.visual) * 0.18;
        if (Math.abs(dragToggle.visual) < 0.001) dragToggle.visual = 0;
      }
      for (const slot of slots) for (const p of slot.particles) updateParticlePositionOnly(p, now);
      hoverToDust(now);
      for (const slot of slots) for (const p of slot.particles) drawParticle(p, now);
      renderDust(now, dt);
      ctx.globalAlpha = 1;
      ctx.restore();
      pointer.vx *= 0.82;
      pointer.vy *= 0.82;
    }

    // Convert physical pointer coordinates back to fixed design coordinates.
    function getDesignPointer(e) {
      return {
        x: (e.clientX - offsetX) / viewportScale,
        y: (e.clientY - offsetY) / viewportScale
      };
    }

    function updatePointer(e) {
      const now = performance.now();
      const pos = getDesignPointer(e);
      if (pointer.lastMove && pointer.active) {
        const dt = Math.max(8, now - pointer.lastMove);
        pointer.vx = clamp((pos.x - pointer.x) * 16.67 / dt, -14, 14);
        pointer.vy = clamp((pos.y - pointer.y) * 16.67 / dt, -14, 14);
      }
      pointer.x = pos.x;
      pointer.y = pos.y;
      pointer.active = true;
      pointer.lastMove = now;
    }

    function burstAll() { if (ready) setTime(getDisplayTime(), performance.now(), true); }

    function onPointerDown(e) {
      updatePointer(e);
      dragToggle.pointerId = e.pointerId;
      dragToggle.armed = true;
      dragToggle.active = false;
      dragToggle.moved = false;
      dragToggle.startX = pointer.x;
      dragToggle.startY = pointer.y;
      dragToggle.dx = 0;
      dragToggle.progress = 0;
      dragToggle.visual = 0;
      dragToggle.targetMode24 = null;
      canvas.setPointerCapture?.(e.pointerId);
    }

    function onPointerMove(e) {
      updatePointer(e);
      if (dragToggle.pointerId !== e.pointerId || !dragToggle.armed) return;
      const dx = pointer.x - dragToggle.startX;
      const dy = pointer.y - dragToggle.startY;
      if (!dragToggle.active) {
        if (dx > 10 && dx > Math.abs(dy) * 1.1) {
          dragToggle.active = true;
          dragToggle.moved = true;
        } else if (Math.abs(dy) > 12) {
          dragToggle.armed = false;
          return;
        }
      }
      if (dragToggle.active) updateDragProgress(dx);
      // Left swipes should not accidentally count as clicks or mode toggles.
      if (Math.abs(dx) > 12 || Math.abs(dy) > 12) dragToggle.moved = true;
    }

    function onPointerUp(e) {
      const now = performance.now();
      if (dragToggle.pointerId === e.pointerId) {
        if (dragToggle.active) {
          const shouldToggle = dragToggle.progress > 0.62 && dragToggle.targetMode24 !== null;
          const target = dragToggle.targetMode24;
          dragToggle.pointerId = null;
          dragToggle.armed = false;
          dragToggle.active = false;
          dragToggle.moved = false;
          dragToggle.dx = 0;
          if (shouldToggle) toggleHourMode(target, now);
          else {
            dragToggle.progress = 0;
            dragToggle.targetMode24 = null;
          }
        } else {
          const wasGesture = dragToggle.moved;
          dragToggle.pointerId = null;
          dragToggle.armed = false;
          dragToggle.active = false;
          dragToggle.moved = false;
          dragToggle.dx = 0;
          dragToggle.progress = 0;
          dragToggle.targetMode24 = null;
          if (!wasGesture) burstAll();
        }
      } else if (e.pointerType !== 'touch') {
        burstAll();
      }
      if (e.pointerType === 'touch') pointer.active = false;
      canvas.releasePointerCapture?.(e.pointerId);
    }

    function onPointerCancel(e) {
      if (dragToggle.pointerId === e.pointerId) {
        dragToggle.pointerId = null;
        dragToggle.armed = false;
        dragToggle.active = false;
        dragToggle.moved = false;
        dragToggle.dx = 0;
        dragToggle.progress = 0;
        dragToggle.targetMode24 = null;
      }
    }

    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerenter', updatePointer);
    canvas.addEventListener('pointerleave', () => { pointer.active = false; pointer.vx = 0; pointer.vy = 0; });
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('keydown', e => {
      if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); burstAll(); }
      if (e.code === 'KeyT') { e.preventDefault(); toggleHourMode(!use24Hour, performance.now()); }
    });
    let resizeId;
    window.addEventListener('resize', () => {
      clearTimeout(resizeId);
      resizeId = setTimeout(() => reset(false), 120);
    });

    reset(true);
    requestAnimationFrame(render);
  })();
