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
function waterColour(){const style=$("waterStyle").value;return style==="flood"?"#6f7152":style==="river"?"#3d8290":"#4ca6c0";}
function addWater(scene){scene.meshes=(scene.meshes||[]).filter(m=>m.id!=="studio-water");if(!state.waterVisible)return;const b=scene.bounds||{},min=b.minimum||[-10,-10,0],max=b.maximum||[10,10,1],origin=scene.origin||{z:0};const ahd=Number($("waterLevel").value)||0,z=ahd-(Number(origin.z)||0),op=(Number($("waterOpacity").value)||38)/100,inset=(Number($("waterInset").value)||0)/100,dx=(max[0]-min[0])*inset,dy=(max[1]-min[1])*inset,x0=min[0]+dx,x1=max[0]-dx,y0=min[1]+dy,y1=max[1]-dy;scene.meshes.push({id:"studio-water",label:"Water surface",role:"water",positions:[x0,y0,z,x1,y0,z,x1,y1,z,x0,y1,z],indices:[0,1,2,0,2,3],base_color:waterColour(),opacity:op,visible:true,metadata:{presentation_only:true,water_level_ahd:ahd}});}

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
  const design=(scene.meshes||[]).find(m=>m.role==="design"&&Array.isArray(m.positions));
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
function loadCurrentScene(preserveCamera){if(!state.baseScene)return;const cam=preserveCamera&&window.RED3D?RED3D.getCamera():null;const scene=clone(state.baseScene);if(state.baseScene.imagery&&state.baseScene.imagery.texture&&state.baseScene.imagery.texture.path&&state.baseScene.imagery.texture.path.startsWith("blob:")){scene.imagery.texture.path=state.baseScene.imagery.texture.path;}addWater(scene);addRootwadDetail(scene);addVegetation(scene);state.scene=scene;RED3D.loadScene(scene);applyControls();if(cam)RED3D.setCamera(cam);}
function applyControls(){if(!window.RED3D)return;RED3D.setCondition($("condition").value);RED3D.setColorMode($("colorMode").value);RED3D.setLighting($("lighting").value);RED3D.setVisibility("design",$("layerDesign").checked);RED3D.setVisibility("existing",$("layerExisting").checked);RED3D.setVisibility("piles",$("layerPiles").checked);RED3D.setVisibility("rock",$("layerRock").checked);RED3D.setVisibility("large_wood",$("layerWood").checked);RED3D.setVisibility("vegetation",$("vegetationToggle").checked);RED3D.setVisibility("breaklines",$("layerBreaklines").checked);RED3D.setVisibility("grid",$("layerGrid").checked);RED3D.setImageryVisible($("layerImagery").checked);RED3D.setWireframe($("layerWire").checked);RED3D.setOpacity("design",Number($("designOpacity").value)/100);RED3D.setOpacity("existing",Number($("existingOpacity").value)/100);if(RED3D.setImageryAdjustments)RED3D.setImageryAdjustments(Number($("imageryBrightness").value)/100,Number($("imagerySaturation").value)/100,Number($("imageryContrast").value)/100);if(RED3D.setMaterialOptions)RED3D.setMaterialOptions($("rockMaterial").value,$("timberMaterial").value,Number($("materialVariation").value)/100);}
function populateViews(){const select=$("savedViews");select.innerHTML='<option value="">Select a view</option>';Object.keys(state.cameras||{}).forEach(name=>{const o=document.createElement("option");o.value=name;o.textContent=name;select.appendChild(o);});}
async function openPackage(file){status("Opening package…");revoke();const entries=await unzip(file);const manifest=jsonEntry(entries,"manifest.json");if(!/^red-visualisation-package\/(1|2)$/.test(String(manifest.schema||"")))throw new Error("Unsupported RED package version.");const scene=jsonEntry(entries,"scene.json");const cameras=entries["camera_views.json"]?JSON.parse(utf8(entries["camera_views.json"])):{};const textured=makeTextureUrl(entries,scene);state.manifest=manifest;state.baseScene=scene;state.cameras=cameras||{};state.packageName=file.name;populateViews();loadCurrentScene(false);status(file.name+" · "+((scene.meshes||[]).length)+" meshes"+(textured?" · aerial texture loaded":" · vertex-colour imagery fallback"));}
function downloadDataUrl(dataUrl,name){const a=document.createElement("a");a.href=dataUrl;a.download=name;document.body.appendChild(a);a.click();a.remove();}
function updatePhoto(){const active=Boolean(state.photoUrl&&$("photoToggle").checked);const stage=$("photo-stage"),img=$("photo-overlay");stage.classList.toggle("active",active);stage.classList.toggle("crosshair",active&&$("photoCrosshair").checked);document.body.classList.toggle("photo-aligning",active);document.body.classList.toggle("photo-front",active&&state.photoFront);document.body.classList.toggle("photo-behind",active&&!state.photoFront);if(!active)return;img.style.opacity=String(Number($("photoOpacity").value)/100);img.style.transform=`translate(-50%,-50%) translate(${Number($("photoShiftX").value)}px,${Number($("photoShiftY").value)}px) rotate(${Number($("photoRotate").value)}deg) scale(${Number($("photoScale").value)/100})`;}
async function compositeExport(w,h){const sceneUrl=RED3D.exportImage?RED3D.exportImage(w,h):$("gl-canvas").toDataURL("image/png");if(!(state.photoUrl&&$("photoToggle").checked))return sceneUrl;const out=document.createElement("canvas");out.width=w;out.height=h;const ctx=out.getContext("2d");const photo=$("photo-overlay"),sceneImage=new Image();await new Promise((res,rej)=>{sceneImage.onload=res;sceneImage.onerror=rej;sceneImage.src=sceneUrl;});const scale=Number($("photoScale").value)/100;const photoRatio=photo.naturalWidth/photo.naturalHeight,outRatio=w/h;let dw,dh;if(photoRatio>outRatio){dh=h;dw=dh*photoRatio;}else{dw=w;dh=dw/photoRatio;}dw*=scale;dh*=scale;const sx=Number($("photoShiftX").value)*(w/Math.max($("viewport").clientWidth,1));const sy=Number($("photoShiftY").value)*(h/Math.max($("viewport").clientHeight,1));const rotation=Number($("photoRotate").value)*Math.PI/180;function drawPhoto(){ctx.save();ctx.globalAlpha=Number($("photoOpacity").value)/100;ctx.translate(w/2+sx,h/2+sy);ctx.rotate(rotation);ctx.drawImage(photo,-dw/2,-dh/2,dw,dh);ctx.restore();}if(state.photoFront){ctx.drawImage(sceneImage,0,0,w,h);drawPhoto();}else{drawPhoto();ctx.drawImage(sceneImage,0,0,w,h);}return out.toDataURL("image/png");}
$("openPackage").onclick=()=>$("fileInput").click();
$("fileInput").onchange=async e=>{const file=e.target.files&&e.target.files[0];if(!file)return;try{await openPackage(file);}catch(err){console.error(err);status("Could not open package: "+err.message);alert("Could not open package: "+err.message);}finally{e.target.value="";}};
["colorMode","lighting","layerDesign","layerExisting","layerPiles","layerRock","layerWood","layerBreaklines","layerGrid","layerImagery","layerWire","designOpacity","existingOpacity","imageryBrightness","imagerySaturation","imageryContrast","rockMaterial","timberMaterial","materialVariation"].forEach(id=>$(id).addEventListener("input",applyControls));$("condition").addEventListener("input",()=>loadCurrentScene(true));["vegetationToggle","vegetationStyle","vegetationDensity","vegetationHeight"].forEach(id=>$(id).addEventListener("input",()=>loadCurrentScene(true)));$("rootwadDetail").addEventListener("input",()=>loadCurrentScene(true));
document.querySelectorAll("[data-camera]").forEach(btn=>btn.onclick=()=>RED3D.setCameraPreset(btn.dataset.camera));
$("savedViews").onchange=e=>{const c=state.cameras[e.target.value];if(c)RED3D.setCamera(c);};
$("saveView").onclick=()=>{if(!state.baseScene)return;const name=prompt("Viewpoint name:");if(!name)return;state.cameras[name]=RED3D.getCamera();populateViews();$("savedViews").value=name;};
$("downloadViews").onclick=()=>{const payload={views:state.cameras,photo_matches:state.photoMatches};const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"}),url=URL.createObjectURL(blob);state.urls.push(url);const a=document.createElement("a");a.href=url;a.download="RED_viewpoints.json";a.click();};
$("waterToggle").onchange=e=>{state.waterVisible=e.target.checked;loadCurrentScene(true);};
["waterLevel","waterStyle","waterInset"].forEach(id=>$(id).onchange=()=>{if(state.waterVisible)loadCurrentScene(true);});
$("waterOpacity").oninput=()=>{if(state.waterVisible)loadCurrentScene(true);};
$("openPhoto").onclick=()=>$("photoInput").click();
$("photoInput").onchange=e=>{const file=e.target.files&&e.target.files[0];if(!file)return;if(state.photoUrl)URL.revokeObjectURL(state.photoUrl);state.photoUrl=URL.createObjectURL(file);state.urls.push(state.photoUrl);$("photo-overlay").src=state.photoUrl;$("photoToggle").checked=true;$("photoStatus").textContent=file.name+" · alignment reference only";updatePhoto();e.target.value="";};
["photoToggle","photoOpacity","photoScale","photoRotate","photoShiftX","photoShiftY","photoCrosshair"].forEach(id=>$(id).addEventListener("input",updatePhoto));
$("savePhotoMatch").onclick=()=>{if(!state.photoUrl||!state.baseScene)return;const name=prompt("Photo match name:","Photo match 1");if(!name)return;state.photoMatches[name]={camera:RED3D.getCamera(),photo:{opacity:Number($("photoOpacity").value)/100,scale:Number($("photoScale").value)/100,rotation_deg:Number($("photoRotate").value),shift_x:Number($("photoShiftX").value),shift_y:Number($("photoShiftY").value),photo_front:state.photoFront}};state.cameras[name]=state.photoMatches[name].camera;populateViews();$("savedViews").value=name;$("photoStatus").textContent="Saved "+name+". Reference photo itself remains local to this browser.";};
$("exportPng").onclick=async()=>{if(!state.scene)return;const [w,h]=$("exportSize").value.split("x").map(Number);try{const data=await compositeExport(w,h);const base=(state.packageName||"RED_visualisation").replace(/\.redviz\.zip$|\.zip$/i,"");downloadDataUrl(data,base+"_"+w+"x"+h+".png");}catch(err){console.error(err);alert("Image export failed: "+err.message);}};
$("resetPhoto").onclick=()=>{$("photoOpacity").value=45;$("photoScale").value=100;$("photoRotate").value=0;$("photoShiftX").value=0;$("photoShiftY").value=0;state.photoFront=false;updatePhoto();};$("swapPhotoSide").onclick=()=>{state.photoFront=!state.photoFront;$("swapPhotoSide").classList.toggle("active",state.photoFront);updatePhoto();};$("presentationPreset").onclick=()=>{$("condition").value="construction";$("lighting").value="midday";$("colorMode").value="elements";$("rockMaterial").value="natural";$("timberMaterial").value="weathered";$("materialVariation").value=55;$("imageryBrightness").value=102;$("imagerySaturation").value=108;$("imageryContrast").value=108;$("layerWire").checked=false;applyControls();};window.addEventListener("beforeunload",revoke);
})();


const _hero=document.getElementById("openPackageHero");if(_hero)_hero.addEventListener("click",()=>document.getElementById("fileInput").click());
