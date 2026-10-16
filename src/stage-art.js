import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';

const coral=0xff6756,ice=0x63c8fa;
export function noteGeometry(){return new RoundedBoxGeometry(.72,.72,.72,3,.055);}
export function cutFrame(material){
  const frame=new THREE.Group();
  for(const x of [-2,2])for(const y of [.15,3.2]){
    const horizontal=new THREE.Mesh(new THREE.BoxGeometry(.34,.025,.025),material);
    horizontal.position.set(x+(x<0?.17:-.17),y,1);
    const vertical=new THREE.Mesh(new THREE.BoxGeometry(.025,.34,.025),material);
    vertical.position.set(x,y+(y<1?.17:-.17),1);frame.add(horizontal,vertical);
  }
  return frame;
}
export function buildEnvironment(scene){
  const metal=new THREE.MeshStandardMaterial({color:0x17232e,roughness:.4,metalness:.65});
  const recess=new THREE.MeshStandardMaterial({color:0x0a111a,roughness:.65,metalness:.25});
  const light=[coral,ice].map(color=>new THREE.MeshStandardMaterial({color,emissive:color,emissiveIntensity:1.6,roughness:.3}));
  const mesh=(geometry,material,x,y,z)=>{const m=new THREE.Mesh(geometry,material);m.position.set(x,y,z);scene.add(m);return m;};
  mesh(new THREE.BoxGeometry(6.1,.2,102),new THREE.MeshStandardMaterial({color:0x14202b,roughness:.28,metalness:.7}),0,-.18,-44);
  mesh(new THREE.BoxGeometry(3.95,.012,99),new THREE.MeshStandardMaterial({color:0x172430,roughness:.48,metalness:.45}),0,-.071,-43);
  for(const side of [-1,1]){
    mesh(new THREE.BoxGeometry(.6,.38,103),metal,side*3.3,-.17,-44);
    mesh(new THREE.BoxGeometry(.035,.025,101),light[side<0?0:1],side*2.45,-.045,-44);
    mesh(new THREE.BoxGeometry(.05,.03,101),light[side<0?0:1],side*3.55,-.02,-44);
    for(let j=0;j<6;j++){
      const z=-8-j*13;
      mesh(new THREE.BoxGeometry(.55,6.4,.7),metal,side*5.5,3.05,z);
      mesh(new THREE.BoxGeometry(.06,4.6,.09),light[side<0?0:1],side*5.21,2.7,z+.37);
      mesh(new THREE.BoxGeometry(1.8,.28,2.8),recess,side*4.6,.02,z);
      mesh(new THREE.BoxGeometry(.8,.25,.7),metal,side*4.6,.22,z);
    }
  }
  for(let j=0;j<6;j++){
    const z=-8-j*13;
    mesh(new THREE.BoxGeometry(11.5,.3,.7),metal,0,6.15,z);
    mesh(new THREE.BoxGeometry(7,.045,.08),light[j%2],0,5.98,z+.36);
  }
  const seam=new THREE.MeshBasicMaterial({color:0x3a5266,transparent:true,opacity:.35});
  for(let j=0;j<15;j++)mesh(new THREE.BoxGeometry(4.75,.008,.025),seam,0,-.055,-3-j*6);
  const threshold=new THREE.MeshBasicMaterial({color:0xbbd9e9,transparent:true,opacity:.28});
  mesh(new THREE.BoxGeometry(4.8,.014,.065),threshold,0,-.045,1);
  const rim=new THREE.DirectionalLight(0x8bcfff,1.7);rim.position.set(-5,3,-12);scene.add(rim);
  const wash=new THREE.PointLight(0xff9d78,10,18,2);wash.position.set(0,5,1);scene.add(wash);
}
function owned(group){group.traverse(child=>{if(child.isMesh)child.userData.disposable=true;});return group;}
export function bombMesh(){
  const bomb=new THREE.Group();
  const shell=new THREE.MeshStandardMaterial({color:0x252c35,metalness:.75,roughness:.28});
  const hot=new THREE.MeshStandardMaterial({color:0xffb28c,emissive:0xff563b,emissiveIntensity:2,roughness:.3});
  bomb.add(new THREE.Mesh(new THREE.IcosahedronGeometry(.25,1),shell));
  const seam=new THREE.Mesh(new THREE.TorusGeometry(.258,.016,5,24),hot);seam.rotation.x=.5;seam.rotation.y=.35;bomb.add(seam);
  const seam2=new THREE.Mesh(new THREE.TorusGeometry(.258,.012,5,24),hot);seam2.rotation.y=Math.PI/2;bomb.add(seam2);
  const vertices=new THREE.IcosahedronGeometry(1,0).attributes.position,seen=new Set();
  const spikeGeo=new THREE.ConeGeometry(.052,.13,5),up=new THREE.Vector3(0,1,0);
  for(let i=0;i<vertices.count;i++){
    const v=new THREE.Vector3().fromBufferAttribute(vertices,i).normalize(),key=[v.x,v.y,v.z].map(n=>n.toFixed(3)).join(',');
    if(seen.has(key))continue;seen.add(key);
    const spike=new THREE.Mesh(spikeGeo,shell);spike.position.copy(v).multiplyScalar(.29);spike.quaternion.setFromUnitVectors(up,v);bomb.add(spike);
  }
  return owned(bomb);
}
export function wallMesh(width,height,depth){
  const wall=new THREE.Group();
  const fill=new THREE.MeshPhysicalMaterial({color:0xea745d,emissive:0x853c31,emissiveIntensity:.4,roughness:.32,metalness:.12,transparent:true,opacity:.13,depthWrite:false,side:THREE.DoubleSide});
  wall.add(new THREE.Mesh(new THREE.BoxGeometry(width,height,depth),fill));
  const edge=new THREE.MeshBasicMaterial({color:0xff957b,transparent:true,opacity:.65});
  // A translucent volume with substantial front posts, rather than a wire cage.
  for(const x of [-width/2,width/2]){
    const post=new THREE.Mesh(new THREE.BoxGeometry(.045,height,.045),edge);post.position.set(x,0,depth/2);wall.add(post);
    const rail=new THREE.Mesh(new THREE.BoxGeometry(.025,.025,depth),edge);rail.position.set(x,-height/2,0);wall.add(rail);
  }
  for(const y of [-height/2,height/2]){
    const bar=new THREE.Mesh(new THREE.BoxGeometry(width,.035,.045),edge);bar.position.set(0,y,depth/2);wall.add(bar);
  }
  return owned(wall);
}
