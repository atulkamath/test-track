// Camera views. Visual only.
import * as THREE from "three";
import type { Pose } from "./engine";

// The first view is the default.
export const VIEWS = ["Chase", "Far chase", "Cockpit", "Roof", "Bumper", "TV"] as const;
export type View = (typeof VIEWS)[number];

interface Follow {
  /** Distance behind the car at rest, and how much further back it eases at top speed. */
  back: number;
  backSpeed: number;
  /** Height at rest, and how much it changes at top speed (negative = drops toward the road). */
  up: number;
  upSpeed: number;
  /** The camera aims at a point this far ahead of the car, at this height. */
  ahead: number;
  lookY: number;
  /** How quickly the camera swings round behind the car when it turns (higher = stiffer). */
  yawRate: number;
  /** Lens angle at rest, and how much it widens at top speed. */
  fov: number;
  fovSpeed: number;
}

// Chase cameras work the way racing games do it: the camera orbits the car at a set distance, so the car stays
// the same size and place on screen at any speed. Only the orbit angle lags, so in a turn the car swings in the
// frame and the view catches up. Speed is sold by the lens widening and the camera easing back slightly, plus a
// small spring: it drops back under hard acceleration and closes in under braking.
const FOLLOW: Record<Exclude<View, "TV" | "Cockpit">, Follow> = {
  Chase: { back: 5.2, backSpeed: 1.6, up: 1.65, upSpeed: -0.22, ahead: 6, lookY: 1.05, yawRate: 5.5, fov: 58, fovSpeed: 24 },
  "Far chase": { back: 9.5, backSpeed: 2.4, up: 3.6, upSpeed: -0.4, ahead: 6, lookY: 1, yawRate: 4, fov: 56, fovSpeed: 20 },
  Roof: { back: -0.3, backSpeed: 0, up: 2.05, upSpeed: 0, ahead: 20, lookY: 1.4, yawRate: 60, fov: 70, fovSpeed: 14 },
  Bumper: { back: -2.05, backSpeed: 0, up: 0.7, upSpeed: 0, ahead: 20, lookY: 0.9, yawRate: 80, fov: 74, fovSpeed: 14 },
};

export class CameraRig {
  private look = new THREE.Vector3();
  private desired = new THREE.Vector3();
  private target = new THREE.Vector3();
  private snapped = false;
  /** Orbit angle of the chase camera (lags the car's heading). */
  private yaw = 0;
  /** Spring offset along the orbit distance from acceleration / braking. */
  private pull = 0;
  private lastSpeed = 0;
  private tvIndex = -1;
  private lastView: View | null = null;

  /** tvSpots: trackside camera positions (x, y, z) for the TV view. */
  constructor(private tvSpots: THREE.Vector3[]) {}

  /** carRoot + eye: the car's transform and the driver's eye in car-local coordinates (for the cockpit view). */
  update(camera: THREE.PerspectiveCamera, view: View, p: Pose, speed: number, offRoad: boolean, delta: number, carRoot?: THREE.Object3D, eye?: THREE.Vector3) {
    const fx = Math.sin(p.angle);
    const fz = Math.cos(p.angle);
    const speedFrac = Math.min(Math.abs(speed) / 64, 1);
    const changed = view !== this.lastView;
    this.lastView = view;
    let fov: number;

    if (view === "Cockpit" && carRoot && eye) {
      carRoot.updateMatrixWorld();
      camera.position.copy(carRoot.localToWorld(this.desired.copy(eye)));
      // Tiny engine/road vibration that grows with speed.
      camera.position.y += (Math.random() - 0.5) * (0.002 + speedFrac * 0.006 + (offRoad ? 0.02 : 0));
      // ~5° down, and ~6° toward the middle of the windscreen so the left pillar doesn't crowd the view.
      camera.lookAt(carRoot.localToWorld(this.target.set(eye.x - 1.3, eye.y - 1.0, eye.z + 12)));
      fov = 60 + speedFrac * 5;
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
      if (!this.snapped || changed) {
        this.yaw = p.angle;
        this.pull = 0;
        this.lastSpeed = speed;
      }
      // Swing round behind the car by the shortest way.
      const diff = Math.atan2(Math.sin(p.angle - this.yaw), Math.cos(p.angle - this.yaw));
      this.yaw += diff * (1 - Math.exp(-delta * f.yawRate));
      // Acceleration spring (chase views only): back under power, forward under braking.
      const accel = delta > 0 ? (speed - this.lastSpeed) / delta : 0;
      this.lastSpeed = speed;
      const pullTarget = f.backSpeed > 0 ? THREE.MathUtils.clamp(accel * 0.045, -0.55, 0.6) : 0;
      this.pull += (pullTarget - this.pull) * (1 - Math.exp(-delta * 3));

      // Speed effects build early: most of a lap is spent at 100-150 km/h, well short of top speed.
      const rush = Math.pow(speedFrac, 0.7);
      const dist = f.back + rush * f.backSpeed + this.pull;
      // Rumble on the grass, and a faint high-speed buzz.
      const shake = (offRoad && Math.abs(speed) > 3 ? 0.08 : 0) + speedFrac * speedFrac * 0.03;
      camera.position.set(p.x - Math.sin(this.yaw) * dist, f.up + rush * f.upSpeed + (Math.random() - 0.5) * shake, p.z - Math.cos(this.yaw) * dist);
      this.target.set(p.x + fx * f.ahead, f.lookY, p.z + fz * f.ahead);
      if (!this.snapped || changed) {
        this.look.copy(this.target);
        this.snapped = true;
      }
      this.look.lerp(this.target, 1 - Math.exp(-delta * 12));
      camera.lookAt(this.look);
      fov = f.fov + rush * f.fovSpeed;
    }

    if (changed) camera.fov = fov;
    else camera.fov += (fov - camera.fov) * (1 - Math.exp(-delta * 4));
    camera.updateProjectionMatrix();
  }
}
