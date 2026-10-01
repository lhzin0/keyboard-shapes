# KeyboardShapes

**Compare keyboards by shape and physical compatibility.** Not just a catalog: every case, PCB, plate and daughterboard is real geometry in millimetres, so you can see — in 2D and 3D — whether parts actually fit.

> *Resumo (pt-BR):* ferramenta web estática (GitHub Pages) para analisar teclados mecânicos: contornos 2D, modelo 3D paramétrico, camadas/explodido/corte, medição, sobreposição de formas, verificação de compatibilidade (furos, clearance, USB, plate, daughterboard) e importação por URL com **busca em vários sites e cruzamento de fontes**. Princípio central: *nunca inventar dados* — o que não se sabe fica `unknown`, e "parecido" nunca vira "compatível".

---

## Principles (what makes this different)

1. **Never invent data.** Every value carries a source, a method and a confidence. Unknown stays `null` / `unknown`; an estimate is never shown as official.
2. **Similar ≠ compatible.** Visual similarity and physical compatibility are separate engines. Compatibility needs geometric evidence; missing data yields `unknown`, never `compatible`.
3. **Precision levels** are shown everywhere: `official · cad · measured · reconstructed · estimated · unknown`.
4. **No circumvention.** CAPTCHAs, logins, rate limits, Cloudflare-style challenges and `robots.txt` are respected, never bypassed. When a site can't be read automatically the app says so and offers: paste the page HTML, upload images, or enter data manually.
5. **Agreement raises confidence, never precision.** Ten retailers repeating a number are still retailers; only a manufacturer source makes a value `official`.

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # 150+ tests: geometry, compatibility, import, lookup, 3D
npm run validate     # data/*.json: references, geometry, provenance rules
npm run build        # typecheck + production build (+ SPA fallback for GitHub Pages)
```

Node 20+ (developed on Node 24). No Python required.

## What is in the app

> **Right now only the 2D views and the Compare page are switched on.** The 3D viewer, Build, Import, compatibility checks and "find similar" are off; their code is intact and each comes back with one flag in `src/app/features.ts`. The table below describes everything the code can do.

| Area | Details |
| --- | --- |
| **Top / Side / Front views** (SVG, mm) | outlines, keys, mounting holes, USB, dimension lines, zoom/pan/pinch, fit / **1:1** (calibratable) / grid / ruler, two-click **measuring** with snapping |
| **3D viewer** (Three.js / R3F) | parametric case (wedge underside, real USB notch), PCB, plate (switch + stabilizer cutouts), switches, keycaps, daughterboard, foam, hardware; **layers** (visible / opacity / isolate), **exploded view** (proportional to height in the stack), **section view** (clipping planes), wireframe / x-ray, ortho / perspective, 3D measuring, collision markers; touch gestures on phones |
| **Compatibility engine** | dimensions, mounting-point registration (configurable tolerance), lateral + vertical clearance, USB alignment, plate cutouts/stabilizers, daughterboard connector/bay — each `ok · tight · incompatible · unknown`, deterministic |
| **Build your keyboard** | pick case / PCB / plate / switches / keycaps / daughterboard / foam; dropdowns show the verdict of each option against what you already chose |
| **Find compatible / Find similar** | reverse queries over the compatibility graph; similarity (outline IoU, size, aspect, corner radius, layout, angle, key positions) is a separate score |
| **Compare** | up to 6 items: top, front and side outlines on black, one scale in millimetres, each item in its own colour; front/side are real silhouettes only where heights are recorded, otherwise a dashed bounding box (overall height) or nothing |
| **Import** | from URL, pasted HTML, images or manually; **cross-check sites** (below); image → millimetre outline (calibrated), side image → height profile; preview, correct, confirm |
| **Search / filters** | brand, layout, width/depth/height/angle/keys, wireless, knob, mounting, material, component type, "compatible with…"; `327mm` matches dimensions |

## Multi-site lookup (cross-checking a keyboard)

```bash
npm run lookup -- --q="wooting 60he" --urls="https://wooting.io/wooting-60he,https://wooting.io/wooting-60he-v2" --json=lookup.json
npm run lookup -- --q="keychron q1" --add --layout="75%"      # create catalog records from the reconciled values
```

`data/sources.json` lists the shops and how they may be searched — **only public, documented, robots.txt-permitted endpoints**: Shopify predictive search / `products.json`, the WooCommerce Store API. Marketplaces and sites without such endpoints (AliExpress, Amazon, …) are used only through URLs you provide, and weigh less.

The reconciler (`src/import/CrossReference.ts`):

- weights sources by role (manufacturer > vendor > community > marketplace) × the measurement's own confidence × title relevance;
- **one voice per site** (two colour variants of one listing are not two confirmations);
- clusters numeric values (≈ 1.2 mm tolerance — editions of a product differ by more) and reports every disagreement instead of averaging it away;
- tells **editions** apart (`60HE+` / `v2` / `Max` / `ISO` …) and reconciles each separately;
- rejects accessories ("Plate", "Carrying Case") and other makers that merely share a model number;
- keeps *front height* and *back height* separate and derives the typing angle;
- never lets a retailer make a value "official".

The browser cannot search shops (CORS), so the search runs in Node (`npm run lookup`) or the **Lookup** GitHub Action; the web app loads the resulting JSON in *Import → Cross-check sites*.

## Layout of the repo

```
src/
  types/            central domain types (Keyboard, Case, PCB, Plate, Daughterboard, Shape, …)
  geometry/         2D toolkit (mm), registration, layouts, parametric reference parts, 3D generators
    3d/             CaseGenerator, PCBGenerator, PlateGenerator, SwitchGenerator, KeycapGenerator, KeyboardAssembly, export (GLB)
  compatibility/    CompatibilityEngine + Dimensions/Mounting/Clearance/USB/Plate/PCBCase/Daughterboard checks
  import/           ProductImporter, parsers, DimensionExtractor, ImageExtractor, LayoutDetector, ShapeReconstructor (+vision),
                    DraftBuilder, siteSearch, lookup, CrossReference
  viewer2d/ viewer3d/  SVG and WebGL viewers
  search/ filters/  catalog, query parsing, similarity, facets
  stores/ services/ Zustand stores, JSON database + compatibility graph
  pages/ components/ layouts/ app/   UI (CSS Modules, light/dark, mobile bottom nav + bottom sheets)
