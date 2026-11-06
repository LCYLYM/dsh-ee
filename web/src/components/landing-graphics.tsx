import { useId, useMemo } from "react";
import { cx } from "./ui";

/**
 * 落地页的装饰图形：首屏飘带、点阵地球、产品截图下的渐变底板。
 * 纯 SVG / CSS，不依赖外部资源；动效在 index.css 里，减少动效时全部静止。
 */

/** Stripe 式悬停箭头：平时是 ›，悬停时伸出箭杆（样式见 index.css 的 .lp-arrow）。 */
export function HoverArrow() {
  return (
    <svg className="lp-arrow" width="10" height="10" viewBox="0 0 10 10" aria-hidden>
      <path className="lp-arrow-line" d="M0 5h7" />
      <path className="lp-arrow-tip" d="M1 1l4 4-4 4" />
    </svg>
  );
}

/** 首屏右上角的流动飘带：四条渐变色带从左下扫向右上。 */
export function Ribbon({ className }: { className?: string }) {
  const id = useId();
  const g = (n: number) => `${id}-g${n}`;
  return (
    <svg aria-hidden className={cx("lp-ribbon", className)} viewBox="0 0 1000 800" preserveAspectRatio="xMaxYMin slice" fill="none">
      <defs>
        <linearGradient id={g(1)} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#4d6bfe" />
          <stop offset="0.55" stopColor="#8b5cf6" />
          <stop offset="1" stopColor="#ffb088" />
        </linearGradient>
        <linearGradient id={g(2)} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#73c8ff" />
          <stop offset="1" stopColor="#4d6bfe" />
        </linearGradient>
        <linearGradient id={g(3)} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#ffd1a8" />
          <stop offset="0.5" stopColor="#f0a6ff" />
          <stop offset="1" stopColor="#a78bfa" />
        </linearGradient>
        <linearGradient id={g(4)} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#6d5dfc" />
          <stop offset="1" stopColor="#73c8ff" />
        </linearGradient>
      </defs>
      <path className="lp-band" fill={`url(#${g(4)})`} opacity="0.55" d="M60 860 C 380 760, 640 560, 1080 470 L 1080 590 C 690 650, 440 840, 140 940 Z" />
      <path className="lp-band" fill={`url(#${g(1)})`} d="M-40 640 C 260 590, 470 330, 1080 130 L 1080 360 C 540 480, 320 740, -40 820 Z" />
      <path className="lp-band" fill={`url(#${g(2)})`} opacity="0.85" d="M-40 540 C 300 500, 540 230, 1080 10 L 1080 105 C 580 290, 340 580, -40 615 Z" />
      <path className="lp-band" fill={`url(#${g(3)})`} opacity="0.9" d="M-40 735 C 290 670, 540 440, 1080 315 L 1080 360 C 560 480, 320 700, -40 770 Z" />
    </svg>
  );
}

const rad = (d: number) => (d * Math.PI) / 180;

/** 正射投影：以 (lat0, lon0) 为视点，返回平面坐标与朝向深度 z（>0 在正面）。 */
function project(lat: number, lon: number, lat0: number, lon0: number) {
  const φ = rad(lat);
  const λ = rad(lon - lon0);
  const φ0 = rad(lat0);
  return {
    x: Math.cos(φ) * Math.sin(λ),
    y: Math.cos(φ0) * Math.sin(φ) - Math.sin(φ0) * Math.cos(φ) * Math.cos(λ),
    z: Math.sin(φ0) * Math.sin(φ) + Math.cos(φ0) * Math.cos(φ) * Math.cos(λ),
  };
}

/** 私有部署节点与各地终端（示意）。 */
const HUB = { lat: 39.9, lon: 116.4 };
const NODES = [
  { lat: 31.2, lon: 121.5 },
  { lat: 22.5, lon: 114.1 },
  { lat: 30.6, lon: 104.1 },
  { lat: 34.3, lon: 108.9 },
  { lat: 45.8, lon: 126.6 },
  { lat: 43.8, lon: 87.6 },
  { lat: 25.0, lon: 102.7 },
  { lat: 36.1, lon: 120.4 },
];

