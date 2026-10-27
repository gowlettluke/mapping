export const R=6378137, WORLD=2*Math.PI*R;
export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function mercator([lon,lat]) {return [R*lon*Math.PI/180,R*Math.log(Math.tan(Math.PI/4+clamp(lat,-85,85)*Math.PI/360))];}
export function lonLat([x,y]) {return [x/R*180/Math.PI,(2*Math.atan(Math.exp(y/R))-Math.PI/2)*180/Math.PI];}
export function projectedBounds([w,s,e,n]) {const a=mercator([w,s]),b=mercator([e,n]);return [...a,...b];}
export function geographicBounds([w,s,e,n]) {return [...lonLat([w,s]),...lonLat([e,n])];}
export function transform(extent,width,height) {return coord=>{const [x,y]=mercator(coord);return [(x-extent[0])/(extent[2]-extent[0])*width,(extent[3]-y)/(extent[3]-extent[1])*height];};}
export function pixelPoint(x,y,extent,width,height) {return lonLat([extent[0]+x/width*(extent[2]-extent[0]),extent[3]-y/height*(extent[3]-extent[1])]);}
export function fitExtent(extent,width,height,{minimumKm=0,padding=0}={}) {
  const cx=(extent[0]+extent[2])/2,cy=(extent[1]+extent[3])/2,lat=lonLat([cx,cy])[1];
  const minimum=minimumKm*1000/Math.max(.2,Math.cos(lat*Math.PI/180));
  let w=Math.max((extent[2]-extent[0])*(1+padding*2),minimum),h=Math.max((extent[3]-extent[1])*(1+padding*2),minimum*.78);
  if(w/h<width/height)w=h*width/height;else h=w*height/width;
  return [cx-w/2,cy-h/2,cx+w/2,cy+h/2];
}
export function lines(g) {
  if(!g)return [];
  switch(g.type){case 'Point':return [[g.coordinates]];case 'MultiPoint':return g.coordinates.map(p=>[p]);case 'LineString':return [g.coordinates];case 'MultiLineString':case 'Polygon':return g.coordinates;case 'MultiPolygon':return g.coordinates.flat();case 'GeometryCollection':return g.geometries.flatMap(lines);default:return [];}
}
const boundsCache=new WeakMap();
export function bounds(g) {
  if(!g || typeof g!=='object')return null;if(boundsCache.has(g))return boundsCache.get(g);
  let w=Infinity,s=Infinity,e=-Infinity,n=-Infinity;
  for(const line of lines(g))for(const [x,y] of line)if(Number.isFinite(x)&&Number.isFinite(y)){w=Math.min(w,x);s=Math.min(s,y);e=Math.max(e,x);n=Math.max(n,y);}
  const result=w===Infinity?null:[w,s,e,n];boundsCache.set(g,result);return result;
}
export const overlap=(a,b)=>Boolean(a&&b&&a[0]<=b[2]&&a[2]>=b[0]&&a[1]<=b[3]&&a[3]>=b[1]);
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function onSegment(p,a,b){return Math.abs(cross(a,b,p))<1e-10&&p[0]>=Math.min(a[0],b[0])-1e-10&&p[0]<=Math.max(a[0],b[0])+1e-10&&p[1]>=Math.min(a[1],b[1])-1e-10&&p[1]<=Math.max(a[1],b[1])+1e-10;}
export function inRing(point,ring,budget=()=>{}) {
  let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    budget();
    const a=ring[j],b=ring[i];if(onSegment(point,a,b))return 2;
    if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }return inside?1:0;
}
export function contains(point,g,budget=()=>{}) {
  if(g?.type==='GeometryCollection')return g.geometries.some(p=>contains(point,p,budget));
  const polygons=g?.type==='Polygon'?[g.coordinates]:g?.type==='MultiPolygon'?g.coordinates:[];
  return polygons.some(r=>r.length&&inRing(point,r[0],budget)&&!r.slice(1).some(h=>inRing(point,h,budget)===1));
}
export function intersects(a,b,budget=()=>{}) {
  if(!overlap(bounds(a),bounds(b)))return false;
  if(a.type==='GeometryCollection')return a.geometries.some(g=>intersects(g,b,budget));
  if(b.type==='GeometryCollection')return b.geometries.some(g=>intersects(a,g,budget));
  const al=lines(a),bl=lines(b);
  if(al.some(l=>l.some(p=>contains(p,b,budget)))||bl.some(l=>l.some(p=>contains(p,a,budget))))return true;
  for(const l of al)for(let i=1;i<l.length;i++)for(const m of bl)for(let j=1;j<m.length;j++){
    budget();const [p,q,r,s]=[l[i-1],l[i],m[j-1],m[j]];
    if(!overlap([Math.min(p[0],q[0]),Math.min(p[1],q[1]),Math.max(p[0],q[0]),Math.max(p[1],q[1])],[Math.min(r[0],s[0]),Math.min(r[1],s[1]),Math.max(r[0],s[0]),Math.max(r[1],s[1])]))continue;
    if((cross(p,q,r)*cross(p,q,s)<0&&cross(r,s,p)*cross(r,s,q)<0)||onSegment(p,r,s)||onSegment(q,r,s)||onSegment(r,p,q)||onSegment(s,p,q))return true;
  }return false;
}
export function path(ctx,g,project) {
  const polygon=['Polygon','MultiPolygon'].includes(g?.type);
  if(g?.type==='GeometryCollection'){g.geometries.forEach(c=>path(ctx,c,project));return;}
  for(const line of lines(g)){line.forEach((p,i)=>{const [x,y]=project(p);i?ctx.lineTo(x,y):ctx.moveTo(x,y);});if(polygon)ctx.closePath();}
}
export function lgaName(feature) {const p=feature.properties||{};return String(p.lga||p.lga_name||p.LGA_NAME||p.LGA_NAME24||p.local_government||p.name||'').trim();}
export function scaleBar(extent,width) {const lat=lonLat([(extent[0]+extent[2])/2,(extent[1]+extent[3])/2])[1],mpp=(extent[2]-extent[0])/width*Math.cos(lat*Math.PI/180),target=mpp*Math.min(190,width*.18)/1000,power=10**Math.floor(Math.log10(target)),km=[1,2,5,10].map(n=>n*power).filter(n=>n<=target).at(-1)||power;return {km,pixels:km*1000/mpp};}
