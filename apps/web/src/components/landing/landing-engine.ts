import { type HeroRunKey, RUNS, SOURCE_SHORT, shortTx } from "./hero-runs";

/** Per-day company counts for the silent-gap strip, served from public/. */
const GAP_URL = "/gap-field.json";

type Done = "x" | "hold" | "next";
type Attrs = Record<string, string | number>;
type TextSlot = { textContent: string | null };

interface Layout {
  mob: boolean;
  W: number;
  H: number;
  hx: number;
  hy: number;
  R: number;
  RX: number;
  sy: number;
  tsize: number;
  decY: number;
  src: { x: number; y: number; side: "l" | "r" | "ml" | "mr"; lab?: "a" | "b" }[];
}

interface SourceNode {
  g: SVGGElement;
  w: SVGPathElement;
  nm: SVGTextElement;
  pr: SVGTextElement;
  oc: TextSlot;
  x: number;
  y: number;
}

interface Drawing {
  gD: SVGGElement;
  dorb: SVGGElement;
  rw: SVGPathElement;
  rg: SVGGElement;
  pend: SVGCircleElement;
  rs: SVGTextElement;
  hc: SVGCircleElement;
  discs: SVGCircleElement[];
}

/**
 * Runs the landing page: the hero replay, the reveal on scroll, the silent-gap strip, the watch card
 * and the code tabs. Call once the markup is mounted; the returned function stops every frame,
 * timer, observer and listener it started.
 */
