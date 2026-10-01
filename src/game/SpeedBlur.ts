// Radial "speed blur": the edges of the screen streak outward from the centre while the middle stays sharp.
// The classic racing-game cue for speed. A custom pass for the postprocessing library.
import { Effect } from "postprocessing";
import { Uniform } from "three";

const fragment = /* glsl */ `
uniform float strength;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 toCentre = vec2(0.5) - uv;
  float d = length(toCentre);
  // No blur in the middle of the screen (where the car and the road ahead are); full blur at the edges.
  float amount = strength * smoothstep(0.18, 0.75, d);
  if (amount < 0.0005) {
    outputColor = inputColor;
    return;
  }
  vec4 sum = inputColor;
  for (int i = 1; i < 10; i++) {
    sum += texture2D(inputBuffer, uv + toCentre * amount * (float(i) / 9.0));
  }
  outputColor = sum / 10.0;
}
`;

export class SpeedBlurEffect extends Effect {
  constructor() {
    super("SpeedBlurEffect", fragment, { uniforms: new Map([["strength", new Uniform(0)]]) });
  }

  /** 0 = off. About 0.12 at top speed. */
  setStrength(value: number) {
    this.uniforms.get("strength")!.value = value;
  }
}
