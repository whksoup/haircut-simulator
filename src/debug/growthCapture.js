// Diagnostic readback of the production vertex reconstruction. Not imported by
// the application: the local browser evaluation page loads this explicitly.
import * as THREE from 'three';
import { hairReconstructionGLSL } from '../rendering/gpu/hairShaderGuides.js';
import { SHAPE_POINTS } from '../hair/strandShape.js';

export function captureGrowthVertices(webgl, hair, indices, fraction) {
  if (!webgl.extensions.has('EXT_color_buffer_float')) throw new Error('Float GPU readback unavailable');
  if (!indices.length) return [];
  const maxRows = webgl.capabilities.maxTextureSize;
  if (indices.length > maxRows) {
    const output = [];
    for (let offset = 0; offset < indices.length; offset += maxRows) output.push(...captureGrowthVertices(webgl,hair,indices.slice(offset,offset+maxRows),fraction));
    return output;
  }
  const geometry = new THREE.InstancedBufferGeometry();
  const t = Float32Array.from({length:SHAPE_POINTS},(_,k)=>k/(SHAPE_POINTS-1));
  geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(SHAPE_POINTS*3),3));
  geometry.setAttribute('aT',new THREE.BufferAttribute(t,1));
  geometry.setAttribute('iCaptureRow',new THREE.InstancedBufferAttribute(Float32Array.from(indices,(_,i)=>i),1));
  for (const name of ['iRoot','iNormal','iTangent','iGuideRow','iGuideW','iSeed']) {
    const attribute = hair._geo.getAttribute(name);
    const values = new Float32Array(indices.length*attribute.itemSize);
    indices.forEach((index,row)=>values.set(attribute.array.subarray(index*attribute.itemSize,(index+1)*attribute.itemSize),row*attribute.itemSize));
    geometry.setAttribute(name,new THREE.InstancedBufferAttribute(values,attribute.itemSize));
  }
  geometry.instanceCount=indices.length;
  const uniforms = Object.fromEntries(Object.entries(hair._material.uniforms).map(([name,uniform])=>[name,{value:uniform.value}]));
  uniforms.uGrowthFraction={value:fraction};
  uniforms.uCaptureRows={value:indices.length};
  const material = new THREE.ShaderMaterial({
    uniforms, depthTest:false, depthWrite:false, blending:THREE.NoBlending, toneMapped:false,
    vertexShader:hairReconstructionGLSL+`
      attribute float iCaptureRow;
      uniform float uCaptureRows;
      varying vec3 vCapture;
      void main() {
        vCapture=growthStrandVertex(aT);
        gl_Position=vec4(2.0*(aT*${SHAPE_POINTS-1}.0+0.5)/${SHAPE_POINTS}.0-1.0,2.0*(iCaptureRow+0.5)/uCaptureRows-1.0,0.0,1.0);
        gl_PointSize=1.0;
      }`,
    fragmentShader:'varying vec3 vCapture; void main(){ gl_FragColor=vec4(vCapture,1.0); }',
  });
  const target = new THREE.WebGLRenderTarget(SHAPE_POINTS,indices.length,{type:THREE.FloatType,format:THREE.RGBAFormat,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,depthBuffer:false,stencilBuffer:false});
  target.texture.colorSpace=THREE.NoColorSpace;
  const scene=new THREE.Scene(); const points=new THREE.Points(geometry,material); points.frustumCulled=false; scene.add(points);
  const priorTarget=webgl.getRenderTarget(); const priorClear=webgl.getClearColor(new THREE.Color()); const priorAlpha=webgl.getClearAlpha();
  const priorViewport=webgl.getViewport(new THREE.Vector4()); const priorScissor=webgl.getScissor(new THREE.Vector4()); const priorScissorTest=webgl.getScissorTest();
  const pixels=new Float32Array(SHAPE_POINTS*indices.length*4);
  try {
    webgl.setRenderTarget(target); webgl.setViewport(0,0,SHAPE_POINTS,indices.length); webgl.setScissorTest(false); webgl.setClearColor(0,0); webgl.clear();
    webgl.render(scene,new THREE.Camera());
    webgl.readRenderTargetPixels(target,0,0,SHAPE_POINTS,indices.length,pixels);
    return indices.map((index,row)=>({index,vertices:Array.from({length:SHAPE_POINTS},(_,k)=>{
      const offset=(row*SHAPE_POINTS+k)*4;
      if(pixels[offset+3]!==1) throw new Error(`GPU capture missing row ${row} vertex ${k}`);
      return Array.from(pixels.subarray(offset,offset+3));
    })}));
  } finally {
    webgl.setRenderTarget(priorTarget); webgl.setViewport(priorViewport); webgl.setScissor(priorScissor); webgl.setScissorTest(priorScissorTest); webgl.setClearColor(priorClear,priorAlpha);
    target.dispose(); material.dispose(); geometry.dispose();
  }
}
