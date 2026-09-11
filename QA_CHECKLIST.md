# RED Visualisation Studio v6 - QA checklist

## Static validation
- [ ] `node --check app.js`
- [ ] `node --check viewer.js`
- [ ] `node --check viewer_canvas2d.js`
- [ ] `node validate.js`

## GitHub Pages deployment
- [ ] Repository created
- [ ] All source files uploaded to repository root
- [ ] Pages enabled
- [ ] Published URL opens successfully
- [ ] `.nojekyll` present

## Functional checks
- [ ] Open a valid `.redviz.zip`
- [ ] Open schema `/1` package
- [ ] Open schema `/2` package
- [ ] Aerial texture loads when present
- [ ] Vertex-colour imagery fallback works
- [ ] Rock and Large Wood appear as separate toggles
- [ ] Pile fields toggle works
- [ ] Breaklines toggle works
- [ ] Wireframe toggle works
- [ ] Water level / opacity / style controls work
- [ ] Photo alignment loads a local image
- [ ] Saved viewpoints work
- [ ] High-resolution PNG export works

## Boundary checks
- [ ] No engineering geometry is displaced by presentation effects
- [ ] Files remain local to browser during normal use
- [ ] Viewer remains usable in a normal external browser session

## v6.3 refinement acceptance
- [ ] Engineering / Design elements view shows sharp aerial texture over proposed terrain when Aerial texture is enabled
- [ ] Review priority = Realistic depth preserves normal occlusion
- [ ] Review priority = Proposed terrain priority exposes cut design without changing geometry
- [ ] Review priority = Structures priority exposes buried rock / Large Wood / piles for review
- [ ] Terrain-clipped water does not extend as a full rectangle across high banks
- [ ] Simple plane water mode remains available
- [ ] Illustrative rock clasts can be toggled independently
- [ ] UI reports design-surface fallback when no RED revegetation footprint exists
- [ ] Future revegetation-area mesh is preferred when present


## v6.3 targeted checks
- [ ] Existing terrain over design = Reveal proposed cut footprint exposes cut designs without fading the full existing terrain
- [ ] Switching to Existing condition restores the complete existing terrain
- [ ] Rock clast size control changes illustrative clast scale
- [ ] Rock clast coverage control changes illustrative clast density
- [ ] Terrain-clipped water responds to west/east/south/north crop controls
- [ ] RED water footprint mode falls back safely when no footprint is exported
- [ ] RED water footprint mode uses `water_extent` when present


## v6.4 checks
- [ ] Proposed opacity at 0% hides proposed terrain and structures
- [ ] Existing surface is restored beneath the design footprint at 0%
- [ ] Rock, piles and Large Wood fade with proposed opacity
- [ ] Clear / River / Flood water presets are visibly different
