(function(){
"use strict";
const $=id=>document.getElementById(id);
const state={manifest:null,scene:null,cameras:{},packageName:"",urls:[],waterVisible:false,baseScene:null,photoUrl:"",photoMatches:{},photoFront:false};
function status(msg){$("packageStatus").textContent=msg;}
function clone(o){return JSON.parse(JSON.stringify(o));}
function revoke(){state.urls.forEach(URL.revokeObjectURL);state.urls=[];}
function findEOCD(view){for(let i=view.byteLength-22;i>=Math.max(0,view.byteLength-65557);i--){if(view.getUint32(i,true)===0x06054b50)return i;}return -1;}
function utf8(bytes){return new TextDecoder("utf-8").decode(bytes);}
async function inflateRaw(bytes){const ds=new DecompressionStream("deflate-raw");const stream=new Blob([bytes]).stream().pipeThrough(ds);return new Uint8Array(await new Response(stream).arrayBuffer());}
async function unzip(file){const buf=await file.arrayBuffer(),view=new DataView(buf),eocd=findEOCD(view);if(eocd<0)throw new Error("Not a valid ZIP archive.");const count=view.getUint16(eocd+10,true),cdOffset=view.getUint32(eocd+16,true),entries={};let p=cdOffset;for(let n=0;n<count;n++){if(view.getUint32(p,true)!==0x02014b50)throw new Error("ZIP directory is corrupt.");const method=view.getUint16(p+10,true),comp=view.getUint32(p+20,true),nameLen=view.getUint16(p+28,true),extraLen=view.getUint16(p+30,true),commentLen=view.getUint16(p+32,true),local=view.getUint32(p+42,true);const name=utf8(new Uint8Array(buf,p+46,nameLen));const localName=view.getUint16(local+26,true),localExtra=view.getUint16(local+28,true),start=local+30+localName+localExtra;const compressed=new Uint8Array(buf,start,comp);let data;if(method===0)data=compressed;else if(method===8)data=await inflateRaw(compressed);else throw new Error("Unsupported ZIP compression method: "+method);entries[name]=data;p+=46+nameLen+extraLen+commentLen;}return entries;}
function jsonEntry(entries,name){if(!entries[name])throw new Error("Package is missing "+name);return JSON.parse(utf8(entries[name]));}
function makeTextureUrl(entries,scene){const meta=scene&&scene.imagery&&scene.imagery.texture;if(!meta||!meta.path||!entries[meta.path])return false;const blob=new Blob([entries[meta.path]],{type:meta.format||"image/jpeg"});const url=URL.createObjectURL(blob);state.urls.push(url);scene.imagery.texture.path=url;return true;}
function waterColour(){const style=$("waterStyle").value;return style==="flood"?"#756a45":style==="river"?"#2f7186":"#58b7d4";}
function waterOpacityForStyle(base){const style=$("waterStyle").value;if(style==="clear")return Math.max(.08,base*.72);if(style==="flood")return Math.min(.92,base*1.18);return base;}
function clipTriangleBelowWater(a,b,c,z){
  let poly=[a,b,c];
  const out=[];
  for(let i=0;i<poly.length;i++){
    const curr=poly[i],next=poly[(i+1)%poly.length];
    const currIn=curr[2]<=z,nextIn=next[2]<=z;
    if(currIn)out.push(curr);
    if(currIn!==nextIn){
      const dz=next[2]-curr[2];
      const t=Math.abs(dz)<1e-12?0:(z-curr[2])/dz;
      out.push([curr[0]+(next[0]-curr[0])*t,curr[1]+(next[1]-curr[1])*t,z]);
    }
  }
  return out;
}
function terrainWaterMesh(scene,z,crop){
  const meshes=scene.meshes||[];
  const source=meshes.find(m=>m.role==="existing_imagery_full"&&Array.isArray(m.positions)&&Array.isArray(m.indices))||
    meshes.find(m=>(m.role==="existing_context"||m.role==="existing")&&Array.isArray(m.positions)&&Array.isArray(m.indices))||
    meshes.find(m=>m.role==="design"&&Array.isArray(m.positions)&&Array.isArray(m.indices));
  const positions=[],indices=[];let kept=0;
  if(!source)return {positions,indices,kept};
  const pts=source.positions,idx=source.indices,maxTriangles=220000;
  for(let k=0;k+2<idx.length&&kept<maxTriangles;k+=3){
    const ia=Number(idx[k])*3,ib=Number(idx[k+1])*3,ic=Number(idx[k+2])*3;
    if(ic+2>=pts.length)continue;
    const a=[Number(pts[ia])||0,Number(pts[ia+1])||0,Number(pts[ia+2])||0];
    const b=[Number(pts[ib])||0,Number(pts[ib+1])||0,Number(pts[ib+2])||0];
    const c=[Number(pts[ic])||0,Number(pts[ic+1])||0,Number(pts[ic+2])||0];
    const cx=(a[0]+b[0]+c[0])/3,cy=(a[1]+b[1]+c[1])/3;if(crop&&(cx<crop.x0||cx>crop.x1||cy<crop.y0||cy>crop.y1))continue;
    const poly=clipTriangleBelowWater(a,b,c,z);
    if(poly.length<3)continue;
    const base=positions.length/3;
    for(const q of poly)positions.push(q[0],q[1],z);
    for(let j=1;j+1<poly.length;j++){indices.push(base,base+j,base+j+1);kept++;}
  }
  return {positions,indices,kept};
}
function waterCropBounds(scene){
  const b=scene.bounds||{},min=b.minimum||[-10,-10,0],max=b.maximum||[10,10,1],dx=max[0]-min[0],dy=max[1]-min[1];
  const wx=(Number($("waterXMin").value)||0)/100,ex=(Number($("waterXMax").value)||0)/100,sy=(Number($("waterYMin").value)||0)/100,ny=(Number($("waterYMax").value)||0)/100;
  return {x0:min[0]+dx*wx,x1:max[0]-dx*ex,y0:min[1]+dy*sy,y1:max[1]-dy*ny};
}
function redWaterFootprint(scene,z,op){
  const source=(scene.meshes||[]).find(m=>(m.role==="water_extent"||m.role==="water_area"||m.layer_group==="water_extent"||/water[ _-]?(extent|area|footprint)/i.test(String(m.id||"")+" "+String(m.label||"")))&&Array.isArray(m.positions)&&Array.isArray(m.indices));
  if(!source)return null;const positions=source.positions.slice();for(let i=2;i<positions.length;i+=3)positions[i]=z;
  return {id:"studio-water",label:"RED water footprint",role:"water",positions,indices:source.indices.slice(),base_color:waterColour(),opacity:op,visible:true,metadata:{presentation_only:true,water_level_ahd:(Number($("waterLevel").value)||0),extent:"red",source_id:source.id||"",water_style:$("waterStyle").value}};
}
function addWater(scene){
  scene.meshes=(scene.meshes||[]).filter(m=>m.id!=="studio-water");if(!state.waterVisible)return;
  const b=scene.bounds||{},min=b.minimum||[-10,-10,0],max=b.maximum||[10,10,1],origin=scene.origin||{z:0};
  const ahd=Number($("waterLevel").value)||0,z=ahd-(Number(origin.z)||0),baseOp=(Number($("waterOpacity").value)||38)/100,op=waterOpacityForStyle(baseOp),extent=$("waterExtent").value,crop=waterCropBounds(scene),sourceStatus=$("waterSource");
  if(extent==="red"){const red=redWaterFootprint(scene,z,op);if(red){scene.meshes.push(red);if(sourceStatus)sourceStatus.textContent="Water source: RED water footprint";return;}if(sourceStatus)sourceStatus.textContent="RED water footprint not present - using terrain clipping";}
  if(extent==="terrain"||extent==="red"){const clipped=terrainWaterMesh(scene,z,crop);if(clipped.indices.length){scene.meshes.push({id:"studio-water",label:"Terrain-clipped water surface",role:"water",positions:clipped.positions,indices:clipped.indices,base_color:waterColour(),opacity:op,visible:true,metadata:{presentation_only:true,water_level_ahd:ahd,extent:"terrain",triangles:clipped.kept,crop,water_style:$("waterStyle").value}});if(sourceStatus&&extent!=="red")sourceStatus.textContent="Water source: terrain clipping";return;}}
  if(sourceStatus)sourceStatus.textContent="Water source: simple plane";
  const inset=(Number($("waterInset").value)||0)/100,dx=(max[0]-min[0])*inset,dy=(max[1]-min[1])*inset,x0=min[0]+dx,x1=max[0]-dx,y0=min[1]+dy,y1=max[1]-dy;
  scene.meshes.push({id:"studio-water",label:"Water surface",role:"water",positions:[x0,y0,z,x1,y0,z,x1,y1,z,x0,y1,z],indices:[0,1,2,0,2,3],base_color:waterColour(),opacity:op,visible:true,metadata:{presentation_only:true,water_level_ahd:ahd,extent:"plane",water_style:$("waterStyle").value}});
}

function frac(v){return v-Math.floor(v);}
function seeded01(x,y,z,salt){return frac(Math.sin(x*12.9898+y*78.233+z*37.719+salt*19.19)*43758.5453);}
function addConeGeometry(positions,indices,cx,cy,cz,radius,height,sides){
  const first=positions.length/3;
  const n=Math.max(3,sides||5);
  for(let i=0;i<n;i++){
    const a=i*Math.PI*2/n;
    positions.push(cx+Math.cos(a)*radius,cy+Math.sin(a)*radius,cz);
  }
  const top=positions.length/3;positions.push(cx,cy,cz+height);
  for(let i=0;i<n;i++){indices.push(first+i,first+((i+1)%n),top);}
}
function addStemGeometry(positions,indices,cx,cy,cz,radius,height){
  const first=positions.length/3,sides=5;
  for(let ring=0;ring<2;ring++){
    const z=cz+(ring?height:0);
    for(let i=0;i<sides;i++){
      const a=i*Math.PI*2/sides;positions.push(cx+Math.cos(a)*radius,cy+Math.sin(a)*radius,z);
    }
  }
  for(let i=0;i<sides;i++){const j=(i+1)%sides;indices.push(first+i,first+j,first+sides+j,first+i,first+sides+j,first+sides+i);}
}

function addBoulderGeometry(positions,indices,cx,cy,cz,rx,ry,rz,seed){
  const b=positions.length/3,n=6,angle=seeded01(cx,cy,cz,seed)*Math.PI;
  for(let ring=0;ring<2;ring++){const z=cz+(ring?rz*.72:-rz*.22);for(let i=0;i<n;i++){const ang=angle+i*Math.PI*2/n;const jitter=.76+seeded01(cx+i,cy+ring,cz,seed+i*7)*.42;positions.push(cx+Math.cos(ang)*rx*jitter,cy+Math.sin(ang)*ry*jitter,z+(seeded01(cx,cy,cz,seed+i+30)-.5)*rz*.18);}}
  const top=positions.length/3;positions.push(cx,cy,cz+rz*(.88+seeded01(cx,cy,cz,seed+77)*.2));
  const bottom=positions.length/3;positions.push(cx,cy,cz-rz*.28);
  for(let i=0;i<n;i++){const j=(i+1)%n;indices.push(b+i,b+j,b+n+j,b+i,b+n+j,b+n+i);indices.push(b+n+i,b+n+j,top);indices.push(b+j,b+i,bottom);}
}
function addRockClasts(scene){
  scene.meshes=(scene.meshes||[]).filter(m=>m.id!=="studio-rock-clasts");
  if(!$("rockClasts").checked)return;
  const rocks=(scene.meshes||[]).filter(m=>(m.layer_group==="rock"||/rock|scour/i.test(String(m.role||"")+" "+String(m.id||"")))&&Array.isArray(m.positions)&&Array.isArray(m.indices));
  const positions=[],indices=[];let made=0;const density=(Number($("rockClastDensity").value)||85)/100,sizeScale=(Number($("rockClastSize").value)||100)/100,maxClasts=Math.round(900*Math.max(.25,density));
  for(const rock of rocks){const pts=rock.positions,idx=rock.indices;const target=Math.max(35,Math.min(340,Math.round((idx.length/9)*density)));const triStep=Math.max(3,Math.floor(idx.length/Math.max(1,target)/3)*3);for(let k=0;k+2<idx.length&&made<maxClasts;k+=triStep){const ia=idx[k]*3,ib=idx[k+1]*3,ic=idx[k+2]*3;if(ic+2>=pts.length)continue;const cx=(pts[ia]+pts[ib]+pts[ic])/3,cy=(pts[ia+1]+pts[ib+1]+pts[ic+1])/3,cz=(pts[ia+2]+pts[ib+2]+pts[ic+2])/3;const e1=Math.hypot((pts[ib]-pts[ia])||0,(pts[ib+1]-pts[ia+1])||0,(pts[ib+2]-pts[ia+2])||0),e2=Math.hypot((pts[ic]-pts[ia])||0,(pts[ic+1]-pts[ia+1])||0,(pts[ic+2]-pts[ia+2])||0);const base=Math.max(.11,Math.min(.9,(e1+e2)*.12))*sizeScale;const s1=.78+seeded01(cx,cy,cz,made+11)*.58,s2=.72+seeded01(cx,cy,cz,made+21)*.5,s3=.5+seeded01(cx,cy,cz,made+31)*.55;addBoulderGeometry(positions,indices,cx,cy,cz+base*.06,base*s1,base*s2,base*s3,made+17);made++;}}
  if(indices.length)scene.meshes.push({id:"studio-rock-clasts",label:"Illustrative rock clasts",role:"rock_presentation",layer_group:"rock",positions,indices,base_color:"#77736a",opacity:1,visible:true,metadata:{presentation_only:true,illustrative:true,count:made,size_scale:sizeScale,coverage:density}});
}

function addRootwadDetail(scene){
  scene.meshes=(scene.meshes||[]).filter(m=>m.id!=="studio-rootwad-detail");
  if(!$('rootwadDetail').checked)return;
  const roots=(scene.meshes||[]).filter(m=>String(m.role||"").indexOf("rootball")>=0&&Array.isArray(m.positions)&&m.positions.length>=3);
  if(!roots.length)return;
  const positions=[],indices=[];
  let rootIndex=0;
  roots.forEach(root=>{
    const pts=root.positions;let cx=0,cy=0,cz=0,n=0,minx=Infinity,miny=Infinity,minz=Infinity,maxx=-Infinity,maxy=-Infinity,maxz=-Infinity;
    for(let i=0;i+2<pts.length;i+=3){const x=Number(pts[i])||0,y=Number(pts[i+1])||0,z=Number(pts[i+2])||0;cx+=x;cy+=y;cz+=z;n++;minx=Math.min(minx,x);miny=Math.min(miny,y);minz=Math.min(minz,z);maxx=Math.max(maxx,x);maxy=Math.max(maxy,y);maxz=Math.max(maxz,z);}
    if(!n)return;cx/=n;cy/=n;cz/=n;
    const span=Math.max(maxx-minx,maxy-miny,maxz-minz,0.35);
    const count=10;
    for(let k=0;k<count;k++){
      const a=(k/count)*Math.PI*2+seeded01(cx,cy,cz,k)*0.45;
      const len=span*(0.35+seeded01(cx,cy,cz,k+21)*0.55);
      const ex=cx+Math.cos(a)*len,ey=cy+Math.sin(a)*len,ez=cz+(seeded01(cx,cy,cz,k+41)-0.38)*span*0.7;
      const wx=-Math.sin(a)*span*0.055,wy=Math.cos(a)*span*0.055;
      const first=positions.length/3;
      positions.push(cx-wx,cy-wy,cz, cx+wx,cy+wy,cz, ex,ey,ez);
      indices.push(first,first+1,first+2);
    }
    rootIndex++;
  });
  if(indices.length)scene.meshes.push({id:"studio-rootwad-detail",label:"Enhanced rootwad detail",role:"large_wood_rootball_detail",layer_group:"large_wood",positions,indices,base_color:"#3a2413",opacity:.96,visible:true,metadata:{presentation_only:true,illustrative:true,source_rootballs:rootIndex}});
}
function addVegetation(scene){
  scene.meshes=(scene.meshes||[]).filter(m=>m.id!=="studio-vegetation");
  const condition=$('condition').value;
  if(!$('vegetationToggle').checked || (condition!=="early"&&condition!=="established"))return;
  const reveg=(scene.meshes||[]).find(m=>(m.role==="revegetation"||m.role==="revegetation_area"||m.layer_group==="revegetation"||/reveg/i.test(String(m.id||"")+" "+String(m.label||"")))&&Array.isArray(m.positions));
  const design=reveg||(scene.meshes||[]).find(m=>m.role==="design"&&Array.isArray(m.positions));
  const src=$("revegetationSource");if(src)src.textContent=reveg?"Vegetation source: RED revegetation footprint":"Vegetation source: design-surface fallback";
  if(!design||design.positions.length<3)return;
  const density=Math.max(0,Math.min(1,Number($('vegetationDensity').value)/100));
  if(density<=0)return;
  const heightScale=Math.max(.2,Number($('vegetationHeight').value)/100);
  const style=$('vegetationStyle').value;
  const early=condition==="early";
  const vertexCount=Math.floor(design.positions.length/3);
  const target=Math.max(8,Math.min(early?130:260,Math.round((early?90:190)*density+25*density)));
  const stride=Math.max(1,Math.floor(vertexCount/Math.max(target*3,1)));
  const positions=[],indices=[];
  let made=0;
  for(let v=0;v<vertexCount&&made<target;v+=stride){
    const i=v*3,x=Number(design.positions[i])||0,y=Number(design.positions[i+1])||0,z=Number(design.positions[i+2])||0;
    const gate=seeded01(x,y,z,3.1);
    if(gate>density*0.92+0.08)continue;
    const jx=(seeded01(x,y,z,4.1)-.5)*1.3,jy=(seeded01(x,y,z,5.1)-.5)*1.3;
    const variation=.72+seeded01(x,y,z,6.1)*.62;
    let h=(early?0.35:1.15)*heightScale*variation;
    let r=(early?0.11:0.28)*heightScale*(.8+seeded01(x,y,z,7.1)*.5);
    if(style==="grass"){h*=.48;r*=.45;addConeGeometry(positions,indices,x+jx,y+jy,z+0.015,r,h,4);}
    else if(style==="shrub"){h*=.82;r*=1.35;addConeGeometry(positions,indices,x+jx,y+jy,z+0.015,r,h,6);}
    else{
      if(!early && seeded01(x,y,z,8.1)>.58){
        addStemGeometry(positions,indices,x+jx,y+jy,z+0.015,Math.max(.025,r*.14),h*.52);
        addConeGeometry(positions,indices,x+jx,y+jy,z+h*.42,r*1.25,h*.72,6);
      }else{
        addConeGeometry(positions,indices,x+jx,y+jy,z+0.015,r,h,5);
      }
    }
    made++;
  }
  if(indices.length){scene.meshes.push({id:"studio-vegetation",label:early?"Early establishment vegetation":"Established vegetation",role:"vegetation",layer_group:"vegetation",positions,indices,base_color:early?"#66884c":"#416f3a",opacity:1,visible:true,metadata:{presentation_only:true,illustrative:true,count:made,condition,style}});}
}
function pointInTri2D(px,py,a,b,c){const v0x=c[0]-a[0],v0y=c[1]-a[1],v1x=b[0]-a[0],v1y=b[1]-a[1],v2x=px-a[0],v2y=py-a[1],dot00=v0x*v0x+v0y*v0y,dot01=v0x*v1x+v0y*v1y,dot02=v0x*v2x+v0y*v2y,dot11=v1x*v1x+v1y*v1y,dot12=v1x*v2x+v1y*v2y,den=dot00*dot11-dot01*dot01;if(Math.abs(den)<1e-12)return false;const u=(dot11*dot02-dot01*dot12)/den,v=(dot00*dot12-dot01*dot02)/den;return u>=-.001&&v>=-.001&&u+v<=1.001;}
function maskExistingOverDesign(scene){
  if($("existingReveal").value!=="mask"||$("condition").value==="existing"||Number($("designOpacity").value)<=0)return;const design=(scene.meshes||[]).find(m=>m.role==="design"&&Array.isArray(m.positions)&&Array.isArray(m.indices));if(!design)return;const dp=design.positions,di=design.indices,tris=[];for(let k=0;k+2<di.length;k+=3){const ia=di[k]*3,ib=di[k+1]*3,ic=di[k+2]*3;if(ic+2>=dp.length)continue;const A=[dp[ia],dp[ia+1]],B=[dp[ib],dp[ib+1]],C=[dp[ic],dp[ic+1]];tris.push({A,B,C,minx:Math.min(A[0],B[0],C[0]),maxx:Math.max(A[0],B[0],C[0]),miny:Math.min(A[1],B[1],C[1]),maxy:Math.max(A[1],B[1],C[1])});}
  if(!tris.length)return;(scene.meshes||[]).forEach(m=>{if(!(m.role==="existing_imagery_full"||m.role==="existing_context"||m.role==="existing")||!Array.isArray(m.positions)||!Array.isArray(m.indices))return;const pts=m.positions,out=[];for(let k=0;k+2<m.indices.length;k+=3){const i0=m.indices[k],i1=m.indices[k+1],i2=m.indices[k+2],a=i0*3,b=i1*3,c=i2*3;if(c+2>=pts.length)continue;const x=(pts[a]+pts[b]+pts[c])/3,y=(pts[a+1]+pts[b+1]+pts[c+1])/3;let inside=false;for(const t of tris){if(x<t.minx||x>t.maxx||y<t.miny||y>t.maxy)continue;if(pointInTri2D(x,y,t.A,t.B,t.C)){inside=true;break;}}if(!inside)out.push(i0,i1,i2);}m.indices=out;m.metadata=Object.assign({},m.metadata||{},{presentation_masked_over_design:true});});
}
function loadCurrentScene(preserveCamera){if(!state.baseScene)return;const cam=preserveCamera&&window.RED3D?RED3D.getCamera():null;const scene=clone(state.baseScene);if(state.baseScene.imagery&&state.baseScene.imagery.texture&&state.baseScene.imagery.texture.path&&state.baseScene.imagery.texture.path.startsWith("blob:")){scene.imagery.texture.path=state.baseScene.imagery.texture.path;}maskExistingOverDesign(scene);addWater(scene);addRootwadDetail(scene);addRockClasts(scene);addVegetation(scene);state.scene=scene;RED3D.loadScene(scene);applyControls();if(cam)RED3D.setCamera(cam);}
function applyControls(){if(!window.RED3D)return;RED3D.setCondition($("condition").value);RED3D.setColorMode($("colorMode").value);RED3D.setLighting($("lighting").value);if(RED3D.setRenderPriority)RED3D.setRenderPriority($("renderPriority").value);RED3D.setVisibility("design",$("layerDesign").checked);RED3D.setVisibility("existing",$("layerExisting").checked);RED3D.setVisibility("piles",$("layerPiles").checked);RED3D.setVisibility("rock",$("layerRock").checked);RED3D.setVisibility("large_wood",$("layerWood").checked);RED3D.setVisibility("vegetation",$("vegetationToggle").checked);RED3D.setVisibility("breaklines",$("layerBreaklines").checked);RED3D.setVisibility("grid",$("layerGrid").checked);RED3D.setImageryVisible($("layerImagery").checked);RED3D.setWireframe($("layerWire").checked);RED3D.setOpacity("design",Number($("designOpacity").value)/100);RED3D.setOpacity("existing",Number($("existingOpacity").value)/100);if(RED3D.setImageryAdjustments)RED3D.setImageryAdjustments(Number($("imageryBrightness").value)/100,Number($("imagerySaturation").value)/100,Number($("imageryContrast").value)/100);if(RED3D.setMaterialOptions)RED3D.setMaterialOptions($("rockMaterial").value,$("timberMaterial").value,Number($("materialVariation").value)/100);}
function populateViews(){const select=$("savedViews");select.innerHTML='<option value="">Select a view</option>';Object.keys(state.cameras||{}).forEach(name=>{const o=document.createElement("option");o.value=name;o.textContent=name;select.appendChild(o);});}
async function openPackage(file){status("Opening package…");revoke();const entries=await unzip(file);const manifest=jsonEntry(entries,"manifest.json");if(!/^red-visualisation-package\/(1|2)$/.test(String(manifest.schema||"")))throw new Error("Unsupported RED package version.");const scene=jsonEntry(entries,"scene.json");const cameras=entries["camera_views.json"]?JSON.parse(utf8(entries["camera_views.json"])):{};const textured=makeTextureUrl(entries,scene);state.manifest=manifest;state.baseScene=scene;state.cameras=cameras||{};state.packageName=file.name;populateViews();loadCurrentScene(false);status(file.name+" · "+((scene.meshes||[]).length)+" meshes"+(textured?" · aerial texture loaded":" · vertex-colour imagery fallback"));}
function downloadDataUrl(dataUrl,name){const a=document.createElement("a");a.href=dataUrl;a.download=name;document.body.appendChild(a);a.click();a.remove();}
function updatePhoto(){const active=Boolean(state.photoUrl&&$("photoToggle").checked);const stage=$("photo-stage"),img=$("photo-overlay");stage.classList.toggle("active",active);stage.classList.toggle("crosshair",active&&$("photoCrosshair").checked);document.body.classList.toggle("photo-aligning",active);document.body.classList.toggle("photo-front",active&&state.photoFront);document.body.classList.toggle("photo-behind",active&&!state.photoFront);if(!active)return;img.style.opacity=String(Number($("photoOpacity").value)/100);img.style.transform=`translate(-50%,-50%) translate(${Number($("photoShiftX").value)}px,${Number($("photoShiftY").value)}px) rotate(${Number($("photoRotate").value)}deg) scale(${Number($("photoScale").value)/100})`;}
async function compositeExport(w,h){const sceneUrl=RED3D.exportImage?RED3D.exportImage(w,h):$("gl-canvas").toDataURL("image/png");if(!(state.photoUrl&&$("photoToggle").checked))return sceneUrl;const out=document.createElement("canvas");out.width=w;out.height=h;const ctx=out.getContext("2d");const photo=$("photo-overlay"),sceneImage=new Image();await new Promise((res,rej)=>{sceneImage.onload=res;sceneImage.onerror=rej;sceneImage.src=sceneUrl;});const scale=Number($("photoScale").value)/100;const photoRatio=photo.naturalWidth/photo.naturalHeight,outRatio=w/h;let dw,dh;if(photoRatio>outRatio){dh=h;dw=dh*photoRatio;}else{dw=w;dh=dw/photoRatio;}dw*=scale;dh*=scale;const sx=Number($("photoShiftX").value)*(w/Math.max($("viewport").clientWidth,1));const sy=Number($("photoShiftY").value)*(h/Math.max($("viewport").clientHeight,1));const rotation=Number($("photoRotate").value)*Math.PI/180;function drawPhoto(){ctx.save();ctx.globalAlpha=Number($("photoOpacity").value)/100;ctx.translate(w/2+sx,h/2+sy);ctx.rotate(rotation);ctx.drawImage(photo,-dw/2,-dh/2,dw,dh);ctx.restore();}if(state.photoFront){ctx.drawImage(sceneImage,0,0,w,h);drawPhoto();}else{drawPhoto();ctx.drawImage(sceneImage,0,0,w,h);}return out.toDataURL("image/png");}
$("openPackage").onclick=()=>$("fileInput").click();
$("fileInput").onchange=async e=>{const file=e.target.files&&e.target.files[0];if(!file)return;try{await openPackage(file);}catch(err){console.error(err);status("Could not open package: "+err.message);alert("Could not open package: "+err.message);}finally{e.target.value="";}};
["colorMode","lighting","renderPriority","existingReveal","layerDesign","layerExisting","layerPiles","layerRock","layerWood","layerBreaklines","layerGrid","layerImagery","layerWire","designOpacity","existingOpacity","imageryBrightness","imagerySaturation","imageryContrast","rockMaterial","timberMaterial","materialVariation"].forEach(id=>$(id).addEventListener("input",applyControls));$("designOpacity").addEventListener("change",()=>loadCurrentScene(true));$("condition").addEventListener("input",()=>loadCurrentScene(true));$("existingReveal").addEventListener("change",()=>loadCurrentScene(true));["vegetationToggle","vegetationStyle","vegetationDensity","vegetationHeight"].forEach(id=>$(id).addEventListener("input",()=>loadCurrentScene(true)));$("rootwadDetail").addEventListener("input",()=>loadCurrentScene(true));$("rockClasts").addEventListener("input",()=>loadCurrentScene(true));["rockClastSize","rockClastDensity"].forEach(id=>$(id).addEventListener("input",()=>loadCurrentScene(true)));
document.querySelectorAll("[data-camera]").forEach(btn=>btn.onclick=()=>RED3D.setCameraPreset(btn.dataset.camera));
$("savedViews").onchange=e=>{const c=state.cameras[e.target.value];if(c)RED3D.setCamera(c);};
$("saveView").onclick=()=>{if(!state.baseScene)return;const name=prompt("Viewpoint name:");if(!name)return;state.cameras[name]=RED3D.getCamera();populateViews();$("savedViews").value=name;};
$("downloadViews").onclick=()=>{const payload={views:state.cameras,photo_matches:state.photoMatches};const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"}),url=URL.createObjectURL(blob);state.urls.push(url);const a=document.createElement("a");a.href=url;a.download="RED_viewpoints.json";a.click();};
$("waterToggle").onchange=e=>{state.waterVisible=e.target.checked;loadCurrentScene(true);};
["waterLevel","waterStyle","waterExtent","waterInset","waterXMin","waterXMax","waterYMin","waterYMax"].forEach(id=>$(id).onchange=()=>{if(state.waterVisible)loadCurrentScene(true);});
$("waterOpacity").oninput=()=>{if(state.waterVisible)loadCurrentScene(true);};
$("openPhoto").onclick=()=>$("photoInput").click();
$("photoInput").onchange=e=>{const file=e.target.files&&e.target.files[0];if(!file)return;if(state.photoUrl)URL.revokeObjectURL(state.photoUrl);state.photoUrl=URL.createObjectURL(file);state.urls.push(state.photoUrl);$("photo-overlay").src=state.photoUrl;$("photoToggle").checked=true;$("photoStatus").textContent=file.name+" · alignment reference only";updatePhoto();e.target.value="";};
["photoToggle","photoOpacity","photoScale","photoRotate","photoShiftX","photoShiftY","photoCrosshair"].forEach(id=>$(id).addEventListener("input",updatePhoto));
$("savePhotoMatch").onclick=()=>{if(!state.photoUrl||!state.baseScene)return;const name=prompt("Photo match name:","Photo match 1");if(!name)return;state.photoMatches[name]={camera:RED3D.getCamera(),photo:{opacity:Number($("photoOpacity").value)/100,scale:Number($("photoScale").value)/100,rotation_deg:Number($("photoRotate").value),shift_x:Number($("photoShiftX").value),shift_y:Number($("photoShiftY").value),photo_front:state.photoFront}};state.cameras[name]=state.photoMatches[name].camera;populateViews();$("savedViews").value=name;$("photoStatus").textContent="Saved "+name+". Reference photo itself remains local to this browser.";};
$("exportPng").onclick=async()=>{if(!state.scene)return;const [w,h]=$("exportSize").value.split("x").map(Number);try{const data=await compositeExport(w,h);const base=(state.packageName||"RED_visualisation").replace(/\.redviz\.zip$|\.zip$/i,"");downloadDataUrl(data,base+"_"+w+"x"+h+".png");}catch(err){console.error(err);alert("Image export failed: "+err.message);}};
$("resetPhoto").onclick=()=>{$("photoOpacity").value=45;$("photoScale").value=100;$("photoRotate").value=0;$("photoShiftX").value=0;$("photoShiftY").value=0;state.photoFront=false;updatePhoto();};$("swapPhotoSide").onclick=()=>{state.photoFront=!state.photoFront;$("swapPhotoSide").classList.toggle("active",state.photoFront);updatePhoto();};$("presentationPreset").onclick=()=>{$("condition").value="construction";$("lighting").value="midday";$("colorMode").value="elements";$("rockMaterial").value="natural";$("timberMaterial").value="weathered";$("materialVariation").value=55;$("renderPriority").value="realistic";$("imageryBrightness").value=102;$("imagerySaturation").value=108;$("imageryContrast").value=108;$("layerWire").checked=false;applyControls();};window.addEventListener("beforeunload",revoke);
})();


const _hero=document.getElementById("openPackageHero");if(_hero)_hero.addEventListener("click",()=>document.getElementById("fileInput").click());
