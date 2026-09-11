# RED Visualisation Studio v6.3 - GitHub Pages refinement release

Static browser viewer for River Earthworks Designer (RED) `.redviz.zip` visualisation packages.

This bundle is intended to be hosted as a **standalone website** (for example on GitHub Pages) so external reviewers can open the viewer in a normal browser without needing ChatGPT access.

## What this release is for

Use this repository when you want to:
- host the viewer publicly or behind your own organisation controls
- share a normal web link with clients, regulators or partners
- keep RED plugin development separate from the web visualisation frontend
- allow reviewers to open a `.redviz.zip` package locally in the browser

## Key features

- Opens RED visualisation packages with schema `red-visualisation-package/1` and `/2`
- Uses packaged **aerial textures** when available
- Falls back to per-vertex imagery colours for older packages
- Separate layer controls for:
  - Proposed terrain
  - Existing terrain
  - Pile fields
  - Rock
  - Large Wood
  - Breaklines
  - Aerial texture
  - Wireframe
- Surface colour modes for design elements, elevation, cut/fill and slope
- Water surface controls with level, opacity, appearance and terrain-clipped extent
- Presentation-only material controls for rock and timber
- Presentation-only vegetation for early establishment and established-condition visuals
- Presentation-only enhanced rootwad detail
- Photo alignment workspace with high-resolution export
- Saved viewpoints and downloadable view metadata

## Privacy and data handling

The site is designed so that RED packages are opened **locally in the user's browser**.
Project files do not need to be uploaded to a server for normal use.

Recommended wording to retain in the UI and project documentation:

> Files stay in this browser. Appearance controls do not alter RED engineering geometry.

## Engineering boundary

All presentation enhancements are visual only. The site must not alter:
- RED geometry
- RLs
- dimensions
- footprints
- topology
- quantities
- engineering metadata

## Repository contents

- `index.html` - site entry point
- `app.js` - application UI and package handling
- `viewer.js` - WebGL renderer
- `viewer_canvas2d.js` - software/canvas fallback renderer
- `viewer.css` / `app.css` - styling
- `validate.js` - static contract check
- `.github/workflows/deploy-pages.yml` - optional GitHub Pages deployment workflow
- `QA_CHECKLIST.md` - deployment and acceptance checklist
- `DEPLOY_GITHUB_PAGES.md` - quick deployment instructions
- `VERSION.json` - release metadata

## Quick start locally

Open `index.html` in a browser or serve the folder with a simple static file server.
Then use **Open RED package** and select a `.redviz.zip` file.

## GitHub Pages deployment

### Option A - simplest
Upload the repository to GitHub and configure Pages to publish from the repository root.

### Option B - Actions workflow
This repository includes a GitHub Actions workflow under `.github/workflows/deploy-pages.yml`.
Enable GitHub Pages and choose **GitHub Actions** as the publishing source.

See `DEPLOY_GITHUB_PAGES.md` for step-by-step instructions.

## New in v6.3

- **Review priority** control with realistic depth, proposed-terrain priority and structures priority. The priority modes are explicit review aids that let cut surfaces, buried rock and other structures remain visible without changing RED geometry.
- **High-resolution aerial texture on proposed terrain** in Design elements view, removing the mismatch where surrounding context was sharp but the design footprint fell back to coarse vertex imagery.
- **Terrain-clipped water** is now the default. The viewer clips water to triangles below the entered water RL instead of drawing a rectangular plane across the whole scene. The simple plane remains available as a fallback.
- **Illustrative rock clasts** add presentation-only low-poly rock texture over exported rock meshes.
- **Revegetation-footprint hook**: if a future RED package exports a `revegetation` / `revegetation_area` mesh, establishment vegetation is generated from that footprint instead of the entire design surface.

See `RED_EXPORT_CONTRACT_v6_2.md` for the proposed RED-side revegetation and rock metadata hooks.


## Recommended repository metadata

- **Name:** `red-visualisation-studio`
- **Description:** Browser-based 3D visualisation viewer for River Earthworks Designer (RED) packages. Project files are processed locally in the browser.
- **Suggested future domain:** `visualise.alluvium.com.au`

See `GITHUB_SETUP.md` for the complete setup sequence.


## v6.3 refinement pass

- Added **Reveal proposed cut footprint** to mask existing-terrain triangles only where they overlap the proposed design footprint. This makes cut designs visible without fading the entire existing surface.
- Reworked illustrative rock clasts into more irregular faceted boulders and added clast size / coverage controls.
- Added manual directional crop controls to terrain-clipped water.
- Added support for a future RED-exported `water_extent` footprint.
- Retained support for a future RED-exported `revegetation_area` footprint.

All masking, clasts, water and vegetation remain presentation-only.


## v6.4 refinements
- Proposed design opacity now applies to proposed terrain, piles, rock, Large Wood and illustrative vegetation.
- 0% is a true zero. When the reveal-cut-footprint review mask is selected, releasing the slider at 0% rebuilds the scene without masking the underlying existing surface.
- Water appearance presets now use distinct base colours and effective opacity: Clear, River, and Flood/turbid.


## v6.4.1 hotfix

- Pile-field alignment/guide lines now inherit the **Pile fields** visibility control.
- Pile scour/protection guide lines inherit the **Rock** visibility control.
- Exported `layer_group` metadata is honoured for linework before role-based fallback.
