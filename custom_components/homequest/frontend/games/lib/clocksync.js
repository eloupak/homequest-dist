/* Clock sync with the server: N pings, the offset is the median of the offsets of the fastest half (smallest round trips).
 * serverNow() = performance.now() + offset, in server milliseconds (the server's epoch clock). */

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

export class ClockSync {
  constructor(ping, now = () => performance.now()) {
    this.ping = ping;                 // async () => server epoch ms
    this.now = now;
    this.offset = 0;
    this.samples = [];                // {rtt, off}
    this.stats = { rtt_min: 0, rtt_med: 0, rtt_max: 0, n: 0 };
  }

  async sync(n = 9, gapMs = 60) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const t0 = this.now();
      let t;
      try {
        t = await this.ping();
      } catch (e) {
        continue;
      }
      const t1 = this.now();
      const rtt = t1 - t0;
      out.push({ rtt, off: t + rtt / 2 - t1 });
      if (gapMs) await new Promise((r) => setTimeout(r, gapMs));
    }
    this.samples = out;
    this._compute();
    return this.stats;
  }

  _compute() {
    const best = [...this.samples].sort((a, b) => a.rtt - b.rtt).slice(0, Math.max(1, Math.ceil(this.samples.length / 2)));
    if (best.length) this.offset = median(best.map((s) => s.off));
    const rtts = this.samples.map((s) => s.rtt);
    this.stats = { rtt_min: Math.min(...rtts, Infinity) === Infinity ? 0 : Math.min(...rtts), rtt_med: median(rtts), rtt_max: Math.max(0, ...rtts), n: rtts.length, offset: this.offset };
  }

  serverNow() {
    return this.now() + this.offset;
  }
}
