import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Easing, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { copy, type Lang } from "./copy";

// 分镜见 docs/launch-plan.md §1.2。每个场景自己淡入淡出，前后各重叠 FADE 帧。
const FADE = 12;
const SCENES = [120, 300, 240, 210, 150, 130] as const;
export const INTRO_FRAMES = SCENES.reduce((a, b) => a + b, 0) - FADE * (SCENES.length - 1);

const BRAND = "#4D6BFE";
const INK = "#0A2540";
const MUTED = "#5B6B82";
const BG = "#F5F7FB";
const FONT = '"Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", "Inter", system-ui, sans-serif';
const MONO = '"JetBrains Mono", "SFMono-Regular", Menlo, monospace';

type T = (typeof copy)[Lang];

export function Intro({ lang }: { lang: Lang }) {
  const c = copy[lang];
  let at = 0;
  const parts = [Scene1, Scene2, Scene3, Scene4, Scene5, Scene6].map((S, i) => {
    const from = at;
    at += SCENES[i] - FADE;
    return (
      <Sequence key={i} from={from} durationInFrames={SCENES[i]}>
        <Fade total={SCENES[i]} first={i === 0} last={i === SCENES.length - 1}>
          <S c={c} lang={lang} />
        </Fade>
      </Sequence>
    );
  });
  return <AbsoluteFill style={{ background: BG, fontFamily: FONT, color: INK }}>{parts}</AbsoluteFill>;
}

// ---- 公用 ----

function Fade({ total, first, last, children }: { total: number; first: boolean; last: boolean; children: ReactNode }) {
  const f = useCurrentFrame();
  const inO = first ? 1 : interpolate(f, [0, FADE], [0, 1], { extrapolateRight: "clamp" });
  const outO = last ? interpolate(f, [total - 20, total], [1, 0], { extrapolateLeft: "clamp" }) : interpolate(f, [total - FADE, total], [1, 0], { extrapolateLeft: "clamp" });
  return <AbsoluteFill style={{ opacity: Math.min(inO, outO), background: BG }}>{children}</AbsoluteFill>;
}

/** 从 delay 帧开始弹入（0→1）。 */
function useIn(delay = 0, damping = 18) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: f - delay, fps, config: { damping, mass: 0.8 } });
}

function Caption({ text, delay = 0, top = 70 }: { text: string; delay?: number; top?: number }) {
  const p = useIn(delay);
  // 英文字符窄、句子长：按是否含中文换字号，保证一行放得下
  const cjk = /[\u4e00-\u9fff]/.test(text);
  return (
    <div style={{ position: "absolute", top, left: 0, right: 0, textAlign: "center", whiteSpace: "nowrap", fontSize: cjk ? 54 : 46, fontWeight: 700, letterSpacing: -0.5, opacity: p, transform: `translateY(${(1 - p) * 24}px)` }}>
      {text}
    </div>
  );
}

function typed(text: string, start: number, cps: number, frame: number, fps: number) {
  const n = Math.max(0, Math.floor(((frame - start) / fps) * cps));
  return Array.from(text).slice(0, n).join("");
}

function Window({ children, style, title }: { children: ReactNode; style?: CSSProperties; title?: string }) {
  return (
    <div style={{ position: "absolute", background: "#fff", borderRadius: 20, boxShadow: "0 30px 80px rgba(10,37,64,0.16), 0 0 0 1px rgba(10,37,64,0.06)", overflow: "hidden", ...style }}>
      <div style={{ height: 44, display: "flex", alignItems: "center", gap: 8, padding: "0 18px", borderBottom: "1px solid #EEF1F6", background: "#FAFBFD" }}>
        {["#FF5F57", "#FEBC2E", "#28C840"].map((x) => (
          <span key={x} style={{ width: 12, height: 12, borderRadius: 6, background: x }} />
        ))}
        {title && <span style={{ marginLeft: 12, fontSize: 18, color: MUTED }}>{title}</span>}
      </div>
      {children}
    </div>
  );
}

function Bubble({ me, children, style }: { me?: boolean; children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ alignSelf: me ? "flex-end" : "flex-start", maxWidth: "82%", padding: "18px 24px", borderRadius: 18, fontSize: 28, lineHeight: 1.5, background: me ? BRAND : "#F1F4F9", color: me ? "#fff" : INK, ...style }}>
      {children}
    </div>
  );
}

