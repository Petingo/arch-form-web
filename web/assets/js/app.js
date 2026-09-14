import { showModelInfo } from "./model-info.js?v=20260914";
import * as THREE from "three";
import { OrbitControls } from "/arch-form-web/model-latent-analysis/web/src/3rdparty/three/addons/controls/OrbitControls.js";
import { Rhino3dmLoader } from "/arch-form-web/model-latent-analysis/web/src/3rdparty/three/addons/loaders/3DMLoader.js";

// Filled from data/extracted/spatial_manifest.json so the picker covers every
// design that has spatial grounding, not a hard-coded pair of competitions.
const MANIFEST_URL = "../data/extracted/spatial_manifest.json";
let MODEL_IDS = [];
const COLORS = { positive: 0x19a66a, negative: 0xed5d51 };
const SELECTED_GLOW_COLOR = 0xffd84d;

const viewer = document.querySelector("#viewer");
const modelSelect = document.querySelector("#model-select");
const projectModelInfo = document.querySelector("#project-model-info");
const annotationList = document.querySelector("#annotation-list");
const loading = document.querySelector("#loading");
const loadingLabel = document.querySelector("#loading-label");
const tooltip = document.querySelector("#tooltip");
const nonspatialSummary = document.querySelector("#nonspatial-summary");
const nonspatialDots = document.querySelector("#nonspatial-dots");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xffffff);
scene.fog = new THREE.Fog(0xe9e8e1, 80, 300);

const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 2000);
camera.up.set(0, 0, 1);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
viewer.prepend(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = false;
controls.minPolarAngle = 0.08;
controls.maxPolarAngle = Math.PI * 0.49;

scene.add(new THREE.HemisphereLight(0xffffff, 0x77776f, 0.9));
const keyLight = new THREE.DirectionalLight(0xffffff, 1.25);
keyLight.position.set(-5, -7, 10);
keyLight.castShadow = true;
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0xc9e2d5, 0.42);
fillLight.position.set(7, 5, 4);
scene.add(fillLight);

const loader = new Rhino3dmLoader();
loader.setLibraryPath("/arch-form-web/model-latent-analysis/web/src/3rdparty/three/addons/libs/rhino3dm/");

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const markerGroup = new THREE.Group();
scene.add(markerGroup);

let model = null;
let modelBox = new THREE.Box3();
let modelSize = new THREE.Vector3();
let modelCenter = new THREE.Vector3();
let modelRadius = 1;
let annotations = [];
let activeFilter = "all";
let activeSentiments = new Set(["positive", "negative"]);
let selectedKey = null;
let hoveredKey = null;
let autoRotate = false;
let loadToken = 0;
let renderRequestId = null;

window.__juryLens = {
  scene,
  camera,
  controls,
  markerGroup,
  get model() { return model; },
  get modelBox() { return modelBox; },
  get annotations() { return annotations; },
};

async function loadModelIds() {
  try {
    const response = await fetch(MANIFEST_URL);
    const manifest = response.ok ? await response.json() : [];
    modelSelect.replaceChildren();
    for (const competition of manifest) {
      const group = document.createElement("optgroup");
      group.label = `Competition ${competition.id}`;
      for (const id of competition.entries) {
        MODEL_IDS.push(id);
        const option = document.createElement("option");
        option.value = id;
        option.textContent = id;
        group.append(option);
      }
      modelSelect.append(group);
    }
  } catch (cause) {
    console.error("Could not load the spatial manifest", cause);
  }
}

function resize() {
  const width = viewer.clientWidth;
  const height = viewer.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / Math.max(height, 1);
  camera.updateProjectionMatrix();
  requestRender();
}

function disposeObject(object) {
  object.traverse((child) => {
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose?.());
    else child.material?.dispose?.();
  });
  object.removeFromParent();
}

function clearMarkers() {
  while (markerGroup.children.length) disposeObject(markerGroup.children[0]);
}

function frameModel() {
  const distance = modelRadius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.08;
  const direction = new THREE.Vector3(1.12, -1.38, 0.92).normalize();
  controls.target.copy(modelCenter);
  camera.position.copy(modelCenter).addScaledVector(direction, distance);
  camera.near = Math.max(modelRadius / 1000, 1e-8);
  camera.far = Math.max(modelRadius * 30, 0.1);
  camera.updateProjectionMatrix();
  controls.minDistance = modelRadius * 0.4;
  controls.maxDistance = modelRadius * 10;
  controls.update();
  requestRender();
}

