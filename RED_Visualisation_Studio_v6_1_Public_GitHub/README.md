# RED Visualisation Studio v6.1 - public GitHub Pages release bundle

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
- Water surface controls with level, opacity, appearance and extent inset
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

## Release note

v6.1 adds the first client-facing landing experience, drag-and-drop package opening, clearer local-processing/privacy messaging, deployment documentation and a release structure intended for external sharing.


## Recommended repository metadata

- **Name:** `red-visualisation-studio`
- **Description:** Browser-based 3D visualisation viewer for River Earthworks Designer (RED) packages. Project files are processed locally in the browser.
- **Suggested future domain:** `visualise.alluvium.com.au`

See `GITHUB_SETUP.md` for the complete setup sequence.
