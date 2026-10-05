# Credits

Everything here is free for commercial use. **The car models (CC-BY 4.0) and three street-circuit models (CC-BY 3.0) require credit, so this file must ship with the game.** The same credits are shown in the game (Credits, on the start screen: `src/game/Credits.tsx`); keep the two in step.

## Car models (CC-BY 4.0 — credit required)

- **Player car:** "Generic Coupe "Azura"" (https://sketchfab.com/3d-models/generic-coupe-azura-2e1a3699de7e4f688d328dc005ef1aac)
  by mk2design (https://sketchfab.com/mk2design), licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/).
  -> `public/models/azura.glb`
- **AI cars and parked cars:** "Generic passenger car pack" (https://sketchfab.com/3d-models/generic-passenger-car-pack-20f9af9b8a404d5cb022ac6fe87f21f5)
  by Comrade1280 (https://sketchfab.com/comrade1280), licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/).
  -> `public/models/cars/*.glb` (one file per car)

Changes made (CC-BY requires saying so): converted with `scripts/convert-cars.mjs` — split into one file per car,
re-centred and rotated to face +z, wheels re-parented under named pivots, Azura scaled to 3.8 m and its baked
shadow plane removed, textures resized and converted to WebP.

## Sky and ground textures (CC0 — public domain, no credit required)

- Sky: "Kloofendal 48d Partly Cloudy (Pure Sky)", Poly Haven — https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky
  -> `public/env/sky_2k.hdr`
- Asphalt: "Asphalt Track", Poly Haven — https://polyhaven.com/a/asphalt_track -> `public/textures/asphalt_*.jpg`
- Gravel: "Gravelly Sand", Poly Haven — https://polyhaven.com/a/gravelly_sand -> `public/textures/gravel_*.jpg`
- Concrete: "Concrete Wall 008", Poly Haven — https://polyhaven.com/a/concrete_wall_008 -> `public/textures/concrete_*.jpg`
- Grass: "Grass 001", ambientCG — https://ambientcg.com/a/Grass001 -> `public/textures/grass_*.jpg`

## People (CC0 — public domain, no credit required)

- Crowd and drivers: "Animated Human" by Quaternius — https://poly.pizza/m/c3Ibh9I3udk -> `public/models/people/man.glb`
  (simplified to 662 triangles by `scripts/convert-person.mjs`; posed and coloured in code)

## Sakura Street scenery (Poly Pizza, unmodified files in `public/models/jp/`)

CC-BY 3.0 (http://creativecommons.org/licenses/by/3.0/) — credit required:
- "Pagoda" by Poly by Google — https://poly.pizza/m/1zS7ucaAd4J -> `pagoda.glb`
- "Japanese Stone Lamp" by Flopsi — https://poly.pizza/m/5gZfOZIW92k -> `stonelamp.glb`

CC0 (public domain), all by Quaternius:
- "Torii Gate" https://poly.pizza/m/7SyXZ62xR5 (tinted vermilion in the game) -> `torii.glb`
- "Shoji Wall" https://poly.pizza/m/YQu7UD8YIS, "Normal Wall" https://poly.pizza/m/Jrc0L53QYY,
  "Red Wood Wall" https://poly.pizza/m/fCt0206mzB, "Japanese Door" https://poly.pizza/m/t4otyljz8K (townhouse fronts)
- "Sushi Truck" https://poly.pizza/m/OgrROxABGT -> `sushitruck.glb`

## Trees (CC0 — public domain, no credit required)

- "Maple Trees" by Quaternius — https://poly.pizza/m/iGFtQd0PJO -> `public/models/trees/maples.glb`
  (simplified by `scripts/convert-trees.mjs`; `public/textures/maple_leaves_green.webp` is its leaf texture
  hue-shifted from autumn orange to green; `public/textures/sakura_blossom.webp` is the same texture in cherry-blossom pink)

## Libraries
three, @react-three/fiber, @react-three/drei, @react-three/postprocessing: MIT. postprocessing: Zlib. n8ao (ambient occlusion): ISC.
HUD font: Exo 2 (SIL Open Font License), via next/font/google.

## Made in code
Track, grandstands, distant spectators, town, pylons, helicopter, blimp, cockpit wheel/hands/gauges, banners and all sound are generated in code.
Sponsor names are invented.

## Driver

- **"race driver"** by BELAZ — https://sketchfab.com/3d-models/race-driver-e4e97df9865d466c8359fbb23e757308
  Licence: CC-BY 4.0 (http://creativecommons.org/licenses/by/4.0/). Credit must ship with the game.
  Changes: packed to one GLB by `scripts/convert-driver.py` (materials converted, normal maps dropped); posed in code,
  hands recoloured as gloves, suit tinted per driver. File: `public/models/driver.glb`.