function normalizedToWorld([x, y, z]) {
  return new THREE.Vector3(
    modelBox.min.x + modelSize.x * x,
    modelBox.min.y + modelSize.y * y,
    modelBox.min.z + modelSize.z * z
  );
}

function createMarker(annotation) {
  const color = COLORS[annotation.sentiment];
  const anchor = normalizedToWorld(annotation.position.normalized_position);
  const position = anchor.clone();
  if (annotation.displayOffset) {
    position.x += modelSize.x * annotation.displayOffset[0];
    position.y += modelSize.y * annotation.displayOffset[1];
  }
  const radius = modelRadius * 0.045;
  const root = new THREE.Group();
  root.position.copy(position);
  root.userData.annotation = annotation;
  root.userData.baseRadius = radius;

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 24, 16),
    new THREE.ShaderMaterial({
      uniforms: {
        edgeColor: { value: new THREE.Color(color) },
        centerColor: { value: new THREE.Color(SELECTED_GLOW_COLOR) },
        centerStrength: { value: 0 },
        opacity: { value: 0.22 },
      },
      vertexShader: `
        varying vec3 vViewNormal;
        varying vec3 vViewDirection;
        void main() {
          vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
          vViewNormal = normalize(normalMatrix * normal);
          vViewDirection = normalize(-viewPosition.xyz);
          gl_Position = projectionMatrix * viewPosition;
        }
      `,
      fragmentShader: `
        uniform vec3 edgeColor;
        uniform vec3 centerColor;
        uniform float centerStrength;
        uniform float opacity;
        varying vec3 vViewNormal;
        varying vec3 vViewDirection;
        void main() {
          float facing = clamp(dot(normalize(vViewNormal), normalize(vViewDirection)), 0.0, 1.0);
          float radialGlow = smoothstep(0.94, 0.998, facing) * centerStrength;
          vec3 color = mix(edgeColor, centerColor, radialGlow);
          float glowAlpha = opacity * mix(0.78, 1.0, facing);
          gl_FragColor = vec4(color, glowAlpha);
        }
      `,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    })
  );
  core.renderOrder = 12;
  core.userData.annotation = annotation;
  root.add(core);

  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.34, 20, 12),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.055, depthTest: false, depthWrite: false, side: THREE.BackSide })
  );
  halo.renderOrder = 11;
  halo.userData.annotation = annotation;
  halo.userData.isHalo = true;
  root.add(halo);

  if (annotation.displayOffset) {
    const leader = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), anchor.clone().sub(position)]),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.2, depthTest: false })
    );
    leader.renderOrder = 10;
    root.add(leader);
  }

  markerGroup.add(root);
  annotation.marker = root;
}

function setMarkerVisual(annotation, state) {
  if (!annotation.marker) return;
  const core = annotation.marker.children[0];
  const halo = annotation.marker.children[1];
  const leader = annotation.marker.children[2];
  const sentimentColor = new THREE.Color(COLORS[annotation.sentiment]);
  const hoverColor = sentimentColor.clone().multiplyScalar(0.82);
  const coreUniforms = core.material.uniforms;

  if (state === "selected") {
    coreUniforms.edgeColor.value.copy(hoverColor);
    coreUniforms.centerStrength.value = 1;
    coreUniforms.opacity.value = 0.92;
    halo.material.color.copy(hoverColor);
    leader?.material.color.copy(hoverColor);
    halo.material.opacity = 0.18;
    if (leader) leader.material.opacity = 0.62;
    core.scale.setScalar(1);
    halo.scale.setScalar(1);
  } else if (state === "hovered") {
    coreUniforms.edgeColor.value.copy(hoverColor);
    coreUniforms.centerStrength.value = 0;
    coreUniforms.opacity.value = 0.56;
    halo.material.color.copy(hoverColor);
    leader?.material.color.copy(hoverColor);
    halo.material.opacity = 0.12;
    if (leader) leader.material.opacity = 0.46;
    core.scale.setScalar(1);
    halo.scale.setScalar(1);
  } else {
    coreUniforms.edgeColor.value.copy(sentimentColor);
    coreUniforms.centerStrength.value = 0;
    coreUniforms.opacity.value = 0.22;
    halo.material.color.setHex(COLORS[annotation.sentiment]);
    leader?.material.color.setHex(COLORS[annotation.sentiment]);
    halo.material.opacity = 0.055;
    if (leader) leader.material.opacity = 0.2;
    core.scale.setScalar(1);
    halo.scale.setScalar(1);
  }
}