/** 点阵地球：经纬点按深度渐隐，各地终端经弧线连到私有部署节点。 */
export function Globe({ className }: { className?: string }) {
  const id = useId();
  const R = 240;
  const C = 260;
  const lat0 = 22;
  const lon0 = 108;
  const pt = (lat: number, lon: number) => {
    const p = project(lat, lon, lat0, lon0);
    return { x: C + R * p.x, y: C - R * p.y, z: p.z };
  };

  const dots = useMemo(() => {
    const out: { x: number; y: number; o: number }[] = [];
    for (let lat = -84; lat <= 84; lat += 5) {
      const n = Math.max(6, Math.round(72 * Math.cos(rad(lat))));
      for (let k = 0; k < n; k++) {
        const p = project(lat, (k * 360) / n, lat0, lon0);
        if (p.z > 0.02) out.push({ x: C + R * p.x, y: C - R * p.y, o: 0.15 + 0.6 * p.z });
      }
    }
    return out;
  }, []);

  const hub = pt(HUB.lat, HUB.lon);
  const arcs = NODES.map((n) => {
    const a = pt(n.lat, n.lon);
    // 控制点从球心沿弦中点方向外推，弧线鼓出球面
    const mx = (a.x + hub.x) / 2;
    const my = (a.y + hub.y) / 2;
    const len = Math.hypot(a.x - hub.x, a.y - hub.y);
    const k = 1 + Math.min(0.5, len / 260);
    return { a, d: `M${a.x} ${a.y} Q ${C + (mx - C) * k} ${C + (my - C) * k - len * 0.35} ${hub.x} ${hub.y}` };
  });

  return (
    <svg aria-hidden className={className} viewBox="0 0 520 520" fill="none">
      <defs>
        <radialGradient id={`${id}-glow`} cx="0.4" cy="0.35" r="0.75">
          <stop offset="0" stopColor="#4d6bfe" stopOpacity="0.35" />
          <stop offset="1" stopColor="#4d6bfe" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-arc`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#80e9ff" />
          <stop offset="1" stopColor="#a78bfa" />
        </linearGradient>
      </defs>
      <circle cx={C} cy={C} r={R + 18} fill={`url(#${id}-glow)`} />
      <circle cx={C} cy={C} r={R} stroke="#80e9ff" strokeOpacity="0.18" />
      <g fill="#c4d3e3">
        {dots.map((d, i) => (
          <circle key={i} cx={d.x} cy={d.y} r={1.3} opacity={d.o} />
        ))}
      </g>
      <g strokeLinecap="round">
        {arcs.map(({ d }, i) => (
          <g key={i}>
            <path d={d} stroke="#80e9ff" strokeOpacity="0.35" strokeWidth="1.2" />
            <path d={d} stroke={`url(#${id}-arc)`} strokeWidth="2.2" className="lp-arc" style={{ animationDelay: `${-i * 0.37}s` }} />
          </g>
        ))}
      </g>
      {arcs.map(({ a }, i) => (
        <g key={i}>
          <circle cx={a.x} cy={a.y} r="3" fill="#80e9ff" className="lp-ping" style={{ animationDelay: `${-i * 0.3}s` }} />
          <circle cx={a.x} cy={a.y} r="2.6" fill="#80e9ff" />
        </g>
      ))}
      <circle cx={hub.x} cy={hub.y} r="6" fill="#ffffff" className="lp-ping" />
      <circle cx={hub.x} cy={hub.y} r="5.5" fill="#ffffff" />
      <circle cx={hub.x} cy={hub.y} r="2.5" fill="#4d6bfe" />
    </svg>
  );
}

/** 渐变底板：产品截图压在一块流动渐变上，向右下错开。 */
export function Backdrop({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cx("relative", className)}>
      <div aria-hidden className="lp-mesh absolute -inset-x-3 top-8 -bottom-6 rounded-2xl opacity-90 sm:-right-8 sm:left-10" />
      <div className="relative">{children}</div>
    </div>
  );
}
