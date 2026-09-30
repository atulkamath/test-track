"use client";

import { forwardRef, useImperativeHandle, useRef } from "react";
import styles from "./game.module.css";
import { gearbox, MAX_RPM } from "./gearbox";

const REDLINE = 7500;
const SWEEP = 240; // degrees of dial travel
const START = -120; // degrees from 12 o'clock

function rpmAngle(rpm: number) {
  return START + (Math.min(rpm, MAX_RPM) / MAX_RPM) * SWEEP;
}

function polar(deg: number, r: number) {
  const a = ((deg - 90) * Math.PI) / 180;
  return [100 + Math.cos(a) * r, 100 + Math.sin(a) * r];
}

function arc(from: number, to: number, r: number) {
  const [x0, y0] = polar(from, r);
  const [x1, y1] = polar(to, r);
  return `M ${x0} ${y0} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x1} ${y1}`;
}

export interface TachoHandle {
  update(speedMs: number): void;
}

export const Tacho = forwardRef<TachoHandle>(function Tacho(_, ref) {
  const needle = useRef<SVGGElement>(null);
  const gear = useRef<SVGTextElement>(null);
  const speed = useRef<HTMLSpanElement>(null);
  const rpmSmooth = useRef(1000);

  useImperativeHandle(ref, () => ({
    update(speedMs: number) {
      const kmh = Math.abs(speedMs) * 3.6;
      const { gear: g, rpm: target } = gearbox(speedMs);
      rpmSmooth.current += (target - rpmSmooth.current) * 0.25;
      needle.current?.setAttribute("transform", `rotate(${rpmAngle(rpmSmooth.current)} 100 100)`);
      if (gear.current) gear.current.textContent = speedMs < -0.5 ? "R" : kmh < 1 ? "N" : String(g);
      if (speed.current) speed.current.textContent = String(Math.round(kmh));
    },
  }));

  const ticks = Array.from({ length: MAX_RPM / 1000 + 1 }, (_, k) => k);
  return (
    <div className={styles.tacho}>
      <svg viewBox="0 0 200 200" width="190" height="190" aria-hidden>
        <circle cx="100" cy="100" r="92" fill="rgba(8,10,16,0.72)" stroke="rgba(255,255,255,0.25)" strokeWidth="2" />
        <path d={arc(rpmAngle(REDLINE), rpmAngle(MAX_RPM), 80)} stroke="#e0302a" strokeWidth="8" fill="none" />
        {ticks.map((k) => {
          const a = rpmAngle(k * 1000);
          const [x0, y0] = polar(a, 84);
          const [x1, y1] = polar(a, 72);
          const [tx, ty] = polar(a, 60);
          return (
            <g key={k}>
              <line x1={x0} y1={y0} x2={x1} y2={y1} stroke="#fff" strokeWidth="3" />
              <text x={tx} y={ty + 5} className={styles.tachoNum} fill={k * 1000 >= REDLINE ? "#ff5a4f" : "#fff"}>
                {k}
              </text>
            </g>
          );
        })}
        {ticks.slice(0, -1).map((k) => {
          const a = rpmAngle(k * 1000 + 500);
          const [x0, y0] = polar(a, 84);
          const [x1, y1] = polar(a, 78);
          return <line key={`h${k}`} x1={x0} y1={y0} x2={x1} y2={y1} stroke="rgba(255,255,255,0.6)" strokeWidth="2" />;
        })}
        <text x="100" y="146" className={styles.tachoUnit}>
          x1000 rpm
        </text>
        <g ref={needle} transform={`rotate(${START} 100 100)`}>
          <polygon points="97,104 103,104 100.8,22 99.2,22" fill="#ff3b30" />
        </g>
        <circle cx="100" cy="100" r="9" fill="#15181d" stroke="#ff3b30" strokeWidth="2" />
        <text ref={gear} x="100" y="178" className={styles.tachoGear}>
          N
        </text>
      </svg>
      <div className={styles.tachoSpeed}>
        <span ref={speed}>0</span>
        <small>km/h</small>
      </div>
    </div>
  );
});