// ---- 1. 普通 AI 不认识你的公司 ----

function Scene1({ c }: { c: T }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const q = useIn(18);
  const a = useIn(52);
  return (
    <AbsoluteFill>
      <Caption text={c.s1.caption} />
      <Window title="AI Chat" style={{ left: 360, top: 230, width: 1200, height: 560 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 26, padding: 48 }}>
          <Bubble me style={{ opacity: q, transform: `translateY(${(1 - q) * 20}px)` }}>
            {c.s1.q}
          </Bubble>
          <Bubble style={{ opacity: a, color: MUTED }}>{typed(c.s1.a, 56, 22, f, fps) || "…"}</Bubble>
        </div>
      </Window>
    </AbsoluteFill>
  );
}

// ---- 2. 接上 dsh-ee 之后 ----

function Scene2({ c }: { c: T }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = c.s2;
  const qText = typed(`${s.cmd} ${s.q}`, 14, 26, f, fps);
  const toolAt = [86, 116];
  const ansAt = 150;
  const ans = useIn(ansAt);
  return (
    <AbsoluteFill>
      <Caption text={s.caption} />
      <Window title="DSH" style={{ left: 260, top: 200, width: 1400, height: 800 }}>
        <div style={{ position: "absolute", right: 24, top: 8, fontSize: 18, color: MUTED, border: "1px solid #DCE2EC", borderRadius: 999, padding: "4px 14px" }}>{s.badge}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 22, padding: "36px 48px" }}>
          <Bubble me>
            <span style={{ fontFamily: MONO, background: "rgba(255,255,255,0.22)", borderRadius: 8, padding: "2px 10px", marginRight: 10 }}>{qText.slice(0, s.cmd.length)}</span>
            {qText.slice(s.cmd.length + 1)}
          </Bubble>
          <div style={{ display: "flex", gap: 16 }}>
            {s.tools.map((tool, i) => (
              <Tool key={tool} text={tool} at={toolAt[i]} />
            ))}
          </div>
          <div style={{ opacity: ans, transform: `translateY(${(1 - ans) * 16}px)`, background: "#F7F9FC", border: "1px solid #E6EAF2", borderRadius: 18, padding: "26px 32px" }}>
            <div style={{ fontSize: 32, fontWeight: 700, display: "flex", alignItems: "center", gap: 14 }}>
              <span style={{ width: 14, height: 14, borderRadius: 7, background: "#E5484D" }} />
              {s.title}
            </div>
            {s.lines.map((line, i) => {
              const p = interpolate(f, [ansAt + 14 + i * 22, ansAt + 30 + i * 22], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
              return (
                <div key={line} style={{ fontSize: 28, lineHeight: 1.6, marginTop: 12, opacity: p, transform: `translateX(${(1 - p) * 16}px)` }}>
                  · {line}
                </div>
              );
            })}
            <div style={{ marginTop: 18, fontSize: 21, color: BRAND, opacity: interpolate(f, [ansAt + 90, ansAt + 104], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>{s.source}</div>
          </div>
        </div>
      </Window>
    </AbsoluteFill>
  );
}

function Tool({ text, at }: { text: string; at: number }) {
  const f = useCurrentFrame();
  const p = useIn(at);
  const done = f > at + 22;
  return (
    <div style={{ opacity: p, transform: `scale(${0.9 + p * 0.1})`, display: "flex", alignItems: "center", gap: 12, fontSize: 22, padding: "12px 18px", borderRadius: 12, background: "#fff", border: "1px solid #DCE2EC", boxShadow: "0 4px 14px rgba(10,37,64,0.06)" }}>
      <span style={{ width: 26, height: 26, borderRadius: 13, display: "grid", placeItems: "center", fontSize: 16, color: "#fff", background: done ? "#1F9D55" : "#A9B4C6" }}>{done ? "✓" : "…"}</span>
      <span style={{ fontFamily: MONO }}>{text}</span>
    </div>
  );
}

// ---- 3. 管理员视角：真截图 ----

const FRAME: CSSProperties = { position: "absolute", left: 300, top: 222, width: 1320, height: 825, borderRadius: 18, overflow: "hidden", boxShadow: "0 30px 80px rgba(10,37,64,0.18), 0 0 0 1px rgba(10,37,64,0.06)", background: "#fff" };

/** 一张真截图：from 帧从右侧滑入，之后缓慢推近。后来的盖在前面的上面，不做交叉淡化（界面重叠会糊）。 */
function Shot({ src, from, zoom = [1, 1.04], origin = "50% 0%" }: { src: string; from: number; zoom?: [number, number]; origin?: string }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (f < from) return null;
  const p = spring({ frame: f - from, fps, config: { damping: 22, mass: 0.9 } });
  const z = interpolate(f, [from, from + 120], zoom, { extrapolateRight: "clamp", easing: Easing.inOut(Easing.quad) });
  return (
    <div style={{ ...FRAME, transform: `translateX(${(1 - p) * 1500}px)` }}>
      <Img src={src} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top left", transform: `scale(${z})`, transformOrigin: origin }} />
    </div>
  );
}

function Scene3({ c, lang }: { c: T; lang: Lang }) {
  const f = useCurrentFrame();
  const shots = ["connections", "apps", "conn-crm", "brief"];
  const per = 60;
  const active = Math.min(3, Math.floor(f / per));
  return (
    <AbsoluteFill>
      <Caption text={c.s3.caption} top={40} />
      <div style={{ position: "absolute", top: 132, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 18 }}>
        {c.s3.steps.map((step, i) => (
          <div key={step} style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <span style={{ fontSize: 24, fontWeight: 600, padding: "8px 18px", borderRadius: 999, transition: "none", background: i <= active ? BRAND : "#E6EAF2", color: i <= active ? "#fff" : MUTED }}>{step}</span>
            {i < c.s3.steps.length - 1 && <span style={{ fontSize: 24, color: MUTED }}>→</span>}
          </div>
        ))}
      </div>
      {shots.map((s, i) => (
        <Shot key={s} src={staticFile(`shots/${lang}/${s}.png`)} from={i === 0 ? -30 : i * per} />
      ))}
    </AbsoluteFill>
  );
}

// ---- 4. 管得住：审批卡 + 调用记录 ----

function Scene4({ c, lang }: { c: T; lang: Lang }) {
  const s = c.s4;
  const card = useIn(30, 14);
  const f = useCurrentFrame();
  const press = f > 96 && f < 106 ? 0.94 : 1;
  const approved = f >= 104;
  return (
    <AbsoluteFill>
      <Caption text={s.caption} />
      <Shot src={staticFile(`shots/${lang}/conn-crm.png`)} from={-30} />
      <Shot src={staticFile(`shots/${lang}/conn-calls.png`)} from={112} zoom={[1, 1.05]} origin="40% 70%" />
      <div style={{ position: "absolute", right: 150, bottom: 110, width: 640, background: "#fff", borderRadius: 20, padding: "30px 34px", opacity: approved ? interpolate(f, [104, 120], [1, 0], { extrapolateRight: "clamp" }) : card, transform: `translateY(${(1 - card) * 40}px)`, boxShadow: "0 30px 80px rgba(10,37,64,0.25), 0 0 0 1px rgba(10,37,64,0.08)" }}>
        <div style={{ fontSize: 28, fontWeight: 700 }}>{s.cardTitle}</div>
        <div style={{ marginTop: 10, fontSize: 23, color: "#B4530B" }}>{s.cardSub}</div>
        <div style={{ marginTop: 24, display: "flex", gap: 14, justifyContent: "flex-end" }}>
          <span style={{ fontSize: 22, padding: "10px 26px", borderRadius: 10, border: "1px solid #DCE2EC", color: MUTED }}>{s.deny}</span>
          <span style={{ fontSize: 22, padding: "10px 26px", borderRadius: 10, background: BRAND, color: "#fff", transform: `scale(${press})` }}>{s.allow}</span>
        </div>
      </div>
    </AbsoluteFill>
  );
}

// ---- 5. 架构 ----

function Scene5({ c }: { c: T }) {
  const s = c.s5;
  const f = useCurrentFrame();
  const center = { x: 960, y: 610 };
  const left = s.sources.map((name, i) => ({ name, x: 330, y: 400 + i * 140 }));
  const right = s.people.map((name, i) => ({ name, x: 1590, y: 330 + i * 112 }));
  const flow = (delay: number) => interpolate(f, [delay, delay + 30], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const dash = (f * 2) % 40;
  return (
    <AbsoluteFill>
      <Caption text={s.caption} />
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
        {left.map((p, i) => (
          <line key={p.name} x1={p.x + 110} y1={p.y} x2={p.x + 110 + (center.x - 170 - p.x - 110) * flow(10 + i * 4)} y2={p.y + (center.y - p.y) * flow(10 + i * 4)} stroke="#B8C4DA" strokeWidth={3} strokeDasharray="10 10" strokeDashoffset={-dash} />
        ))}
        {right.map((p, i) => (
          <line key={p.name} x1={center.x + 170} y1={center.y} x2={center.x + 170 + (p.x - 120 - center.x - 170) * flow(40 + i * 4)} y2={center.y + (p.y - center.y) * flow(40 + i * 4)} stroke={BRAND} strokeOpacity={0.55} strokeWidth={3} strokeDasharray="10 10" strokeDashoffset={-dash} />
        ))}
      </svg>
      {left.map((p, i) => (
        <Node key={p.name} x={p.x} y={p.y} w={220} delay={4 + i * 4} label={p.name} />
      ))}
      <Node x={center.x} y={center.y} w={340} h={180} delay={20} label={s.center} sub={s.centerSub} strong />
      {right.map((p, i) => (
        <Node key={p.name} x={p.x} y={p.y} w={240} h={84} delay={36 + i * 4} label={`${p.name} · DSH`} brand />
      ))}
    </AbsoluteFill>
  );
}

function Node({ x, y, w, h = 92, delay, label, sub, strong, brand }: { x: number; y: number; w: number; h?: number; delay: number; label: string; sub?: string; strong?: boolean; brand?: boolean }) {
  const p = useIn(delay);
  return (
    <div style={{ position: "absolute", left: x - w / 2, top: y - h / 2, width: w, height: h, borderRadius: strong ? 28 : 16, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", opacity: p, transform: `scale(${0.85 + p * 0.15})`, background: strong ? `linear-gradient(135deg, #6B85FF, ${BRAND})` : "#fff", color: strong ? "#fff" : brand ? BRAND : INK, fontSize: strong ? 52 : 26, fontWeight: strong ? 800 : 600, boxShadow: strong ? "0 30px 70px rgba(77,107,254,0.35)" : "0 8px 24px rgba(10,37,64,0.08), 0 0 0 1px rgba(10,37,64,0.06)" }}>
      {label}
      {sub && <span style={{ fontSize: 24, fontWeight: 500, opacity: 0.85, marginTop: 6 }}>{sub}</span>}
    </div>
  );
}

// ---- 6. 口号 ----

function Scene6({ c }: { c: T }) {
  const s = c.s6;
  const a = useIn(4);
  const b = useIn(22);
  const d = useIn(38);
  return (
    <AbsoluteFill style={{ background: `radial-gradient(1200px 700px at 50% 40%, #EEF2FF, ${BG})`, alignItems: "center", justifyContent: "center", textAlign: "center" }}>
      <div style={{ fontSize: 40, fontWeight: 800, color: BRAND, letterSpacing: 1, opacity: a }}>dsh-ee</div>
      <div style={{ marginTop: 24, fontSize: /[\u4e00-\u9fff]/.test(s.slogan) ? 76 : 64, fontWeight: 800, letterSpacing: -1, opacity: a, transform: `translateY(${(1 - a) * 24}px)` }}>{s.slogan}</div>
      <div style={{ marginTop: 26, fontSize: 32, color: MUTED, opacity: b }}>{s.sub}</div>
      <div style={{ marginTop: 64, display: "flex", gap: 28, opacity: d, transform: `translateY(${(1 - d) * 16}px)` }}>
        <span style={{ fontSize: 32, fontWeight: 700, color: "#fff", background: BRAND, padding: "16px 34px", borderRadius: 14 }}>{s.demo}</span>
        <span style={{ fontSize: 32, fontWeight: 600, fontFamily: MONO, padding: "16px 34px", borderRadius: 14, border: "2px solid #D5DCE8" }}>{s.repo}</span>
      </div>
    </AbsoluteFill>
  );
}
