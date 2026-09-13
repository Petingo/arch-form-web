import * as THREE from "three";
import { PLYLoader } from "/arch-form-web/model-latent-analysis/web/src/3rdparty/three/addons/loaders/PLYLoader.js";

const params = new URLSearchParams(location.search);
const modelId = params.get("model") || "A1";
const viewName = params.get("view") || "top";
const showCritiqueMarkers = params.get("markers") === "1";
const viewDefinitions = {
  top:   { direction: [0, 0, 1], up: [0, 1, 0], axes: "↑ NORTH / +Y\n→ EAST / +X" },
  south: { direction: [0, -1, 0], up: [0, 0, 1], axes: "↑ TOP / +Z\n→ WEST / −X" },
  north: { direction: [0, 1, 0], up: [0, 0, 1], axes: "↑ TOP / +Z\n→ EAST / +X" },
  east:  { direction: [1, 0, 0], up: [0, 0, 1], axes: "↑ TOP / +Z\n→ SOUTH / −Y" },
  west:  { direction: [-1, 0, 0], up: [0, 0, 1], axes: "↑ TOP / +Z\n→ NORTH / +Y" },
  isometric: { direction: [1, -1, 0.85], up: [0, 0, 1], axes: "ISOMETRIC\nX · Y · Z" },
};
const view = viewDefinitions[viewName] || viewDefinitions.top;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.setSize(innerWidth, innerHeight);
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xecebe5);
scene.add(new THREE.HemisphereLight(0xffffff, 0x74766f, 1.25));
const light = new THREE.DirectionalLight(0xffffff, 1.15);
light.position.set(-3, -4, 8);
scene.add(light);

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1e-9, 10);
const loader = new PLYLoader();

function circleTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.beginPath();
  context.arc(32, 32, 29, 0, Math.PI * 2);
  context.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

async function addCritiqueMarkers(box) {
  if (!showCritiqueMarkers) return;
  const response = await fetch(`/arch-form-web/data/extracted/designs/${modelId}.json`);
  if (!response.ok) throw new Error(`Annotation JSON returned ${response.status}`);
  const data = await response.json();
  const size = box.getSize(new THREE.Vector3());
  const positions = [];
  const colors = [];
  const positive = new THREE.Color(0x19a66a);
  const negative = new THREE.Color(0xed5d51);

  for (const sentiment of ["positive", "negative"]) {
    for (const expression of data.jury_expression[sentiment]) {
      const normalized = expression.position?.normalized_position;
      if (!Array.isArray(normalized)) continue;
      positions.push(
        box.min.x + size.x * normalized[0],
        box.min.y + size.y * normalized[1],
        box.min.z + size.z * normalized[2]
      );
      const color = sentiment === "positive" ? positive : negative;
      colors.push(color.r, color.g, color.b);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  const map = circleTexture();
  const outline = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({ color: 0xffffff, size: 34, sizeAttenuation: false, map, alphaTest: 0.2, transparent: true, depthTest: false, depthWrite: false, toneMapped: false })
  );
  const dots = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({ vertexColors: true, size: 27, sizeAttenuation: false, map, alphaTest: 0.2, transparent: true, opacity: 0.78, depthTest: false, depthWrite: false, toneMapped: false })
  );
  outline.renderOrder = 9;
  dots.renderOrder = 10;
  scene.add(outline, dots);
}

function frameObject(object) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const direction = new THREE.Vector3(...view.direction).normalize();
  const requestedUp = new THREE.Vector3(...view.up).normalize();
  const right = new THREE.Vector3().crossVectors(requestedUp, direction).normalize();
  const up = new THREE.Vector3().crossVectors(direction, right).normalize();
  const projectedWidth = Math.abs(right.x * size.x) + Math.abs(right.y * size.y) + Math.abs(right.z * size.z);
  const projectedHeight = Math.abs(up.x * size.x) + Math.abs(up.y * size.y) + Math.abs(up.z * size.z);
  const aspect = innerWidth / Math.max(innerHeight, 1);
  const halfHeight = Math.max(projectedHeight * 0.62, projectedWidth / aspect * 0.62, 1e-8);
  const halfWidth = halfHeight * aspect;
  const distance = Math.max(size.length() * 2, 1e-7);

  camera.left = -halfWidth;
  camera.right = halfWidth;
  camera.top = halfHeight;
  camera.bottom = -halfHeight;
  camera.near = Math.max(distance / 1000, 1e-10);
  camera.far = distance * 3;
  camera.up.copy(up);
  camera.position.copy(center).addScaledVector(direction, distance);
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}

loader.load(
  `/arch-form-web/data/geometry/ply/${modelId}.ply`,
  async (geometry) => {
    try {
    geometry.computeBoundingBox();
    const object = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({ color: 0x252925, size: 2.4, sizeAttenuation: false })
    );
    scene.add(object);
    frameObject(object);
    await addCritiqueMarkers(geometry.boundingBox);
    renderer.render(scene, camera);
    document.querySelector("#label").textContent = `${modelId} · ${viewName.toUpperCase()} · 2,048-POINT PLY`;
    document.querySelector("#axes").textContent = view.axes;
    document.body.dataset.ready = "true";
    } catch (error) {
      document.querySelector("#label").textContent = `ERROR · ${error.message || error}`;
      document.querySelector("#label").classList.add("error");
      document.body.dataset.ready = "error";
    }
  },
  undefined,
  (error) => {
    document.querySelector("#label").textContent = `ERROR · ${error.message || error}`;
    document.querySelector("#label").classList.add("error");
    document.body.dataset.ready = "error";
  }
);
