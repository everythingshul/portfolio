/* Voice notes, WhatsApp style: record with the microphone, play back with a waveform.
 * Used by the chat (js/chat.js) and the contact form (js/main.js).
 * Recordings are converted to 16 kHz mono WAV so they play everywhere, including in the team's email.
 *   ESVoice.supported                    true when this browser can record
 *   ESVoice.recorderBar(host, opts)      starts recording into host: {onSend(clip), onCancel(), onError(msg), sendLabel}
 *   ESVoice.player({url, dur, peaks})    returns a playable voice-note element
 *   ESVoice.toBase64(blob)               base64 text of a recording, for uploading
 * A clip is {blob, mime, dur, peaks, url}. */
(() => {
  'use strict';
  const MAX = 60;          // seconds
  const MIN = 0.7;         // shorter than this is treated as an accidental tap
  const BARS = 36;
  const SUPPORTED = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);

  const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
  const fmt = (s) => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const ICON = {
    play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4.2" height="14" rx="1.2"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.2"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  };

  /* ------------------------------------------------------------------ conversion */
  const decode = (ctx, buf) => new Promise((res, rej) => { const p = ctx.decodeAudioData(buf, res, rej); if (p && p.catch) p.catch(rej); });

  // Recording -> 16 kHz mono 16-bit WAV, plus a small waveform summary for the player.
  async function toWav(blob) {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    try {
      const decoded = await decode(ctx, await blob.arrayBuffer());
      const rate = 16000;
      const off = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, Math.max(1, Math.ceil(decoded.duration * rate)), rate);
      const src = off.createBufferSource();
      src.buffer = decoded; src.connect(off.destination); src.start();
      const data = (await new Promise((res, rej) => { const p = off.startRendering(); if (p && p.then) p.then(res, rej); else off.oncomplete = (e) => res(e.renderedBuffer); })).getChannelData(0);
      const out = new DataView(new ArrayBuffer(44 + data.length * 2));
      const str = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
      str(0, 'RIFF'); out.setUint32(4, 36 + data.length * 2, true); str(8, 'WAVEfmt ');
      out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
      out.setUint32(24, rate, true); out.setUint32(28, rate * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true);
      str(36, 'data'); out.setUint32(40, data.length * 2, true);
      const per = Math.max(1, Math.floor(data.length / BARS));
      const peaks = [];
      for (let i = 0; i < data.length; i++) {
        out.setInt16(44 + i * 2, clamp(Math.round(data[i] * 32767), -32768, 32767), true);
        const b = Math.min(BARS - 1, Math.floor(i / per));
        peaks[b] = Math.max(peaks[b] || 0, Math.abs(data[i]));
      }
      const top = Math.max(0.05, ...peaks);
      return { blob: new Blob([out.buffer], { type: 'audio/wav' }), mime: 'audio/wav', dur: decoded.duration, peaks: Array.from({ length: BARS }, (_, i) => Math.round(clamp(Math.sqrt((peaks[i] || 0) / top), 0, 1) * 100)) };
    } finally { try { ctx.close(); } catch (e) { /* ignore */ } }
  }

  const pickMime = () => ['audio/mp4', 'audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm'].find((t) => { try { return MediaRecorder.isTypeSupported(t); } catch (e) { return false; } }) || '';

  /* ------------------------------------------------------------------ recorder */
  async function startRecorder(onLevel) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const mime = pickMime();
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const t0 = Date.now();
    const levels = [];
    let ctx = null, raf = 0, last = 0;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      const an = ctx.createAnalyser(); an.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.fftSize);
      const tick = (now) => {
        raf = requestAnimationFrame(tick);
        if (now - last < 70) return;
        last = now;
        an.getByteTimeDomainData(buf);
        let s = 0; for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; s += v * v; }
        const lv = clamp(Math.sqrt(s / buf.length) * 4, 0.04, 1);
        levels.push(lv);
        if (onLevel) onLevel(lv, (Date.now() - t0) / 1000);
      };
      raf = requestAnimationFrame(tick);
    } catch (e) { /* the waveform is only decoration */ }
    rec.start(250);

    const release = () => { cancelAnimationFrame(raf); stream.getTracks().forEach((t) => t.stop()); if (ctx) { try { ctx.close(); } catch (e) { /* ignore */ } } };
    return {
      elapsed: () => (Date.now() - t0) / 1000,
      cancel() { try { if (rec.state !== 'inactive') rec.stop(); } catch (e) { /* ignore */ } release(); },
      stop: () => new Promise((resolve) => {
        const dur = (Date.now() - t0) / 1000;
        rec.onstop = async () => {
          release();
          if (dur < MIN) return resolve(null);
          const raw = new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' });
          let clip;
          try { clip = await toWav(raw); } catch (e) {
            // Could not convert: keep the browser's own format.
            const per = Math.max(1, Math.floor(levels.length / BARS));
            clip = { blob: raw, mime: (raw.type || 'audio/webm').split(';')[0], dur, peaks: Array.from({ length: BARS }, (_, i) => Math.round(clamp(levels[Math.min(levels.length - 1, i * per)] || 0.2, 0, 1) * 100)) };
          }
          clip.dur = Math.min(MAX, Math.round(clip.dur * 10) / 10);
          clip.url = URL.createObjectURL(clip.blob);
          resolve(clip);
        };
        try { rec.stop(); } catch (e) { release(); resolve(null); }
      }),
    };
  }

  // The recording strip: [bin] ● 0:07 ~~~~~~ [send]. Recording starts as soon as it is created.
  function recorderBar(host, opts) {
    opts = opts || {};
    host.innerHTML =
      `<button type="button" class="vr-x" aria-label="Cancel recording">${ICON.trash}</button>` +
      '<span class="vr-dot" aria-hidden="true"></span><span class="vr-time" role="timer">0:00</span>' +
      `<div class="vr-wave" aria-hidden="true">${'<i></i>'.repeat(BARS)}</div>` +
      `<button type="button" class="vr-send" aria-label="${opts.sendLabel || 'Send voice note'}">${opts.done ? ICON.check : ICON.send}</button>`;
    const bars = [...host.querySelectorAll('.vr-wave i')];
    const time = host.querySelector('.vr-time');
    const send = host.querySelector('.vr-send');
    let ctl = null, closed = false, finishing = false;
    const shown = new Array(BARS).fill(0.06);
    const draw = () => bars.forEach((b, i) => { b.style.height = Math.round(10 + shown[i] * 90) + '%'; });
    draw();

    const finish = async () => {
      if (finishing || !ctl) return;
      finishing = true; send.disabled = true; host.classList.add('busy');
      const clip = await ctl.stop();
      closed = true;
      if (!clip) { if (opts.onCancel) opts.onCancel(true); return; }
      if (opts.onSend) opts.onSend(clip);
    };
    const abort = () => { if (closed) return; closed = true; if (ctl) ctl.cancel(); if (opts.onCancel) opts.onCancel(false); };

    host.querySelector('.vr-x').addEventListener('click', abort);
    send.addEventListener('click', finish);

    startRecorder((lv, t) => {
      shown.shift(); shown.push(lv); draw();
      time.textContent = fmt(t);
      if (t >= MAX && !finishing) finish();
    }).then((c) => {
      if (closed) { c.cancel(); return; }
      ctl = c; host.classList.add('live');
    }).catch((e) => {
      closed = true;
      const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      const none = e && (e.name === 'NotFoundError' || e.name === 'OverconstrainedError');
      if (opts.onError) opts.onError(denied ? 'Microphone access is blocked. Allow the microphone for this site in your browser settings and try again.' : none ? 'No microphone was found on this device.' : "Couldn't start the recording. Please try again, or type your message instead.");
    });
    return { cancel: abort };
  }

  /* ------------------------------------------------------------------ player */
  let playing = null;
  function player(v) {
    const dur = v.dur || 0;
    const peaks = Array.isArray(v.peaks) && v.peaks.length ? v.peaks : Array.from({ length: BARS }, (_, i) => 25 + Math.round(55 * Math.abs(Math.sin(i * 1.7 + dur))));
    const root = el('div', 'vp',
      `<button type="button" class="vp-btn" aria-label="Play voice note">${ICON.play}</button>` +
      `<div class="vp-wave" role="slider" aria-label="Voice note position" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" tabindex="0">${peaks.map((p) => `<i style="height:${Math.round(14 + clamp(p, 0, 100) * 0.86)}%"></i>`).join('')}</div>` +
      `<span class="vp-dur">${fmt(dur)}</span>`);
    const btn = root.querySelector('.vp-btn');
    const wave = root.querySelector('.vp-wave');
    const bars = [...wave.querySelectorAll('i')];
    const label = root.querySelector('.vp-dur');
    let audio = null;

    const paint = (ratio) => { const n = Math.round(ratio * bars.length); bars.forEach((b, i) => b.classList.toggle('on', i < n)); wave.setAttribute('aria-valuenow', String(Math.round(ratio * 100))); };
    const stop = () => { if (audio) audio.pause(); };
    const ensure = () => {
      if (audio) return audio;
      audio = new Audio(v.url);
      audio.preload = 'auto';
      audio.addEventListener('timeupdate', () => { const d = dur || audio.duration || 1; paint(clamp(audio.currentTime / d, 0, 1)); label.textContent = fmt(Math.max(0, d - audio.currentTime)); });
      audio.addEventListener('play', () => { if (playing && playing !== stop) playing(); playing = stop; btn.innerHTML = ICON.pause; btn.setAttribute('aria-label', 'Pause voice note'); });
      audio.addEventListener('pause', () => { btn.innerHTML = ICON.play; btn.setAttribute('aria-label', 'Play voice note'); if (playing === stop) playing = null; });
      audio.addEventListener('ended', () => { paint(0); label.textContent = fmt(dur); });
      audio.addEventListener('error', () => { label.textContent = "can't play"; });
      return audio;
    };
    btn.addEventListener('click', () => { const a = ensure(); if (a.paused) a.play().catch(() => { label.textContent = "can't play"; }); else a.pause(); });
    const seek = (ratio) => { const a = ensure(); const d = dur || a.duration; if (d && isFinite(d)) { a.currentTime = clamp(ratio, 0, 1) * d; paint(clamp(ratio, 0, 1)); } };
    wave.addEventListener('click', (e) => { const r = wave.getBoundingClientRect(); seek((e.clientX - r.left) / r.width); });
    wave.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { const a = ensure(); const d = dur || a.duration || 1; seek((a.currentTime + (e.key === 'ArrowRight' ? 5 : -5)) / d); e.preventDefault(); } });
    return root;
  }

  const toBase64 = (blob) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] || '');
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });

  window.ESVoice = { supported: SUPPORTED, MAX, fmt, recorderBar, player, toBase64, ICON };
})();
