import * as THREE from 'three'

const skyVertex = `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const skyFragment = `
  varying vec3 vDir;
  uniform vec3 topColor;
  uniform vec3 horizonColor;
  uniform vec3 bottomColor;
  uniform vec3 sunColor;
  uniform vec3 sunDir;
  void main() {
    vec3 dir = normalize(vDir);
    float h = dir.y;
    vec3 col = mix(bottomColor, horizonColor, smoothstep(-0.28, 0.06, h));
    col = mix(col, topColor, smoothstep(0.0, 0.62, h));
    float sunDot = max(dot(dir, normalize(sunDir)), 0.0);
    float haze = exp(-max(h, 0.0) * 1.45);
    col += sunColor * pow(sunDot, 180.0) * 1.8;
    col += sunColor * pow(sunDot, 8.0) * 0.42 * haze;
    col += sunColor * pow(sunDot, 2.0) * 0.1 * haze;
    col = mix(col, horizonColor, haze * 0.22);
    gl_FragColor = vec4(col, 1.0);
  }
`

export function createSky(scene: THREE.Scene, sunDir: THREE.Vector3): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      topColor: { value: new THREE.Color('#7a3cb8') },
      horizonColor: { value: new THREE.Color('#ff5c6a') },
      bottomColor: { value: new THREE.Color('#4a2078') },
      sunColor: { value: new THREE.Color('#ffb0c8') },
      sunDir: { value: sunDir.clone() },
    },
    vertexShader: skyVertex,
    fragmentShader: skyFragment,
  })
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1400, 24, 16), mat)
  sky.frustumCulled = false
  sky.renderOrder = -2
  scene.add(sky)
  return sky
}
