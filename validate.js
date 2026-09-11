const fs = require('fs');
const path = require('path');
const root = __dirname;
const html = fs.readFileSync(path.join(root,'index.html'),'utf8');
const app = fs.readFileSync(path.join(root,'app.js'),'utf8');
const viewer = fs.readFileSync(path.join(root,'viewer.js'),'utf8');
const fallback = fs.readFileSync(path.join(root,'viewer_canvas2d.js'),'utf8');
const requiredIds = ['openPackageHero','layerRock','layerWood','layerImagery','imageryBrightness','imagerySaturation','imageryContrast','rockMaterial','timberMaterial','materialVariation','rootwadDetail','presentationPreset','renderPriority','rockClasts','vegetationToggle','vegetationStyle','vegetationDensity','vegetationHeight','waterToggle','waterLevel','waterOpacity','waterStyle','waterExtent','waterInset','openPhoto','photoToggle','photoOpacity','photoScale','photoRotate','photoShiftX','photoShiftY','photoCrosshair','resetPhoto','swapPhotoSide','exportPng'];
for (const id of requiredIds) { if (!html.includes(`id="${id}"`)) throw new Error(`Missing HTML control ${id}`); }
for (const token of ['setVisibility("rock"','setVisibility("large_wood"','setVisibility("vegetation"','setImageryAdjustments','setMaterialOptions','compositeExport','savePhotoMatch','photoRotate','waterInset','presentationPreset','addVegetation','studio-vegetation','addRockClasts','studio-rock-clasts','terrainWaterMesh','waterExtent','setRenderPriority','addRootwadDetail','studio-rootwad-detail']) { if (!app.includes(token)) throw new Error(`Missing app contract ${token}`); }
for (const token of ['getLayerGroups','buildTextureCoordinates','u_textureBrightness','u_textureSaturation','u_textureContrast','u_materialKind','u_materialVariation','redHash','materialBase','materialNoise','setImageryAdjustments','setMaterialOptions','exportImage','EXT_texture_filter_anisotropic','mesh.role === "vegetation"','setRenderPriority','renderPriority','mesh.role === "design" && state.imageryVisible']) { if (!viewer.includes(token)) throw new Error(`Missing viewer contract ${token}`); }
if (!fallback.includes('vegetation: true')) throw new Error('Canvas fallback missing vegetation visibility state');
for (const token of ['drag-active','public-welcome','privacy-card']) { if (!html.includes(token) && !fs.readFileSync(path.join(root,'app.css'),'utf8').includes(token)) throw new Error(`Missing v6.2 public UI contract ${token}`); }
console.log('RED Visualisation Studio v6.2 static contract: PASS');
