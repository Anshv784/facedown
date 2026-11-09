// Table sounds, synthesized with WebAudio so there are no files to load:
// a card flick for each dealt card, a chip clack for each bet, a two-note
// cue when it's your turn. Muted state is remembered per browser.

let ctx: AudioContext | null = null;
const KEY = "facedown.muted";

export function isMuted() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setMuted(m: boolean) {
  try {
    localStorage.setItem(KEY, m ? "1" : "0");
  } catch {
    /* private mode */
  }
}

function audio() {
  if (isMuted()) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function noiseBurst(a: AudioContext, at: number, dur: number, freq: number, gain: number) {
  const buf = a.createBuffer(1, Math.ceil(a.sampleRate * dur), a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 3;
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = freq;
  f.Q.value = 0.9;
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(a.destination);
  src.start(at);
}

export const sound = {
  deal(count = 1) {
    const a = audio();
    if (!a) return;
    for (let i = 0; i < count; i++) noiseBurst(a, a.currentTime + i * 0.09, 0.07, 3200, 0.35);
  },
  chips() {
    const a = audio();
    if (!a) return;
    [0, 0.045, 0.11].forEach((t, i) => noiseBurst(a, a.currentTime + t, 0.035, 5200 - i * 600, 0.25));
  },
  turn() {
    const a = audio();
    if (!a) return;
    [660, 880].forEach((hz, i) => {
      const o = a.createOscillator();
      const g = a.createGain();
      o.type = "sine";
      o.frequency.value = hz;
      const t = a.currentTime + i * 0.12;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.12, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.connect(g).connect(a.destination);
      o.start(t);
      o.stop(t + 0.4);
    });
  },
};
