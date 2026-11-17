// All sound is synthesised with WebAudio — there are no audio files in the
// game. A looped noise buffer feeds the wind and the fire crackle; every
// action gets a short shaped burst so the player hears their tools land.

export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuffer = null;
  let windGain = null;
  let muted = false;
  let lastCrackle = 0;

  function unlock() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.55;
    master.connect(ctx.destination);

    // Two seconds of white noise, reused by every noise-based sound.
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    // The wind: looped noise through a bandpass, gain set by ambience().
    const wind = ctx.createBufferSource();
    wind.buffer = noiseBuffer;
    wind.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 480;
    band.Q.value = 0.6;
    windGain = ctx.createGain();
    windGain.gain.value = 0;
    wind.connect(band).connect(windGain).connect(master);
    wind.start();
  }

  function burst({ dur = 0.15, freq = 1000, type = 'bandpass', q = 1, gain = 0.2, sweepTo = null, when = 0 }) {
    if (!ctx || muted) return;
    const t0 = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t0);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(filter).connect(g).connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  function tone({ freq = 440, dur = 0.12, type = 'sine', gain = 0.12, when = 0, slideTo = null }) {
    if (!ctx || muted) return;
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  return {
    unlock,
    get muted() { return muted; },
    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.55;
      return muted;
    },
    // Called every frame or so: wind loudness follows the night's wind, and
    // a burning valley crackles — short random pops, denser with more fire.
    ambience(windSpeed, burning) {
      if (!ctx || muted) return;
      windGain.gain.setTargetAtTime(0.012 + windSpeed * 0.05, ctx.currentTime, 0.4);
      const now = performance.now();
      if (burning > 0 && now - lastCrackle > 90 && Math.random() < Math.min(0.85, burning / 60)) {
        lastCrackle = now;
        burst({ dur: 0.05 + Math.random() * 0.08, freq: 900 + Math.random() * 1600, gain: 0.05 + Math.random() * 0.06 });
      }
    },
    chop() { burst({ dur: 0.09, freq: 700, type: 'lowpass', gain: 0.25 }); tone({ freq: 140, dur: 0.07, type: 'triangle', gain: 0.1 }); },
    splash() { burst({ dur: 0.35, freq: 2400, sweepTo: 500, gain: 0.22 }); },
    backfire() { burst({ dur: 0.4, freq: 300, type: 'lowpass', sweepTo: 900, gain: 0.16 }); },
    ignite() { burst({ dur: 0.12, freq: 1500, gain: 0.07 }); },
    ember() { tone({ freq: 1900, dur: 0.09, type: 'sine', gain: 0.05, slideTo: 900 }); },
    alarm() { tone({ freq: 660, dur: 0.14, type: 'square', gain: 0.07 }); tone({ freq: 520, dur: 0.18, type: 'square', gain: 0.07, when: 0.16 }); },
    click() { tone({ freq: 840, dur: 0.05, type: 'sine', gain: 0.06 }); },
    veer() { burst({ dur: 0.8, freq: 500, sweepTo: 1100, gain: 0.14 }); },
    win() { [523, 659, 784, 1046].forEach((f, i) => tone({ freq: f, dur: 0.16, type: 'triangle', gain: 0.11, when: i * 0.11 })); },
    lose() { [392, 330, 262, 196].forEach((f, i) => tone({ freq: f, dur: 0.22, type: 'triangle', gain: 0.11, when: i * 0.15 })); },
  };
}
