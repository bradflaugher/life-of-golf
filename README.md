# Life of Golf

**[lifeofgolf.win](https://lifeofgolf.win/)**

<p align="center">
  <img src="docs/gameplay.gif" width="100%" alt="Life of Golf gameplay: an isometric 3D golf hole floating over a calm ivory backdrop, playing through a 4-stroke Championship hole with drive, chip, and putt cards to sink Par.">
</p>

An infinite isometric 3D golf puzzle card game inspired by *Golf Peaks*, played on small floating model courses, with a quiet, typographic interface, powered by a tiny on-device neural network (**`CaddieNet-v1`**, 3,746 parameters, 25 KB) running **100% locally in your browser** with zero servers and zero data collection.

---

## Features

- **Infinite BFS-Verified Holes:** Every procedurally generated course is verified solvable by an exact breadth-first solver with optimal par, shareable `?seed=...` URLs, and a shared **Daily Course** (`?daily=YYYY-MM-DD`, always the Classic course so everyone plays the same hole).
- **4 Difficulty Presets + Custom Course Builder:** Play **Relaxed** (`5×5`), **Classic** (`6×6`), **Tour** (`7×7`), or **Championship** (`8×8`, 3-tier peaks) — or customize board size, elevation tiers, hand size, and toggle individual terrains.
- **10 Terrains & Mechanics:**
  - **Fairway & 3-Tier Cliffs** with angled **3D Ramps** (climb uphill, gain momentum downhill)
  - **Sand Bunkers** (stop rolling balls; escape with a Chip/Lob card)
  - **Water Hazards & Floating Island Cliffs**
  - **Frictionless Ice** (slide continuously until off ice or blocked)
  - **Sticky Mud / Deep Rough** (drains extra roll momentum)
  - **Stone Hedge Walls** (bank-shot rebounds!)
  - **Directional Boost / Wind Strips**
  - **Coral Spring Pads** (launch 2 tiles over walls and water)
  - **Twin Warp Portals** (preserve roll momentum across the island)
- **5 Shot Card Types:** Putt/Roll (`1–4`), Chip (`1–3`), Pitch (`1+1`, `2+1`, `1+2`), Backspin (`2↩`, `3↩`), and Super Lob (`2↑`).
- **Mobile-First Controls:** The course fills the screen and the interface floats over it. Tap a card, then **swipe anywhere**, **tap a chevron**, **tap the tile the shot lands on**, or use the **diagonal pad** (one button per isometric direction). Every direction previews its dotted flight path and landing ring. Landscape phones get the hand as a side rail. Full keyboard support (`1–7`, Arrows/WASD, `Z` undo, `R` reset, `N` skip, `Q/E` rotate 90°, `H` AI Caddie).
- **Fair Play Rules:** A hole counts toward your streak once, however often you replay it; skipping an unsolved hole resets the streak. The game tells you as soon as the cup is out of reach instead of letting you play out a dead hand, and a putt from a bunker is refused rather than wasting the card.
- **🧠 CaddieNet-v1 (On-Device Edge AI):** A compact `24 → 64 → 32 → 2` Policy+Value MLP trained on BFS-solved holes (`scripts/train_caddie.mjs`). Runs real `Float32Array` forward passes in `< 1 ms` per board to display live move softmax probabilities, raw logits (`z`), predicted strokes-to-cup `V(s)`, and 32 hidden-layer ReLU activations.
- **Quiet and Rich:** The course is a softly lit model: flat confident colour, real soft shadows, one calm backdrop, nothing filtered. The ball, cup, pin and flag are physically shaded (a glossy dimpled ball, a fibreglass stick, a cloth flag that waves) so they read as real objects on it. The interface is ivory, deep green and hairline gold, set in Playfair Display and EB Garamond with room to breathe. Two moods: **Ivory** (daylight) and **Evergreen** (the model under a lamp in a dark green room). Render density steps down by itself on slow devices (`?fx=low` or `?fx=high` forces it). Self-hosted fonts (SIL OFL, `src/fonts/`), inline SVG icons, soft synthesized club sounds with distant birdsong, and light haptics.

---

## Local Development & Testing

```bash
node --test tests/*.test.mjs             # Run physics, BFS generator, CaddieNet & UI wiring tests
node scripts/train_caddie.mjs            # Retrain CaddieNet-v1 weights (models/caddie_net.json)
python3 -m http.server 8765              # Serve locally at http://127.0.0.1:8765
```