function updateMarkerStates() {
  for (const annotation of annotations) {
    const state = annotation.key === selectedKey
      ? "selected"
      : annotation.key === hoveredKey
        ? "hovered"
        : "default";
    setMarkerVisual(annotation, state);
    annotation.summaryDot?.classList.toggle("selected", state === "selected");
    annotation.summaryDot?.classList.toggle("hovered", state === "hovered");
  }
  requestRender();
}

function setHoveredAnnotation(annotation) {
  const nextKey = annotation?.key ?? null;
  if (hoveredKey === nextKey) return;
  hoveredKey = nextKey;
  updateMarkerStates();
}

function expressionCard(annotation) {
  const card = document.createElement("button");
  card.className = `annotation-card ${annotation.sentiment}`;
  if (!annotation.position.normalized_position) card.classList.add("unlocated");
  card.dataset.key = annotation.key;
  card.innerHTML = `
    <span class="card-index">${annotation.displayIndex}</span>
    <span>
      <span class="card-meta">
        <span class="target">${escapeHtml(annotation.position.target)}</span>
        <span>${escapeHtml(annotation.position.spatial_scope)}</span>
        <span class="confidence" title="Position confidence: ${escapeHtml(annotation.position.confidence)}">${annotation.position.normalized_position ? `LOC · ${escapeHtml(annotation.position.confidence)}` : "2D · NON-SPATIAL"}</span>
      </span>
      <p>${escapeHtml(annotation.statement)}</p>
    </span>`;
  card.addEventListener("click", () => selectAnnotation(annotation, true));
  card.addEventListener("pointerenter", () => setHoveredAnnotation(annotation));
  card.addEventListener("pointerleave", () => setHoveredAnnotation(null));
  annotation.card = card;
  return card;
}

function escapeHtml(value) {
  const node = document.createElement("span");
  node.textContent = value;
  return node.innerHTML;
}

function selectAnnotation(annotation, moveCamera = false) {
  selectedKey = annotation.key;
  for (const item of annotations) {
    const selected = item.key === selectedKey;
    item.card?.classList.toggle("active", selected);
  }
  updateMarkerStates();
  annotation.card?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  if (moveCamera && annotation.marker) {
    const destination = annotation.marker.position;
    const viewDirection = camera.position.clone().sub(controls.target).normalize();
    controls.target.copy(destination);
    camera.position.copy(destination).addScaledVector(viewDirection, modelRadius * 2.15);
    controls.update();
  }
}

function clearSelection() {
  if (selectedKey === null) return;
  selectedKey = null;
  for (const annotation of annotations) annotation.card?.classList.remove("active");
  updateMarkerStates();
}

function renderAnnotations(data) {
  clearMarkers();
  annotationList.replaceChildren();
  nonspatialDots.replaceChildren();
  nonspatialSummary.hidden = true;
  selectedKey = null;
  hoveredKey = null;
  annotations = [];

  for (const sentiment of ["positive", "negative"]) {
    data.jury_expression[sentiment].forEach((expression, index) => {
      if (!expression.position) return;
      const annotation = {
        ...expression,
        sentiment,
        displayIndex: index + 1,
        key: `${sentiment}-${index}`,
      };
      annotations.push(annotation);
    });
  }

  const overlaps = new Map();
  for (const annotation of annotations) {
    if (!Array.isArray(annotation.position.normalized_position)) continue;
    const key = annotation.position.normalized_position.map((value) => value.toFixed(3)).join(":");
    if (!overlaps.has(key)) overlaps.set(key, []);
    overlaps.get(key).push(annotation);
  }
  for (const group of overlaps.values()) {
    if (group.length < 2) continue;
    group.forEach((annotation, index) => {
      const ring = Math.floor(index / 8);
      const positionInRing = index % 8;
      const itemsInRing = Math.min(8, group.length - ring * 8);
      const angle = (positionInRing / itemsInRing) * Math.PI * 2 - Math.PI / 2;
      const distance = 0.055 + ring * 0.045;
      annotation.displayOffset = [Math.cos(angle) * distance, Math.sin(angle) * distance];
    });
  }
  for (const annotation of annotations) {
    if (Array.isArray(annotation.position.normalized_position)) createMarker(annotation);
    annotationList.append(expressionCard(annotation));
  }
  renderNonSpatialSummary();
  applyFilters();
}

