"use client";

// Track map in the corner of the HUD: the circuit outline with a dot for every car. Reads sim state only.
import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import type { Track } from "@/sim";
import styles from "./game.module.css";

export interface MinimapHandle {
  /** Call every frame with the player's position and the other cars'. */
  update(car: { x: number; z: number }, bots: { x: number; z: number }[]): void;
}

const SIZE = 180;
const PAD = 14;

export const Minimap = forwardRef<MinimapHandle, { track: Track; bots: number }>(function Minimap({ track, bots }, ref) {
  // Fit the circuit into the box. Seen from above, world x runs right and world z runs down the screen.
  const { path, start, place } = useMemo(() => {
    const xs = track.points.map((p) => p.x);
    const zs = track.points.map((p) => p.z);
    const minX = Math.min(...xs);
    const minZ = Math.min(...zs);
    const spanX = Math.max(...xs) - minX;
    const spanZ = Math.max(...zs) - minZ;
    const scale = (SIZE - PAD * 2) / Math.max(spanX, spanZ);
    const place = (x: number, z: number): [number, number] => [
      PAD + (x - minX) * scale + (SIZE - PAD * 2 - spanX * scale) / 2,
      PAD + (z - minZ) * scale + (SIZE - PAD * 2 - spanZ * scale) / 2,
    ];
    const path = track.points.map((p, i) => `${i ? "L" : "M"}${place(p.x, p.z).map((v) => v.toFixed(1)).join(" ")}`).join("") + "Z";
    return { path, start: place(track.points[0].x, track.points[0].z), place };
  }, [track]);
  const me = useRef<SVGCircleElement>(null);
  const others = useRef<(SVGCircleElement | null)[]>([]);

  useImperativeHandle(ref, () => ({
    update(car, botCars) {
      const move = (el: SVGCircleElement | null, c: { x: number; z: number }) => {
        if (!el) return;
        const [x, y] = place(c.x, c.z);
        el.setAttribute("cx", x.toFixed(1));
        el.setAttribute("cy", y.toFixed(1));
      };
      botCars.forEach((b, i) => move(others.current[i], b));
      move(me.current, car);
    },
  }));

  return (
    <svg className={styles.minimap} width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-label="Track map">
      <path d={path} fill="none" stroke="rgba(0,0,0,0.55)" strokeWidth={7} strokeLinejoin="round" />
      <path d={path} fill="none" stroke="#f2f2f2" strokeWidth={3.5} strokeLinejoin="round" />
      <rect x={start[0] - 1.5} y={start[1] - 6} width={3} height={12} fill="#e0302a" />
      {Array.from({ length: bots }, (_, i) => (
        <circle key={i} ref={(el) => void (others.current[i] = el)} r={4} fill="#2f8fe0" stroke="#0b0d10" strokeWidth={1.5} />
      ))}
      <circle ref={me} r={5} fill="#f2c230" stroke="#0b0d10" strokeWidth={1.5} />
    </svg>
  );
});
