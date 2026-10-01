# Credits

Everything here is free for commercial use. **The two car models are CC-BY 4.0, so these credits must ship with the game.**

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

## Libraries
three, @react-three/fiber, @react-three/drei, @react-three/postprocessing: MIT. postprocessing: Zlib. n8ao (ambient occlusion): ISC.
HUD font: Exo 2 (SIL Open Font License), via next/font/google.

## Made in code
Track, grandstands, spectators, trees, town, pylons, helicopter, blimp, cockpit, banners and all sound are generated in code.
Sponsor names are invented.