function renderNonSpatialSummary() {
  const items = annotations.filter((annotation) => !Array.isArray(annotation.position.normalized_position));
  nonspatialSummary.hidden = items.length === 0;
  for (const annotation of items) {
    const dot = document.createElement("button");
    dot.className = `nonspatial-dot ${annotation.sentiment}`;
    dot.textContent = annotation.displayIndex;
    dot.title = `${annotation.position.target}: ${annotation.statement}`;
    dot.setAttribute("aria-label", dot.title);
    dot.addEventListener("click", () => selectAnnotation(annotation, true));
    dot.addEventListener("pointerenter", () => setHoveredAnnotation(annotation));
    dot.addEventListener("pointerleave", () => setHoveredAnnotation(null));
    annotation.summaryDot = dot;
    nonspatialDots.append(dot);
  }
}

function isVisible(annotation) {
  const filterMatch = activeFilter === "all" || annotation.sentiment === activeFilter;
  return filterMatch && activeSentiments.has(annotation.sentiment);
}

function applyFilters() {
  let visible = 0;
  let visibleNonSpatial = 0;
  for (const annotation of annotations) {
    const show = isVisible(annotation);
    if (annotation.marker) annotation.marker.visible = show;
    if (annotation.summaryDot) annotation.summaryDot.hidden = !show;
    if (show && annotation.summaryDot) visibleNonSpatial += 1;
    annotation.card.hidden = !show;
    if (show) visible += 1;
  }
  nonspatialSummary.hidden = visibleNonSpatial === 0;
  document.querySelector("#visible-count").textContent = `${visible} / ${annotations.length}`;
  requestRender();
}

function prepareModel(object) {
  const material = new THREE.MeshStandardMaterial({
    color: 0xd8d7cf,
    roughness: 0.82,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });
  const meshes = [];
  object.traverse((child) => {
    if (child.isMesh) {
      child.material = material;
      child.castShadow = true;
      child.receiveShadow = true;
      meshes.push(child);
    } else if (child.isLine || child.isPoints) {
      child.visible = false;
    }
  });
  for (const mesh of meshes) {
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(mesh.geometry, 28),
      new THREE.LineBasicMaterial({ color: 0x6c7068, transparent: true, opacity: 0.38 })
    );
    edges.renderOrder = 2;
    mesh.add(edges);
  }
  return object;
}

async function loadProject(id) {
  const token = ++loadToken;
  loading.classList.remove("done", "error");
  loadingLabel.textContent = `Loading ${id}.3dm`;
  tooltip.hidden = true;
  showModelInfo(projectModelInfo, id, { isStale: () => token !== loadToken });

  try {
    const dataRequest = fetch(`../data/extracted/designs/${id}.json`).then((response) => {
      if (!response.ok) throw new Error(`Annotation JSON returned ${response.status}`);
      return response.json();
    });
    const modelRequest = new Promise((resolve, reject) => {
      loader.load(`/arch-form-web/model-latent-analysis/web/dist/static/models_3dm/${id}.3dm`, resolve, undefined, reject);
    });
    const [data, object] = await Promise.all([dataRequest, modelRequest]);
    if (token !== loadToken) {
      disposeObject(object);
      return;
    }

    if (model) disposeObject(model);
    model = prepareModel(object);
    scene.add(model);
    modelBox.setFromObject(model);
    modelBox.getSize(modelSize);
    modelBox.getCenter(modelCenter);
    modelRadius = Math.max(modelSize.length() * 0.5, 1e-8);

    document.querySelector("#positive-count").textContent = data.jury_expression.positive.length;
    document.querySelector("#negative-count").textContent = data.jury_expression.negative.length;
    renderAnnotations(data);
    frameModel();
    loading.classList.add("done");
    requestRender();
  } catch (error) {
    console.error(error);
    loading.classList.add("error");
    loadingLabel.textContent = `Could not load ${id}: ${error.message}`;
  }
}

function annotationFromEvent(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(markerGroup.children, true);
  return hits.find((hit) => hit.object.userData.annotation)?.object.userData.annotation;
}

