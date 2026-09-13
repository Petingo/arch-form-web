/**
 * One renderer for the model detail panel, shared by the Model Latent viewer
 * and the Competitions project view so both show identical content and markup.
 *
 * The Model Latent app is bundled separately (browserify, via tsify) and imports
 * this file by relative path; the shell imports it as a module. Both load
 * assets/css/model-info.css, so the styling is shared too.
 *
 * Paths are absolute because this also runs inside the viewer's iframe, which
 * is served from a different directory.
 */
const META_URL = "/arch-form-web/data/extracted/model_meta.json";
const DESIGN_URL = "/arch-form-web/data/extracted/designs/";
const EMPTY = "—";

export const FIELDS = [
  { key: "competition", label: "Competition" },
  { key: "architect", label: "Architect" },
  { key: "rank", label: "Rank" },
  { key: "year", label: "Year" },
  { key: "location", label: "Location" },
  { key: "description", label: "Description" },
];

let metaPromise = null;

function loadMeta() {
  if (!metaPromise) {
    metaPromise = fetch(META_URL)
      .then((response) => (response.ok ? response.json() : {}))
      .catch(() => ({}));
  }
  return metaPromise;
}

/** Metadata plus the extracted description, keyed the way FIELDS expects. */
export async function loadModelInfo(code) {
  const [meta, design] = await Promise.all([
    loadMeta().then((all) => all[code] || {}),
    fetch(`${DESIGN_URL}${encodeURIComponent(code)}.json`)
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null),
  ]);

  return {
    code,
    competition: meta.competition || "",
    architect: meta.architect || "",
    rank: meta.rank ? `#${meta.rank}` : "",
    year: meta.year || "",
    location: [meta.city, meta.canton].filter(Boolean).join(", "),
    description: design?.object_description || "",
  };
}

/**
 * Fill `root` with the detail panel for `info`.
 * Pass `critiqueHref` to append the Jury's critique link; the Competitions view
 * omits it, since it is already showing the critique.
 */
export function renderModelInfo(root, info, { critiqueHref } = {}) {
  if (!root) return;
  root.replaceChildren();

  const name = document.createElement("h2");
  name.className = "model-info-name";
  name.textContent = info.code || "";
  root.append(name);

  for (const { key, label } of FIELDS) {
    const row = document.createElement("p");
    row.className = "model-info-field";
    row.dataset.field = key;

    const caption = document.createElement("u");
    caption.textContent = label;

    const value = document.createElement("span");
    value.textContent = info[key] || EMPTY;

    row.append(caption, document.createElement("br"), value);
    root.append(row);
  }

  if (critiqueHref) {
    const row = document.createElement("p");
    const link = document.createElement("a");
    link.className = "jury-critique-link";
    // The Model Latent panel lives inside an iframe; without _top the link
    // would load the shell into that iframe instead of routing the page.
    link.target = "_top";
    link.href = critiqueHref;
    link.textContent = "Jury's critique";
    row.append(link);
    root.append(row);
  }
}

/** Convenience: fetch and render, ignoring a response the caller moved off. */
export async function showModelInfo(root, code, options = {}) {
  const info = await loadModelInfo(code);
  if (options.isStale && options.isStale()) return;
  renderModelInfo(root, info, options);
}
