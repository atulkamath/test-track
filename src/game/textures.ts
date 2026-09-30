// Canvas-generated textures. Everything is drawn in code, so there are no image assets to license.
import * as THREE from "three";
import { mulberry32 } from "@/sim/rng";

export function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Invented sponsor names only; no real brands.
export const ADS: [string, string, string][] = [
  ["DAILY LAP", "#c8322b", "#ffffff"],
  ["APEX FUEL", "#f2c230", "#15181d"],
  ["GRIPLINE", "#15181d", "#f2c230"],
  ["REDLINE", "#ffffff", "#c8322b"],
  ["TARMAC CO.", "#2f6fd6", "#ffffff"],
];

export function adTexture(i: number) {
  const [text, bg, fg] = ADS[i % ADS.length];
  return canvasTexture(512, 128, (ctx) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 512, 128);
    ctx.fillStyle = fg;
    ctx.font = "italic 800 76px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 256, 68);
  });
}

/** A dense packed-crowd look: many tiny shirts and heads (the 3D fans sit in front of this). */
export function crowdTexture() {
  return canvasTexture(512, 256, (ctx) => {
    const rand = mulberry32(7);
    ctx.fillStyle = "#454b53";
    ctx.fillRect(0, 0, 512, 256);
    const shirts = ["#e9e2d0", "#c8322b", "#2f6fd6", "#f2c230", "#1d1f24", "#ffffff", "#3f9b4a", "#e0701e", "#7a3fb5", "#e84d8a"];
    const skin = ["#f1c9a5", "#d9a47c", "#a8744f", "#6e4a33", "#f5d6bc"];
    for (let row = 0; row < 32; row++)
      for (let col = 0; col < 128; col++) {
        if (rand() < 0.06) continue;
        const x = col * 4 + (row % 2) * 2;
        const y = row * 8;
        ctx.fillStyle = shirts[Math.floor(rand() * shirts.length)];
        ctx.fillRect(x, y + 3, 3, 5);
        ctx.fillStyle = skin[Math.floor(rand() * skin.length)];
        ctx.fillRect(x + 1, y + 1, 2, 2);
      }
  });
}

/** Raked gravel: sandy brown with grain and faint rake lines running along the track. */
export function gravelTexture() {
  const t = canvasTexture(256, 256, (ctx) => {
    const rand = mulberry32(19);
    ctx.fillStyle = "#b39a78";
    ctx.fillRect(0, 0, 256, 256);
    for (let k = 0; k < 14000; k++) {
      const v = rand();
      ctx.fillStyle = v < 0.4 ? "rgba(90,70,50,0.35)" : v < 0.8 ? "rgba(220,205,180,0.35)" : "rgba(60,50,40,0.4)";
      ctx.fillRect(rand() * 256, rand() * 256, 1 + (rand() < 0.2 ? 1 : 0), 1);
    }
    for (let k = 0; k < 18; k++) {
      const x = rand() * 256;
      ctx.strokeStyle = "rgba(80,62,45,0.18)";
      ctx.lineWidth = 2 + rand() * 3;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x + 6, 85, x - 6, 170, x, 256);
      ctx.stroke();
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 16;
  return t;
}

/** One pit garage bay: roller door, team colour stripe, bay number. */
export function garageTexture() {
  return canvasTexture(256, 128, (ctx) => {
    ctx.fillStyle = "#d9dde1";
    ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = "#2b2f36";
    ctx.fillRect(18, 22, 220, 106);
    ctx.fillStyle = "#3a404a";
    for (let y = 26; y < 128; y += 6) ctx.fillRect(18, y, 220, 2);
    ctx.fillStyle = "#c8322b";
    ctx.fillRect(0, 6, 256, 8);
  });
}

/** Chain-link catch fence; alpha-tested so you can see through it. */
export function fenceTexture() {
  const t = canvasTexture(256, 128, (ctx) => {
    ctx.clearRect(0, 0, 256, 128);
    ctx.strokeStyle = "rgba(200,205,210,0.95)";
    ctx.lineWidth = 1.5;
    for (let k = -128; k < 256; k += 8) {
      ctx.beginPath();
      ctx.moveTo(k, 0);
      ctx.lineTo(k + 128, 128);
      ctx.moveTo(k + 128, 0);
      ctx.lineTo(k, 128);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(170,175,180,1)";
    ctx.fillRect(0, 0, 256, 4);
  });
  return t;
}

/** Timing tower face: fictional leaderboard. */
export function towerTexture(seed: string) {
  return canvasTexture(128, 512, (ctx) => {
    ctx.fillStyle = "#0b0f16";
    ctx.fillRect(0, 0, 128, 512);
    ctx.fillStyle = "#f2c230";
    ctx.font = "bold 20px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("DAILY LAP", 64, 34);
    ctx.fillStyle = "#9fb4c8";
    ctx.font = "13px monospace";
    ctx.fillText(seed, 64, 56);
    const rand = mulberry32(3);
    for (let k = 0; k < 12; k++) {
      const y = 86 + k * 34;
      ctx.fillStyle = k === 0 ? "#c8322b" : "#1c2533";
      ctx.fillRect(8, y - 20, 112, 28);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 16px monospace";
      ctx.textAlign = "left";
      ctx.fillText(String(k + 1).padStart(2, " "), 14, y);
      ctx.fillText(String(Math.floor(rand() * 90) + 10).padStart(3, "0"), 72, y);
    }
  });
}