renderer.domElement.addEventListener("pointermove", (event) => {
  const annotation = annotationFromEvent(event);
  if (!annotation || !isVisible(annotation)) {
    setHoveredAnnotation(null);
    tooltip.hidden = true;
    renderer.domElement.style.cursor = "grab";
    return;
  }
  setHoveredAnnotation(annotation);
  tooltip.hidden = false;
  tooltip.style.left = `${Math.min(event.offsetX + 16, viewer.clientWidth - 294)}px`;
  tooltip.style.top = `${Math.max(12, event.offsetY - 35)}px`;
  // The jury's own words, not the grounding rationale that explains where the
  // marker was placed.
  tooltip.innerHTML = `<strong>${escapeHtml(annotation.position.target)}</strong><p>${escapeHtml(annotation.statement)}</p>`;
  renderer.domElement.style.cursor = "pointer";
});

renderer.domElement.addEventListener("click", (event) => {
  const annotation = annotationFromEvent(event);
  if (annotation && isVisible(annotation)) selectAnnotation(annotation);
  else clearSelection();
});

// OrbitControls updates the camera synchronously in its wheel handler. Render
// immediately afterward so rapid wheel and trackpad zoom never waits for a
// later UI event, while keeping the viewer completely idle between inputs.
renderer.domElement.addEventListener("wheel", () => {
  renderer.render(scene, camera);
}, { passive: true });

modelSelect.addEventListener("change", () => {
  const id = modelSelect.value;
  // the hash is the source of truth; the listener below reloads the model
  location.hash = `#project/${encodeURIComponent(id)}`;
});
document.querySelector("#reset-view").addEventListener("click", frameModel);
document.querySelector("#toggle-spin").addEventListener("click", (event) => {
  autoRotate = !autoRotate;
  controls.autoRotate = autoRotate;
  controls.autoRotateSpeed = 0.65;
  event.currentTarget.classList.toggle("active", autoRotate);
  requestRender();
});

document.querySelectorAll(".filter").forEach((button) => {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.filter;
    document.querySelectorAll(".filter").forEach((item) => item.classList.toggle("active", item === button));
    applyFilters();
  });
});

document.querySelectorAll(".legend-item").forEach((button) => {
  button.addEventListener("click", () => {
    const sentiment = button.dataset.sentiment;
    if (activeSentiments.has(sentiment)) activeSentiments.delete(sentiment);
    else activeSentiments.add(sentiment);
    button.classList.toggle("active", activeSentiments.has(sentiment));
    applyFilters();
  });
});

function requestRender() {
  if (renderRequestId === null) renderRequestId = requestAnimationFrame(renderFrame);
}

function renderFrame() {
  renderRequestId = null;
  if (autoRotate && !document.hidden) controls.update();
  renderer.render(scene, camera);
  if (autoRotate && !document.hidden) requestRender();
}

controls.addEventListener("change", requestRender);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) requestRender();
});
new ResizeObserver(resize).observe(viewer);
resize();
let shownProjectId = null;

function projectFromHash() {
  const raw = location.hash.replace(/^#/, "");
  if (!raw.startsWith("project/")) return null;
  return decodeURIComponent(raw.slice("project/".length)) || null;
}

function showProject(requested) {
  // The picker lists the competitions with curated entries, but Model Latent
  // links here for any of the 581 designs, so accept an id outside the list and
  // add it to the picker rather than silently falling back to the first model.
  let id = requested || MODEL_IDS[0];
  if (!MODEL_IDS.includes(id)) {
    if (!/^[A-Za-z]+\d+$/.test(id)) id = MODEL_IDS[0];
    else if (!modelSelect.querySelector(`option[value="${CSS.escape(id)}"]`)) {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = id;
      modelSelect.prepend(option);
    }
  }
  // Track what is actually loaded: the <select> already holds the new value by
  // the time its change handler runs, so comparing against it skipped the load.
  if (id === shownProjectId) return;
  shownProjectId = id;
  modelSelect.value = id;
  loadProject(id);
}

// The project view is a pane of the shell, so it stays mounted and follows
// #project/<id> instead of being re-created by a page load.
window.addEventListener("shell:project", (event) => showProject(event.detail));
loadModelIds().then(() => showProject(projectFromHash()));
requestRender();
