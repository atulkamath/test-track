// Camera views. Visual only.
import * as THREE from "three";
import type { Pose } from "./engine";

export const VIEWS = ["Chase", "Cockpit", "Far chase", "Roof", "Bumper", "TV"] as const;
export type View = (typeof VIEWS)[number];

interface Follow {
  back: number;
  up: number;
  ahead: number;
  lookY: number;
  /** How quickly the camera catches up (higher = stiffer). */
  stiffness: number;
  fov: number;
}

const FOLLOW: Record<Exclude<View, "TV" | "Cockpit">, Follow> = {
  Chase: { back: 6.4, up: 2.2, ahead: 6, lookY: 1.1, stiffness: 9, fov: 62 },
  "Far chase": { back: 11, up: 4.6, ahead: 6, lookY: 1, stiffness: 6, fov: 58 },
  Roof: { back: -0.3, up: 2.05, ahead: 20, lookY: 1.4, stiffness: 60, fov: 70 },
  Bumper: { back: -2.05, up: 0.7, ahead: 20, lookY: 0.9, stiffness: 80, fov: 74 },
};

export class CameraRig {
  private look = new THREE.Vector3();
  private desired = new THREE.Vector3();
  private target = new THREE.Vector3();
  private snapped = false;
  private tvIndex = -1;
  private lastView: View | null = null;

  /** tvSpots: trackside camera positions (x, y, z) for the TV view. */
  constructor(private tvSpots: THREE.Vector3[]) {}

  /** carRoot + eye: the car's transform and the driver's eye in car-local coordinates (for the cockpit view). */
  update(camera: THREE.PerspectiveCamera, view: View, p: Pose, speed: number, offRoad: boolean, delta: number, carRoot?: THREE.Object3D, eye?: THREE.Vector3) {
    const fx = Math.sin(p.angle);
    const fz = Math.cos(p.angle);
    const speedFrac = Math.min(Math.abs(speed) / 55, 1);
    const changed = view !== this.lastView;
    this.lastView = view;
    let fov: number;

    if (view === "Cockpit" && carRoot && eye) {
      carRoot.updateMatrixWorld();
      camera.position.copy(carRoot.localToWorld(this.desired.copy(eye)));
      // Tiny engine/road vibration that grows with speed.
      camera.position.y += (Math.random() - 0.5) * (0.002 + speedFrac * 0.006 + (offRoad ? 0.02 : 0));
      camera.lookAt(carRoot.localToWorld(this.target.set(eye.x * 0.6, eye.y - 1.0, eye.z + 12))); // ~5° down and slightly toward the car's centre
      fov = 72 + speedFrac * 6;
    } else if (view === "TV" && this.tvSpots.length > 0) {
      // Pick the nearest trackside camera, switching only when another is clearly closer (like a TV director).
      let best = 0;
      let bestD = Infinity;
      this.tvSpots.forEach((s, i) => {
        const d = Math.hypot(s.x - p.x, s.z - p.z);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      const cur = this.tvSpots[this.tvIndex];
      if (!cur || Math.hypot(cur.x - p.x, cur.z - p.z) > bestD * 1.4 + 10) this.tvIndex = best;
      const spot = this.tvSpots[this.tvIndex];
      camera.position.copy(spot);
      this.target.set(p.x + fx * 2, 0.9, p.z + fz * 2);
      if (changed) this.look.copy(this.target);
      this.look.lerp(this.target, 1 - Math.exp(-delta * 8));
      camera.lookAt(this.look);
      // Zoom so the car stays a similar size on screen.
      const dist = camera.position.distanceTo(this.look);
      fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(9 / dist)), 6, 55);
    } else {
      const f = FOLLOW[view === "TV" || view === "Cockpit" ? "Chase" : view];
      this.desired.set(p.x - fx * f.back, f.up, p.z - fz * f.back);
      this.target.set(p.x + fx * f.ahead, f.lookY, p.z + fz * f.ahead);
      if (!this.snapped || changed) {
        camera.position.copy(this.desired);
        this.look.copy(this.target);
        this.snapped = true;
      }
      camera.position.lerp(this.desired, 1 - Math.exp(-delta * f.stiffness));
      this.look.lerp(this.target, 1 - Math.exp(-delta * f.stiffness * 1.5));
      // Rumble on the grass, and a faint high-speed buzz.
      const shake = (offRoad && Math.abs(speed) > 3 ? 0.08 : 0) + speedFrac * speedFrac * 0.012;
      camera.position.y += (Math.random() - 0.5) * shake;
      camera.lookAt(this.look);
      fov = f.fov + speedFrac * (view === "Chase" || view === "Far chase" ? 14 : 8);
    }

    if (changed) camera.fov = fov;
    else camera.fov += (fov - camera.fov) * (1 - Math.exp(-delta * 4));
    camera.updateProjectionMatrix();
  }
}
