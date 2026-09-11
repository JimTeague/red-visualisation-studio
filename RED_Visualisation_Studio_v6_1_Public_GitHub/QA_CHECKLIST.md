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