export function startLanding(root: HTMLElement): () => void {
  let stopped = false;
  const offs: (() => void)[] = [];
  const timers = new Set<number>();
  const later = (fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timers.delete(id);
      if (!stopped) fn();
    }, ms);
    timers.add(id);
    return id;
  };
  const cancel = (id: number | undefined) => {
    if (id === undefined) return;
    clearTimeout(id);
    timers.delete(id);
  };
  const on = (target: Window | Document | Element, type: string, fn: (e: Event) => void, opts?: AddEventListenerOptions) => {
    target.addEventListener(type, fn, opts);
    offs.push(() => target.removeEventListener(type, fn, opts));
  };
  const $ = <T extends Element = HTMLElement>(id: string): T => {
    const el = root.querySelector<T>(`#${id}`);
    if (!el) throw new Error(`landing: #${id} is missing`);
    return el;
  };

  root.classList.add("js");

  /* ================= the hero object ================= */
  const Q = new URLSearchParams(location.search);
  const KEY = Q.get("state");
  const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const HOLD = KEY === "kd" || KEY === "danone";
  let gen = 0;
  let INSTANT = RM || HOLD;
  const EASE = "cubic-bezier(.16,1,.3,1)";
  function bez(x1: number, y1: number, x2: number, y2: number) {
    return (t: number) => {
      if (t <= 0) return 0;
      if (t >= 1) return 1;
      let s = t;
      for (let i = 0; i < 8; i++) {
        const x = ((1 - 3 * x2 + 3 * x1) * s + (3 * x2 - 6 * x1)) * s * s + 3 * x1 * s - t;
        const dx = 3 * (1 - 3 * x2 + 3 * x1) * s * s + 2 * (3 * x2 - 6 * x1) * s + 3 * x1;
        if (Math.abs(dx) < 1e-6) break;
        s = Math.min(1, Math.max(0, s - x / dx));
      }
      return ((1 - 3 * y2 + 3 * y1) * s + (3 * y2 - 6 * y1)) * s * s + 3 * y1 * s;
    };
  }
  const OUT = bez(0.16, 1, 0.3, 1);
  const INOUT = bez(0.6, 0, 0.3, 1);
  function tween(d: number, fn: (t: number) => void, ease = INOUT) {
    return new Promise<void>((res) => {
      const g = gen;
      if (INSTANT) {
        fn(1);
        res();
        return;
      }
      const t0 = performance.now();
      const f = (now: number) => {
        if (g !== gen) return;
        const t = Math.min(1, (now - t0) / d);
        fn(ease(t));
        if (t < 1) requestAnimationFrame(f);
        else res();
      };
      requestAnimationFrame(f);
    });
  }
  function wait(ms: number) {
    return new Promise<void>((res) => {
      const g = gen;
      if (INSTANT) {
        res();
        return;
      }
      later(() => {
        if (g === gen) res();
      }, ms);
    });
  }
  function anim(el: Element | null, kf: Keyframe[], d: number) {
    if (!el) return Promise.resolve();
    if (INSTANT || !el.animate) {
      Object.assign((el as HTMLElement).style, kf[kf.length - 1]);
      return Promise.resolve();
    }
    return el
      .animate(kf, { duration: d, easing: EASE, fill: "forwards" })
      .finished.then(() => undefined)
      .catch(() => undefined);
  }

  const NS = "http://www.w3.org/2000/svg";
  const svg = $<SVGSVGElement>("svg");
  const stage = $("stage");
  const hub = $("hub");
  const hterm = $("hterm");
  const dec = $("dec");
  function E<K extends keyof SVGElementTagNameMap>(t: K, a: Attrs, p?: Element): SVGElementTagNameMap[K] {
    const e = document.createElementNS(NS, t);
    for (const k in a) e.setAttribute(k, String(a[k]));
    (p || svg).appendChild(e);
    return e;
  }
  function T(s: string, a: Attrs, p?: Element) {
    const e = E("text", a, p);
    e.textContent = s;
    return e;
  }
  const fmt = (v: number) => "$" + (Math.round(v * 1000) % 10 ? v.toFixed(3) : v.toFixed(2));
  const f3 = (v: number) => "$" + v.toFixed(3);

  // odometer: only the digits that change roll
  function roll(el: HTMLElement, str: string, animate: boolean) {
    const slots = [...el.children];
    if (slots.length !== str.length || !animate || INSTANT) {
      el.innerHTML = "";
      for (const ch of str) {
        const s = document.createElement("span");
        s.className = "d1";
        const i = document.createElement("span");
        i.textContent = ch;
        s.appendChild(i);
        el.appendChild(s);
      }
      return;
    }
    slots.forEach((s, k) => {
      const old = s.lastElementChild;
      if (!old || old.textContent === str[k]) return;
      const nw = document.createElement("span");
      nw.textContent = str[k];
      s.appendChild(nw);
      old.animate(
        [
          { transform: "translateY(0)", opacity: 1 },
          { transform: "translateY(-100%)", opacity: 0 },
        ],
        { duration: 460, easing: EASE, fill: "forwards" },
      ).onfinish = () => old.remove();
      nw.animate(
        [
          { transform: "translateY(100%)", opacity: 0 },
          { transform: "translateY(0)", opacity: 1 },
        ],
        { duration: 460, easing: EASE, fill: "forwards" },
      );
    });
  }

  let L: Layout;
  let S: SourceNode[] = [];
  let D: Drawing | null = null;
  const hard = new WeakSet<SVGCircleElement>();

  function layout(): Layout {
    const W = stage.clientWidth;
    const H = stage.clientHeight;
    const mob = W < 700;
    if (!mob) {
      const sy = 18;
      // the hub grows a little once the stage is taller than the compact band
      const R = Math.round(Math.min(104, Math.min(88, Math.max(66, H * 0.215)) + Math.max(0, (H - 420) * 0.1)));
      const hy = Math.round(Math.max(sy + 60 + R, H * 0.44));
      const hx = Math.round(W / 2);
      const RX = Math.round(Math.min(W * 0.335, 470));
      const rows = [Math.round(H * 0.22), hy + 2, Math.round(H * 0.8)];
      const src: Layout["src"] = [
        { x: hx - RX * 0.84, y: rows[0], side: "l" },
        { x: hx - RX, y: rows[1], side: "l" },
        { x: hx - RX * 0.84, y: rows[2], side: "l" },
        { x: hx + RX * 0.84, y: rows[0], side: "r" },
        { x: hx + RX, y: rows[1], side: "r" },
        { x: hx + RX * 0.84, y: rows[2], side: "r" },
      ];
      return { mob, W, H, hx, hy, R, RX, src, sy, tsize: Math.round(R * 0.44), decY: hy + R + 18 };
    }
    const sy = 30;
    const R = 56;
    const hx = Math.round(W / 2);
    const hy = sy + 52 + R;
    const rows = [hy - 68, hy + 2, hy + 80];
    const xl = 22;
    const xr = W - 22;
    const src: Layout["src"] = [
      { x: xl, y: rows[0], side: "ml", lab: "a" },
      { x: xl, y: rows[1], side: "ml", lab: "a" },
      { x: xl, y: rows[2], side: "ml", lab: "b" },
      { x: xr, y: rows[0], side: "mr", lab: "a" },
      { x: xr, y: rows[1], side: "mr", lab: "a" },
      { x: xr, y: rows[2], side: "mr", lab: "b" },
    ];
    return { mob, W, H, hx, hy, R, RX: hx - xl, src, sy, tsize: 25, decY: rows[2] + 52 };
  }

  function build() {
    L = layout();
    const { W, H, hx, hy, R } = L;
    svg.innerHTML = "";
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    stage.style.setProperty("--hx", hx + "px");
    stage.style.setProperty("--hy", hy + "px");
    hub.style.width = hub.style.height = 2 * R + "px";
    hterm.style.fontSize = L.tsize + "px";
    hterm.style.height = Math.round(L.tsize * 1.12) + "px";
    dec.style.top = L.decY + "px";
    const defs = E("defs", {});
    const lg = E("linearGradient", { id: "fadeX", x1: 0, x2: 1, y1: 0, y2: 0 }, defs);
    (
      [
        [0, 0],
        [0.18, 1],
        [0.82, 1],
        [1, 0],
      ] as const
    ).forEach(([o, a]) => E("stop", { offset: o, "stop-color": "#fff", "stop-opacity": a }, lg));
    const mk = E("mask", { id: "fade", maskUnits: "userSpaceOnUse", x: 0, y: 0, width: W, height: H }, defs);
    E("rect", { x: 0, y: 0, width: W, height: H, fill: "url(#fadeX)" }, mk);
    const gB = E("g", { mask: "url(#fade)" });
    const gW = E("g", {});
    const gS = E("g", {});
    const gH = E("g", {});
    const gD = E("g", {});
    // instrument plane: faint ellipses through the sources
    if (!L.mob) {
      const ryMax = Math.max(L.src[2].y - hy, hy - L.src[0].y);
      (
        [
          [0.5, 0.62, 1],
          [0.78, 0.84, 0],
          [1.06, 1.08, 1],
        ] as const
      ).forEach(([kx, ky, d]) =>
        E(
          "ellipse",
          { class: "orb" + (d ? " d" : ""), cx: hx, cy: hy, rx: Math.max(R + 40, L.RX * kx), ry: Math.max(R + 26, ryMax * ky) },
          gB,
        ),
      );
    } else {
      [R * 1.7, R * 2.6].forEach((r, i) => E("circle", { class: "orb" + (i ? " d" : ""), cx: hx, cy: hy, r }, gB));
    }
    S = [];
    L.src.forEach((s, i) => {
      const dx = s.x - hx;
      const dy = s.y - hy;
      const len = Math.hypot(dx, dy);
      const ux = dx / len;
      const uy = dy / len;
      const x0 = hx + ux * (R + 18);
      const y0 = hy + uy * (R + 18);
      const x1 = s.x - ux * 12;
      const y1 = s.y - uy * 12;
      const sgn = s.side === "r" || s.side === "mr" ? -1 : 1;
      const mx = (x0 + x1) / 2 - uy * len * 0.06 * sgn;
      const my = (y0 + y1) / 2 + ux * len * 0.06 * sgn;
      const w = E("path", { class: "spk", d: `M${x0} ${y0}Q${mx} ${my} ${x1} ${y1}` }, gW);
      const g = E(
        "g",
        { class: "src", transform: `translate(${s.x} ${s.y})`, tabindex: 0, role: "button", "aria-label": "receipt", "data-i": i },
        gS,
      );
      E("circle", { class: "hit", r: 24 }, g);
      E("circle", { class: "s-r2", r: 10 }, g);
      E("circle", { class: "s-r1", r: 5.5 }, g);
      let anc = "middle";
      let tx = 0;
      const ty = -6;
      let nm: SVGTextElement;
      let pr: SVGTextElement;
      let oc: TextSlot;
      if (s.side === "l") {
        anc = "end";
        tx = -20;
      } else if (s.side === "r") {
        anc = "start";
        tx = 20;
      }
      if (L.mob) {
        anc = s.side === "ml" ? "start" : "end";
        tx = s.side === "ml" ? -10 : 10;
        const base = s.lab === "a" ? -34 : 28;
        nm = T("", { class: "s-name", "text-anchor": anc, x: tx, y: base, "font-size": 12 }, g);
        pr = T("", { class: "s-price", "text-anchor": anc, x: tx, y: base + 14, "font-size": 11 }, g);
        oc = { textContent: "" };
      } else {
        nm = T("", { class: "s-name", "text-anchor": anc, x: tx, y: ty }, g);
        pr = T("", { class: "s-price", "text-anchor": anc, x: tx, y: ty + 16 }, g);
        oc = T("", { class: "s-out", "text-anchor": anc, x: tx, y: ty + 30 }, g);
      }
      S.push({ g, w, nm, pr, oc, x: s.x, y: s.y });
      g.addEventListener("mouseenter", () => showR(i));
      g.addEventListener("mouseleave", hideR);
      g.addEventListener("focus", () => showR(i));
      g.addEventListener("blur", hideR);
      g.addEventListener("click", (e) => {
        e.stopPropagation();
        showR(i);
      });
    });
    // the independent review: a satellite on its own rail
    const rx = hx;
    const ry = L.sy;
    const rw = E("path", { class: "spk rev", d: `M${hx} ${hy - R - 14}L${rx} ${ry + 12}` }, gW);
    const rg = E("g", { class: "rv", transform: `translate(${rx} ${ry})` }, gH);
    E("circle", { class: "rv-r2", r: 9 }, rg);
    E("circle", { class: "rv-r1", r: 5 }, rg);
    const pend = E("circle", { class: "pend", r: 14 }, rg);
    const tx = 20;
    if (L.mob) T("independent review", { class: "rv-name", x: -6, y: -17, "text-anchor": "end", "font-size": 11.5 }, rg);
    else T("independent review", { class: "rv-name", x: tx, y: -1 }, rg);
    const rs = L.mob
      ? T("Reppo panel", { class: "rv-st", x: 6, y: -17, "font-size": 10.5 }, rg)
      : T("Reppo panel", { class: "rv-st", x: tx, y: 13 }, rg);
    // the hub: the client; terms form here
    E("circle", { class: "orb d", cx: hx, cy: hy, r: R + 14 }, gH);
    const hc = E("circle", { class: "hub-c", cx: hx, cy: hy, r: R }, gH);
    E("circle", { class: "hub-i", cx: hx, cy: hy, r: R - 7 }, gH);
    const dorb = E("g", {}, gD);
    D = { gD, dorb, rw, rg, pend, rs, hc, discs: [] };
  }

  /* ---------- state ---------- */
  let RUN: HeroRunKey = "kd";
  let rot = 0;
  function narr(a?: string, b?: string) {
    $("l1").innerHTML = a || "";
    $("l2").innerHTML = b || "";
  }
  function setRequested() {
    hterm.innerHTML =
      '<span class="t-old" id="told"><span class="t-in">Net 30<i class="strike"></i><i class="under"></i></span></span>';
  }
  function reset(R: (typeof RUNS)[HeroRunKey], d: Drawing) {
    S.forEach((s, i) => {
      const src = R.src[i];
      s.g.setAttribute("class", "src" + (src.st === "skipped" ? " dim" : ""));
      s.w.setAttribute("class", "spk" + (src.st === "skipped" ? " dim" : ""));
      s.nm.textContent = L.mob ? SOURCE_SHORT[i] : src.name;
      s.pr.textContent = fmt(src.usd) + (L.mob && src.st === "skipped" ? " · skipped" : "");
      if (!L.mob) s.oc.textContent = src.st === "skipped" ? "not planned" : "";
      s.w.style.opacity = "0";
      s.g.style.opacity = ".32";
    });
    d.gD.querySelectorAll(".tmp").forEach((e) => e.remove());
    d.discs = [];
    d.dorb.innerHTML = "";
    d.dorb.setAttribute("opacity", "1");
    d.hc.setAttribute("class", "hub-c");
    $("hname").textContent = L.mob && R.name.length > 14 ? "KD SOCCER" : R.name;
    setRequested();
    hterm.style.opacity = "1";
    roll($("spent"), f3(0), false);
    $("budget").textContent = fmt(R.budget);
    narr(`Requested <b>Net 30</b> on a ${R.amount} invoice`, "freelancer policy · v1");
    d.rw.setAttribute("class", "spk rev");
    d.rg.setAttribute("class", "rv");
    d.pend.classList.remove("on");
    d.rs.textContent = "Reppo panel";
  }
  function setDot(c: SVGCircleElement, p: [number, number]) {
    c.setAttribute("cx", String(p[0]));
    c.setAttribute("cy", String(p[1]));
  }
  function at(path: SVGPathElement, len: number, t: number): [number, number] {
    const p = path.getPointAtLength(len * t);
    return [p.x, p.y];
  }
  function tag(d: Drawing, txt: string) {
    const g = E("g", { class: "tag tmp" }, d.gD);
    const t = T(txt, { y: 3.8, "text-anchor": "middle" }, g);
    const w = t.getComputedTextLength() + 12;
    g.insertBefore(E("rect", { x: -w / 2, y: -8.5, width: w, height: 17, rx: 8.5 }, g), t);
    return g;
  }
  function orbitSlot(k: number, n: number): [number, number] {
    const a = -Math.PI / 2 + 0.35 + k * ((2 * Math.PI) / Math.max(n, 1));
    return [L.hx + Math.cos(a) * (L.R + 14), L.hy + Math.sin(a) * (L.R + 14)];
  }

  async function play(key: HeroRunKey): Promise<Done> {
    const g = ++gen;
    const d = D;
    if (!d) return "x";
    RUN = key;
    for (const b of root.querySelectorAll<HTMLButtonElement>(".tab")) b.setAttribute("aria-selected", String(b.dataset.run === key));
    const R = RUNS[key];
    reset(R, d);
    syncTabs();
    hideR();
    const live = () => g === gen;
    await wait(500);
    if (!live()) return "x";
    const planned = R.src.filter((s) => s.st !== "skipped").length;
    narr(
      `<span class="st">plan</span>${planned} lookups for a ${R.amount} invoice, budget ${fmt(R.budget)}`,
      `vendor's credit limit ($0.12) not planned`,
    );
    await tween(
      750,
      (t) =>
        S.forEach((s, i) => {
          s.w.style.opacity = String(t);
          s.g.style.opacity = String(R.src[i].st === "skipped" ? 0.32 + 0.13 * t : 0.32 + 0.68 * t);
        }),
      OUT,
    );
    if (!live()) return "x";
    // money out: a price tag rides each planned spoke to its source; facts come back as discs
    let spent = 0;
    const total = R.src.reduce((a, s) => a + s.facts.length, 0);
    let k = 0;
    const jobs = R.src
      .map((s, i) => [s, i] as const)
      .filter(([s]) => s.st !== "skipped")
      .map(([src, i], n) =>
        (async () => {
          await wait(n * 260);
          const s = S[i];
          const len = s.w.getTotalLength();
          const tg = tag(d, fmt(src.usd));
          await tween(1100, (t) => {
            const p = at(s.w, len, t);
            tg.setAttribute("transform", `translate(${p[0]} ${p[1]})`);
          });
          tg.remove();
          if (src.st === "failed") {
            s.g.classList.add("fail");
            s.w.setAttribute("class", "spk fail");
            if (L.mob) s.nm.textContent = SOURCE_SHORT[i] + " · 404";
            else s.oc.textContent = src.code ?? "";
            narr(`<span class="st">buy</span>${src.name} · 404 · not billed`, "a non-2xx answer is never settled");
            return;
          }
          s.g.classList.add("paid");
          s.w.setAttribute("class", "spk paid");
          spent = +(spent + src.usd).toFixed(3);
          roll($("spent"), f3(spent), true);
          narr(
            `<span class="st">buy</span>${src.name} · ${fmt(src.usd)}${src.tx ? ` · tx ${shortTx(src.tx)}` : ""}`,
            "paid through Kite Agent Passport, capped at $0.20 a lookup",
          );
          if (!L.mob) s.oc.textContent = `${src.facts.length} fact${src.facts.length === 1 ? "" : "s"}`;

          await Promise.all(
            src.facts.map((_, j) =>
              (async () => {
                await wait(j * 110);
                const isHard = src.hard === j;
                const c = E("circle", { class: "disc tmp" + (isHard ? " hard" : ""), r: 2.8 }, d.gD);
                await tween(900, (t) => setDot(c, at(s.w, len, 1 - t)));
                const slot = orbitSlot(k++, total);
                const from = [+(c.getAttribute("cx") ?? 0), +(c.getAttribute("cy") ?? 0)];
                await tween(
                  420,
                  (t) => setDot(c, [from[0] + (slot[0] - from[0]) * t, from[1] + (slot[1] - from[1]) * t]),
                  OUT,
                );
                c.remove();
                // place in the rotating orbit group, un-rotated into its frame
                const a = (-rot * 57.3 * Math.PI) / 180;
                const px = slot[0] - L.hx;
                const py = slot[1] - L.hy;
                const cc = E(
                  "circle",
                  {
                    class: "disc" + (isHard ? " hard" : ""),
                    r: isHard ? 3.6 : 2.8,
                    cx: L.hx + px * Math.cos(a) - py * Math.sin(a),
                    cy: L.hy + px * Math.sin(a) + py * Math.cos(a),
                  },
                  d.dorb,
                );
                if (isHard) hard.add(cc);
                d.discs.push(cc);
              })(),
            ),
          );
        })(),
      );
    await Promise.all(jobs);
    if (!live()) return "x";
    narr(`<span class="st">extract</span>${total} facts, each with the date it became public`, "");
    await wait(650);
    if (!live()) return "x";
    const told = root.querySelector<HTMLElement>("#told");
    if (!told) return "x";
    if (R.floor) {
      // floors: the hard fact strikes the requested terms; the real terms slide up
      narr(`<span class="st">floors</span>open liquidation`, "a hard rule under every policy");
      const hd = d.discs.find((c) => hard.has(c));
      if (hd) {
        const cx = +(hd.getAttribute("cx") ?? 0);
        const cy = +(hd.getAttribute("cy") ?? 0);
        const rp = E("circle", { class: "ripple", cx, cy, r: 4 }, d.dorb);
        tween(
          900,
          (t) => {
            rp.setAttribute("r", String(4 + 14 * t));
            rp.setAttribute("opacity", String(1 - t));
          },
          OUT,
        ).then(() => rp.remove());
      }
      told.classList.add("firm");
      await anim(told.querySelector(".strike"), [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], 480);
      if (!live()) return "x";
      await wait(320);
      if (!live()) return "x";
      d.hc.setAttribute("class", "hub-c set");
    } else {
      narr(`<span class="st">floors</span>none`, "");
      await wait(500);
      if (!live()) return "x";
      narr(`<span class="st">decide</span>your policy, compiled by SERV into rules`, `${R.decideNote} · ${R.decideMs} ms`);
      await wait(450);
      if (!live()) return "x";
      d.hc.setAttribute("class", "hub-c set");
    }
    const nw = document.createElement("span");
    nw.className = "t-new";
    nw.innerHTML = `<span class="t-in">${R.terms}${R.floor ? "" : '<i class="under"></i>'}</span>`;
    hterm.appendChild(nw);
    if (INSTANT) {
      told.remove();
    } else {
      nw.style.opacity = "0";
      told.animate(
        [
          { transform: "translateY(0)", opacity: 1 },
          { transform: "translateY(-80%)", opacity: 0 },
        ],
        { duration: 620, easing: EASE, fill: "forwards" },
      );
      await anim(
        nw,
        [
          { transform: "translateY(85%)", opacity: 0 },
          { transform: "translateY(0)", opacity: 1 },
        ],
        720,
      );
      if (!live()) return "x";
      told.remove();
    }
    if (!R.floor) {
      const u = nw.querySelector(".under");
      if (u) await anim(u, [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], 480);
      if (!live()) return "x";
    }
    narr(R.l1, R.l2);
    await wait(700);
    if (!live()) return "x";
    // the independent second check: a packet rides out to the review satellite
    d.rw.setAttribute("class", "spk rev on");
    const pk = E("rect", { class: "tmp", width: 6, height: 6, x: -3, y: -3, fill: "#ff4d8d" }, d.gD);
    const rl = d.rw.getTotalLength();
    await tween(900, (t) => {
      const p = at(d.rw, rl, t);
      pk.setAttribute("transform", `translate(${p[0]} ${p[1]})`);
    });
    if (!live()) return "x";
    pk.remove();
    d.rg.setAttribute("class", "rv on");
    d.pend.classList.add("on");
    d.rs.textContent = "Reppo panel · reviewing";
    const verdict = `Reppo · ${R.review.score}/100 · ${R.review.route === "ship" ? "ship" : "to a person"}`;
    if (HOLD || RM) {
      d.pend.classList.remove("on");
      d.rs.textContent = verdict;
      return "hold";
    }
    await wait(1500);
    if (!live()) return "x";
    d.pend.classList.remove("on");
    d.rs.textContent = verdict;
    await wait(4400);
    if (!live()) return "x";
    await tween(600, (t) => {
      d.dorb.setAttribute("opacity", String(1 - t));
      hterm.style.opacity = String(1 - t);
    });
    return "next";
  }
  async function loop(k: HeroRunKey) {
    for (;;) {
      const r = await play(k);
      if (r !== "next" || stopped) return;
      k = k === "kd" ? "danone" : "kd";
    }
  }

  /* idle: the facts drift slowly round the client */
  let lastT = 0;
  let spinRaf = 0;
  const spin = (now: number) => {
    if (stopped) return;
    if (!RM && D && !document.hidden) {
      const dt = lastT ? Math.min(50, now - lastT) : 16;
      rot += 0.000055 * dt;
      D.dorb.setAttribute("transform", `rotate(${rot * 57.3} ${L.hx} ${L.hy})`);
    }
    lastT = now;
    spinRaf = requestAnimationFrame(spin);
  };
  spinRaf = requestAnimationFrame(spin);

  /* tabs */
  const tabs = [...root.querySelectorAll<HTMLButtonElement>(".tab")];
  function syncTabs() {
    tabs.forEach((b) => b.setAttribute("aria-selected", String(b.dataset.run === RUN)));
  }
  tabs.forEach((b) =>
    on(b, "click", () => {
      INSTANT = RM;
      const run = b.dataset.run;
      if (run === "kd" || run === "danone") void loop(run);
    }),
  );

  /* signature: hover a source for its receipt */
  const rc = $("rcpt");
  function showR(i: number) {
    const R = RUNS[RUN];
    const d = R.src[i];
    const s = S[i];
    if (!d || !s) return;
    const st =
      d.st === "skipped" ? "not planned for this check" : d.st === "failed" ? "404 · not billed" : `settled · ${fmt(d.usd)} USDC on Base`;
    const rows: [string, string][] = [
      ["source", d.url || "not called"],
      ["status", st],
    ];
    if (d.st === "settled") {
      if (d.tx) rows.push(["tx", `${shortTx(d.tx)} on Base`]);
      rows.push(["facts", d.facts.length ? d.facts.join(" · ") : "0 facts"]);
    }
    rc.innerHTML = `<div class="h"><b>${d.name}</b><span>${fmt(d.usd)}</span></div><dl>${rows
      .map((r) => `<dt>${r[0]}</dt><dd>${r[1]}</dd>`)
      .join("")}</dl>`;
    const sw = rc.offsetWidth;
    const sh = rc.offsetHeight;
    let x = s.x + (s.x < L.hx ? 24 : -sw - 24);
    let y = s.y - sh / 2;
    if (L.mob) {
      x = (L.W - sw) / 2;
      y = s.y + 30;
    }
    x = Math.max(8, Math.min(L.W - sw - 8, x));
    y = Math.max(0, Math.min(L.H - sh, y));
    rc.style.left = x + "px";
    rc.style.top = y + "px";
    rc.classList.add("on");
  }
  function hideR() {
    rc.classList.remove("on");
  }
  on(document, "click", hideR);

  let lastW = 0;
  function start() {
    if (stopped) return;
    build();
    lastW = stage.clientWidth;
    void loop(KEY === "danone" ? "danone" : "kd");
  }
  let rt: number | undefined;
  on(window, "resize", () => {
    cancel(rt);
    rt = later(() => {
      if (Math.abs(stage.clientWidth - lastW) < 4 && Math.abs(stage.clientHeight - L.H) < 4) return;
      gen++;
      start();
    }, 200);
  });
  const fontsReady = document.fonts ? document.fonts.ready : Promise.resolve();
  void Promise.race([fontsReady, new Promise<void>((r) => later(r, 1500))]).then(start);

  /* ================= below the fold ================= */
  // reveal on scroll, with a failsafe so nothing stays hidden
  const revs = [...root.querySelectorAll<HTMLElement>(".reveal")];
  const onIn = new Map<Element, () => void>();
  function show(el: Element) {
    if (el.classList.contains("in")) return;
    el.classList.add("in");
    const f = onIn.get(el);
    if (f) {
      onIn.delete(el);
      f();
    }
  }
  let io: IntersectionObserver | null = null;

  // the silent gap: one dot per company, placed by days from "stopped paying" to the gazette notice
  const DMAX = 620;
  const KD_DAYS = 565;
  const CAP_DAY = 557;
  const cv = $<HTMLCanvasElement>("gapc");
  const strip = $("strip");
  const MEDIAN = Number(strip.dataset.median) || 0;
  let hist: number[] | null = null;
  const ac = new AbortController();
  const histReady: Promise<number[] | null> = fetch(GAP_URL, { signal: ac.signal })
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { counts?: unknown } | null) => {
      hist = Array.isArray(j?.counts) ? (j.counts as number[]) : null;
      return hist;
    })
    .catch(() => null);
  let dots: [number, number, number][] | null = null;
  let drawn = 0;
  let raf = 0;
  function rng(a: number) {
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function prepDots(h: number[]) {
    const r = rng(7);
    const arr: [number, number, number][] = [];
    h.forEach((c, day) => {
      for (let j = 0; j < c; j++) {
        const u = (r() + r() + r()) / 3;
        arr.push([day + r(), u, day]);
      }
    });
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  function xOf(day: number, w: number) {
    const main = w * 0.955;
    return day <= DMAX ? (day / DMAX) * main : main + 6 + Math.min(1, (day - DMAX) / (1105 - DMAX)) * (w - main - 8);
  }
  function sizeStrip() {
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    const dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    const c = cv.getContext("2d");
    c?.setTransform(dpr, 0, 0, dpr, 0, 0);
    $("mk-med").style.left = xOf(MEDIAN, w) + "px";
    const cx = xOf(CAP_DAY, w);
    const cap = $("mk-cap");
    cap.classList.add("end");
    cap.style.left = "auto";
    cap.style.right = w - cx - 1 + "px";
    const kx = xOf(KD_DAYS, w);
    $("mk-kd").style.right = w - kx - 1 + "px";
    $("mk-tail").textContent = "";
    return { c, w, h };
  }
  function paint(upTo: number) {
    const { c, w, h } = sizeStrip();
    if (!c || !dots) return;
    c.clearRect(0, 0, w, h);
    c.fillStyle = "rgba(255,77,141,.2)";
    for (let i = 0; i < upTo; i++) {
      const d = dots[i];
      const x = xOf(d[0], w);
      const y = 4 + d[1] * (h - 8);
      c.fillRect(x, y, 1.3, 1.3);
    }
    if (upTo >= dots.length) {
      // KD SOCCER CONSULTING: 565 days
      const x = xOf(KD_DAYS, w);
      const y = h * 0.5;
      c.fillStyle = "#f2f0ec";
      c.beginPath();
      c.arc(x, y, 2.6, 0, 7);
      c.fill();
      c.strokeStyle = "rgba(242,240,236,.6)";
      c.lineWidth = 1;
      c.beginPath();
      c.arc(x, y, 6, 0, 7);
      c.stroke();
    }
  }
  function grow(h: number[]) {
    dots = dots || prepDots(h);
    const all = dots.length;
    if (RM) {
      paint(all);
      return;
    }
    const t0 = performance.now();
    const dur = 1600;
    cancelAnimationFrame(raf);
    const f = (now: number) => {
      if (stopped) return;
      const t = Math.min(1, (now - t0) / dur);
      drawn = Math.round(OUT(t) * all);
      paint(drawn);
      if (t < 1) raf = requestAnimationFrame(f);
    };
    raf = requestAnimationFrame(f);
  }
  function growStrip() {
    sizeStrip();
    if (hist) grow(hist);
    else
      void histReady.then((h) => {
        if (!stopped && h) grow(h);
      });
  }
  onIn.set(strip, growStrip);
  on(window, "resize", () => {
    if (dots && strip.classList.contains("in")) paint(drawn || dots.length);
  });

  // keeps watching: the quiet rows tick in, then one turns
  const wc = $("wcard");
  function daysLeft() {
    const d = Math.ceil((new Date(2027, 0, 12).getTime() - new Date(new Date().toDateString()).getTime()) / 864e5);
    return d > 0 ? `${d} days left` : "deadline passed";
  }
  $("left").textContent = daysLeft();
  onIn.set(wc, () => {
    const rows = [...wc.querySelectorAll<HTMLElement>(".wr")];
    if (RM) {
      wc.classList.remove("pre");
      return;
    }
    rows.forEach((r) => {
      r.style.opacity = "0";
      r.style.transform = "translateY(6px)";
    });
    wc.classList.remove("pre");
    const cl = wc.querySelector<HTMLElement>(".claim");
    if (cl) cl.style.opacity = "0";
    rows.forEach((r, i) =>
      later(() => {
        r.style.opacity = "";
        r.style.transform = "";
      }, 250 + i * 380),
    );
    later(() => {
      if (cl) cl.style.opacity = "";
    }, 250 + rows.length * 380 + 250);
  });
  // already revealed (the markup outlived a previous run): settle without replaying
  if (strip.classList.contains("in")) {
    onIn.delete(strip);
    growStrip();
  }
  if (wc.classList.contains("in")) {
    onIn.delete(wc);
    wc.classList.remove("pre");
    wc.querySelectorAll<HTMLElement>(".wr, .claim").forEach((el) => {
      el.style.opacity = "";
      el.style.transform = "";
    });
  }

  if (RM || !("IntersectionObserver" in window)) {
    revs.forEach(show);
  } else {
    io = new IntersectionObserver(
      (es) =>
        es.forEach((e) => {
          if (e.isIntersecting) {
            show(e.target);
            io?.unobserve(e.target);
          }
        }),
      { rootMargin: "0px 0px -8% 0px" },
    );
    revs.forEach((r) => io?.observe(r));
    const sweep = () =>
      revs.forEach((r) => {
        if (r.getBoundingClientRect().top < innerHeight) show(r);
      });
    let st: number | undefined;
    on(
      window,
      "scroll",
      () => {
        cancel(st);
        st = later(sweep, 150);
      },
      { passive: true },
    );
    later(sweep, 2500);
    if (Q.has("all")) revs.forEach(show);
  }

  // for agents: HTTP / MCP
  const ctabs = [...root.querySelectorAll<HTMLButtonElement>(".ctab")];
  ctabs.forEach((b) =>
    on(b, "click", () => {
      ctabs.forEach((x) => x.setAttribute("aria-selected", String(x === b)));
      $("c-http").hidden = b.dataset.c !== "http";
      $("c-mcp").hidden = b.dataset.c !== "mcp";
    }),
  );

  return () => {
    stopped = true;
    gen++;
    cancelAnimationFrame(spinRaf);
    cancelAnimationFrame(raf);
    timers.forEach((id) => clearTimeout(id));
    timers.clear();
    io?.disconnect();
    ac.abort();
    offs.forEach((off) => off());
    hideR();
    root.classList.remove("js");
  };
}