data/               versioned JSON "database" (keyboards, cases, pcbs, plates, switches, keycaps, daughterboards, stabilizers, foams, compatibility, sources)
geometry/           derived outlines / mounting / profiles / SVG previews (generated)
public/models/      generated, Draco-compressed GLB models
scripts/            CLIs (import-product, lookup, generate-*, optimize-models, validate-data, add-entity, extract-*, detect-layout, reconstruct-shape)
tests/              geometry · compatibility · import · lookup
.github/workflows/  deploy · validate · generate-models · lookup
```

## Conventions

- **Everything is millimetres.** Never pixels. Component frame: `x → right`, `y → toward the front` (SVG-like), origin = top-left of the outline; `y = 0` is the back (where USB usually is). The 3D mapping is `X = x, Y = up, Z = y`.
- Components never embed one another; a `Keyboard` references parts by id (`caseId`, `pcbId`, …).
- Typing angle: the whole assembly is built flat in the typing plane and tilted about the front-bottom edge; the case underside is a wedge so it rests flat on the desk.

## Data

The shipped catalog contains an **illustrative parametric reference set** (5 layouts: 60 / 65 / 75 / TKL / Full, plus variants that exercise every compatibility outcome) generated from ANSI key maps and nominal published dimensions (19.05 mm pitch, 14 mm MX cutouts, 5 mm plate-to-PCB…). It is **not** data about a commercial product and is marked `estimated` everywhere. Real products enter through the importer with their own provenance; imported records are `reconstructed` / `estimated` until someone supplies CAD or measurements. Imported key maps are the generic ANSI reference map for the layout name, not the product's actual key positions — the record says so.

Add data:

```bash
npm run keyboard:add -- --brand=Acme --model="Forge 65" --layout="65%" --width=325 --depth=115 --source=manufacturer --source-url=https://…
npm run component:add -- --type=pcb --file=my-pcb.json     # validated before it is written
npm run import -- --url="https://…" [--dry-run]            # one page
npm run lookup -- --q="…" --add                            # many sites, cross-checked
npm run validate && npm run generate && npm run generate:models && npm run optimize
```

## Import limits (read this)

- Browsers can only read pages that send CORS headers; most shops don't. Use the CLI / Action, *Paste page HTML*, image upload or manual entry.
- Sites with CAPTCHAs, logins or `robots.txt` disallow rules are reported as blocked. AliExpress, for example, answered the CLI with HTTP 403 and the browser with a reCAPTCHA — the app does not work around that.
- A product page gives overall dimensions and photos, never the inside of the case. Imported records therefore have no cavity / mounting points / cutouts, and compatibility for them is `unknown`.
- Image reconstruction needs a known dimension to calibrate and **rejects** results that contradict published numbers (e.g. an outline whose depth is > 15 % off). Nothing is auto-selected from a page's images unless the page declares it as the product's own image *and* its name says it is a top / side / blueprint view.

## 3D models

Source priority: **CAD → official GLB → reconstructed → parametric → estimated.** Parametric models are generated from the geometry in the browser; `npm run generate:models` also writes a GLB per keyboard (named nodes `layer/part`), `npm run optimize` dedupes / quantises / Draco-compresses them (~90 % smaller). Architecture leaves room for STL / OBJ / STEP / LiDAR / photogrammetry sources.

## Deploy (GitHub Pages)

`.github/workflows/deploy.yml` validates, tests, generates models, builds with `BASE_PATH=/<repo>/` and deploys. SPA routing works via a `404.html` copy of `index.html` (see `scripts/postbuild.mjs`). In the repository: *Settings → Pages → Source: GitHub Actions* (Pages on a private repository needs a paid plan; otherwise make the repository public).

## Accessibility & performance

ARIA roles/labels, keyboard navigation and focus states, 44 px touch targets on mobile, `prefers-reduced-motion`, light/dark themes. Route-level code splitting, lazy 3D viewer, demand-driven rendering, instanced switches/keycaps, memoised geometry, Draco GLBs.

## Known limitations

- Reference key maps exist for 40 / 60 / 65 / 75 / TKL / Full (ANSI). Other layouts can be recorded but are drawn without keys until a key map is added.
- USB alignment is checked horizontally along the wall; the vertical position of the cutout is not compared yet.
- Polygon offset (cavity fallback) is mitered: exact for convex shapes and rounded rectangles.
- The compatibility engine searches translation only (no rotation): a rotated part must be declared, not guessed.
- Lookup covers shops with public Shopify / WooCommerce endpoints; others need `--urls`.

## License

Code: MIT-style, see repository. Product names, images and specifications referenced in `data/` belong to their owners; the app stores links and extracted numbers with their sources, not copies of protected content.
