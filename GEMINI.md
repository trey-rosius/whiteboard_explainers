# Studio-Grade Remotion Video Generation Standards (KodeKloud Whiteboard Style)

All technical animations, explainer videos, and Shorts generated in this repository MUST follow the visual and kinetic whiteboard style of KodeKloud and ByteByteGo as seen in production system design architectures (Caching, Load Balancing, Data Modeling, and B-Tree Indexing).

---

## 1. Visual Aesthetics & Canvas Styling
- **Canvas Background**: Pure Obsidian Black (`#000000` or `#05070D`) with a subtle `opacity: 0.15` dot grid (`40px` spacing).
- **Hand-Drawn Typography**:
  - **Headers, Labels & Actor Titles**: Bold uppercase hand-drawn marker font (`"Permanent Marker"`, `"Kalam"`, `"Caveat"`, or `"Patrick Hand"`, `letter-spacing: 0.04em`).
  - **Attributes, Keys, Schemas & Metrics**: Clean monospace (`"JetBrains Mono"`, `"Fira Code"`, `font-weight: 700`).
- **5-Color Semantic Palette**:
  - `#67E8F9` (Sky Cyan): App servers, photo tables, client ingress, database drums, connection arrows.
  - `#FACC15` (Warm Yellow): Active queries, index cards (`index · posted_by`), load balancers, section titles, highlighted columns, step numbers.
  - `#FB7185` (Coral Pink / Red): Mobile phone frames, like actions (`LIKES` table with heart ❤️), hot partitions, bottlenecks, foreign keys.
  - `#34D399` (Emerald Green): Cache hits, valid lookups, completed deliveries, healthy nodes.
  - `#FFFFFF` (Pure White): Text, icons, neutral borders.

---

## 2. The 8 Sketched Architectural Primitives

Every video MUST compose its architecture from these hand-drawn visual primitives:

1. **`SketchPhoneMockup` (Client Ingress)**:
   - Smartphone frame with rounded corners (cyan `#67E8F9` or coral `#FB7185` outline).
   - User profile header (e.g. `ALAN` / `USER ALAN`), avatar icon, and follow status.
   - 2 photo feed cards with stylized mountain/sun vector sketches.
   - Interactive action icons: heart ❤️ (like button) and speech bubble 💬 (comment button).

2. **`SketchServerBlade` (Compute Fleet)**:
   - Sketched dual-slot chassis with rounded borders, horizontal vent slots, and status LEDs.
   - Optional `< >` code badge on top.
   - Can be arrayed as a single hero node or fanned out into a 2x5 grid (10-server fleet).

3. **`SketchDatabaseDrum` (Persistent Storage)**:
   - Sketched 3D cylindrical database drum with liquid level indicator and bold `DATABASE` label.

4. **`SketchRedisStack` (In-Memory Cache)**:
   - 3D-isometric red layered block (`#FF4438`) with geometric cutouts (circle, triangle, square).
   - Warm yellow outlined sketch box directly underneath titled `IN CACHE` displaying cached keys (e.g. `🖼️ MESSI`, `🖼️ RONALDO`).

5. **`SketchLoadBalancer` (Ingress Router)**:
   - Sketched yellow diamond router with 3 socket/queue boxes on the right.
   - Radiates fan-out arrows spreading incoming traffic across server blades.

6. **`SketchEntityCard` (Relational Data Model)**:
   - Hand-drawn schema cards with distinct colored borders:
     - `USERS` (Yellow border) with stick figure icon 🧍, attributes: `id`, `name`, `email`.
     - `PHOTOS` (Cyan border) with picture icon 🖼️, attributes: `id`, `posted_by ->`, `caption`, `upload_time`, `image_link ->`.
     - `LIKES` (Pink/Coral border) with heart icon ❤️, attributes: `user_id -> Alan`, `photo_id -> 42`, `time 2:14 pm`.
     - `COMMENTS` (Yellow border) with speech bubble icon 💬.

7. **`SketchCurvedArrow` (Foreign Key / Data Jump Pointers)**:
   - Hand-drawn curved SVG cubic bezier paths (`<path d="M ... C ..."/>`) with glowing arrowheads.
   - Physically links foreign key fields across tables (e.g., `LIKES.user_id` pointing up to `USERS.id`, `LIKES.photo_id` pointing to `PHOTOS.id`).

8. **`SketchIndexLookup` (B-Tree Fast Track)**:
   - Side-by-side comparison tables:
     - Left card: `index · posted_by` (warm yellow border) with columns `posted_by` and pointer `rows` (`alan` -> `822 · 15k · 100k`).
     - Right card: `photo_details` (cyan border) with highlighted yellow `posted_by` column and data rows (`37 | priya | "sunset"`, `822 | alan | "hike"`, `... 1 million+ rows`).
     - Curved arrow jumping from the index entry directly to the matching row in the main table with annotation `JUMP ! ...`.

---

## 3. Official Icon Packs Integration
Import and render icons from the installed icon packages via `aws-blocks/icons.ts`:
- **`aws-icons`**: 302 official AWS architecture services (`AmazonDynamoDB`, `AmazonSQS`, `AmazonSNS`, `AWSLambda`, `AmazonBedrock`, `AmazonS3`, `ElasticLoadBalancing`, etc.) and 470 resources.
- **`simple-icons`**: 3,000+ technology and brand SVGs (`redis`, `apachekafka`, `postgresql`, `mongodb`, `docker`, `kubernetes`, `nginx`, etc.).
- **`lucide-static`**: Vector UI icons.

---

## 4. Strict Anti-Overlap & Layout Rules
1. **The 3-Word Maximum Rule**: No node label, badge, or canvas text may exceed 3 words or 22 characters. Sentences belong only in voiceovers and the single bottom subtitle bar.
2. **Exclusive Scene Phases**: Never render two text banners or overlapping node groups in the same vertical zone at the same frame. Every element must have explicit `[enterFrame, exitFrame]` with 18-frame morphing or clean exit.
3. **The 5-Slot Vertical Safe Grid (`1080x1920`)**:
   - `ZONE 0` (Header Bar, `y: 100–220`): Single active phase title (`max 4 words`).
   - `ZONE 1` (Top Tier / Producers, `y: 340–520`): Max 3 columns (`x: 220`, `x: 540`, `x: 860`).
   - `ZONE 2` (Middle Tier / Routers / Buses, `y: 720–920`): Max 2 columns (`x: 320`, `x: 760`) or 1 centered hero node (`x: 540`).
   - `ZONE 3` (Bottom Tier / Consumers / Storage, `y: 1120–1360`): Max 3 columns (`x: 220`, `x: 540`, `x: 860`).
   - `ZONE 4` (Reserved Lower-Third Subtitle Safe Zone, `y: 1560–1780`): NO diagram nodes or arrows may ever enter `y > 1480`.

---

## 5. Kinetic Choreography (Show, Don't Tell)
1. **Clone & Fly**: Animate data pills flying smoothly out of source nodes and into target buffers.
2. **Queue Pile-Up & Shake**: Animate red dots clustering at bottlenecks while the node vibrates (`Math.sin(frame * 1.5) * 5px`).
3. **Box Split / Fan-Out**: Start with 1 router, slice it, and fan out traffic to parallel consumer lanes.
4. **Foreign Key / Index Pointer Tracing**: Animate glowing curved bezier arrows connecting related entities.
