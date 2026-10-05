"use client";

// The credits panel on the start screen. CC-BY assets must be credited where players see them: title, author,
// source, licence and what was changed. Keep in step with CREDITS.md.
import styles from "./game.module.css";

const BY4 = { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" };
const BY3 = { name: "CC BY 3.0", url: "https://creativecommons.org/licenses/by/3.0/" };

const ATTRIBUTED = [
  {
    what: "Player car",
    title: 'Generic Coupe "Azura"',
    url: "https://sketchfab.com/3d-models/generic-coupe-azura-2e1a3699de7e4f688d328dc005ef1aac",
    author: "mk2design",
    licence: BY4,
    changes: "converted, re-centred, scaled, textures resized",
  },
  {
    what: "AI and parked cars",
    title: "Generic passenger car pack",
    url: "https://sketchfab.com/3d-models/generic-passenger-car-pack-20f9af9b8a404d5cb022ac6fe87f21f5",
    author: "Comrade1280",
    licence: BY4,
    changes: "split into one model per car, re-centred, textures resized",
  },
  {
    what: "Drivers",
    title: "race driver",
    url: "https://sketchfab.com/3d-models/race-driver-e4e97df9865d466c8359fbb23e757308",
    author: "BELAZ",
    licence: BY4,
    changes: "converted, posed in code, suits recoloured",
  },
  { what: "Pagoda", title: "Pagoda", url: "https://poly.pizza/m/1zS7ucaAd4J", author: "Poly by Google", licence: BY3 },
  { what: "Stone lanterns", title: "Japanese Stone Lamp", url: "https://poly.pizza/m/5gZfOZIW92k", author: "Flopsi", licence: BY3 },
];

export function Credits({ onClose }: { onClose: () => void }) {
  return (
    <div className={styles.credits} role="dialog" aria-label="Credits">
      <h2>Credits</h2>
      <div className={styles.creditsBy}>Game by Atul K</div>
      <ul>
        {ATTRIBUTED.map((c) => (
          <li key={c.title}>
            <span className={styles.creditsWhat}>{c.what}</span>
            <a href={c.url} target="_blank" rel="noreferrer">
              &ldquo;{c.title}&rdquo;
            </a>{" "}
            by {c.author} ·{" "}
            <a href={c.licence.url} target="_blank" rel="noreferrer">
              {c.licence.name}
            </a>
            {c.changes && <span className={styles.creditsChanges}> · {c.changes}</span>}
          </li>
        ))}
      </ul>
      <p>
        With thanks for public-domain (CC0) assets: people, trees, torii gate, townhouse walls and food truck by Quaternius; sky, asphalt, gravel and
        concrete from Poly Haven; grass from ambientCG.
      </p>
      <p>Built with three.js, React Three Fiber, drei and postprocessing. Font: Exo 2. Sponsor names are invented.</p>
      <button className={styles.startButton} onClick={onClose}>
        Back <kbd>Esc</kbd>
      </button>
    </div>
  );
}
