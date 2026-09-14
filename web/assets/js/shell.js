/**
 * Single-page shell. All three tabs live in one document so switching away from
 * Model Latent never tears down its iframe -- the 52MB models_info payload and
 * the 3dm models stay loaded, and the camera, selection and colour mode survive.
 *
 * Each tab's module is imported on first activation, so landing on one tab does
 * not pay for the other two.
 */
const TABS = {
  competitions: {
    pane: "pane-competitions",
    note: "",
    load: () => import("./index.js?v=20260914"),
  },
  "model-latent": {
    pane: "pane-model-latent",
    note: "3D FORM LATENT SPACE",
    load: () => import("./model-space.js?v=20260914"),
  },
  "jury-expression": {
    pane: "pane-jury-expression",
    note: "JURY TAGS × COMPETITION RANK",
    load: () => import("./analysis.js?v=20260914"),
  },
  project: {
    pane: "pane-project",
    note: "SPATIAL CRITIQUE",
    nav: "competitions",
    load: () => import("./app.js?v=20260914"),
  },
};

// links from before the tabs were merged, plus the old names
const ALIASES = {
  "": "competitions",
  "#": "competitions",
  index: "competitions",
  analysis: "jury-expression",
  "model-space": "model-latent",
};

const DEFAULT_TAB = "competitions";
const started = new Set();
const note = document.querySelector("#shell-note");
const navLinks = [...document.querySelectorAll(".site-nav a[data-tab]")];

/** "#project/A1" -> "project"; everything else is a plain tab name. */
function resolve(hash) {
  const raw = (hash || "").replace(/^#/, "");
  const name = ALIASES[raw] ?? raw.split("/")[0];
  return TABS[name] ? name : DEFAULT_TAB;
}

/** The project route carries the model id: "#project/A1". */
export function currentProjectId() {
  const raw = location.hash.replace(/^#/, "");
  if (!raw.startsWith("project/")) return null;
  return decodeURIComponent(raw.slice("project/".length)) || null;
}

async function activate(name) {
  for (const [key, tab] of Object.entries(TABS)) {
    document.getElementById(tab.pane).hidden = key !== name;
  }
  // a project belongs to Competitions as far as the nav is concerned
  const highlighted = TABS[name].nav || name;
  for (const link of navLinks) {
    link.classList.toggle("active", link.dataset.tab === highlighted);
  }
  note.textContent = TABS[name].note;
  document.title = name === DEFAULT_TAB ? "Arch Form" : `Arch Form — ${TABS[name].note}`;

  // Import only after the pane is visible: the analysis charts measure
  // clientWidth when they build, which reads 0 inside a hidden pane.
  if (!started.has(name)) {
    started.add(name);
    try {
      await TABS[name].load();
    } catch (cause) {
      started.delete(name);
      console.error(`Could not load the ${name} tab`, cause);
    }
  }
}

window.addEventListener("hashchange", () => {
  const name = resolve(location.hash);
  activate(name);
  // already-loaded project view follows further #project/<id> changes itself
  if (name === "project") {
    window.dispatchEvent(new CustomEvent("shell:project", { detail: currentProjectId() }));
  }
});
activate(resolve(location.hash));
