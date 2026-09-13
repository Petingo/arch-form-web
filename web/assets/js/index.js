// Which competitions appear here is driven by data/extracted/spatial_manifest.json
// (produced by jury-text-analysis/scripts/grounding/export_spatial_manifest.py),
// so adding spatial grounding to more designs surfaces them automatically.
const MANIFEST_URL = "../data/extracted/spatial_manifest.json";

const list = document.querySelector("#competition-list");
const template = document.querySelector("#entry-template");
const filterRow = document.querySelector(".competition-filter");
let competitions = [];
let filterButtons = [];
let activeCompetition = "all";

function buildFilterButtons() {
  filterRow.replaceChildren();
  const make = (value, label) => {
    const button = document.createElement("button");
    button.dataset.competition = value;
    button.textContent = label;
    button.addEventListener("click", () => {
      activeCompetition = value;
      applyCompetitionFilter();
    });
    filterRow.append(button);
    return button;
  };
  filterButtons = [make("all", "All competitions"), ...competitions.map((item) => make(item.id, item.id))];
}

function rankOf(id) {
  return Number(id.match(/\d+$/)?.[0] || 0);
}

function makeEntry(id, data) {
  const rank = rankOf(id);
  const card = template.content.firstElementChild.cloneNode(true);

  // an in-shell route, so opening a project no longer reloads the page (and
  // with it the Model Latent viewer)
  card.href = `#project/${encodeURIComponent(id)}`;
  card.setAttribute("aria-label", `Open rank ${rank}, entry ${id}`);
  card.classList.toggle("winner", rank === 1);
  card.querySelector(".rank").textContent = String(rank).padStart(2, "0");
  card.querySelector(".entry-id").textContent = id;
  card.querySelector(".winner-badge").hidden = rank !== 1;

  const image = card.querySelector("img");
  image.src = `./assets/model-references/${id}/isometric_marked.png`;
  image.alt = `${id} sampled model, isometric view`;
  image.draggable = false;
  card.querySelector(".entry-copy p").textContent = data.object_description;
  card.querySelector(".positive-count").textContent = `${data.jury_expression.positive.length} positive`;
  card.querySelector(".negative-count").textContent = `${data.jury_expression.negative.length} critical`;
  return card;
}

function enableHorizontalNavigation(container) {
  let activeTouchPointer = null;
  let mouseActive = false;
  let startX = 0;
  let startScrollLeft = 0;
  let dragged = false;
  let suppressClick = false;

  container.addEventListener("wheel", (event) => {
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) || container.scrollWidth <= container.clientWidth) return;
    const previous = container.scrollLeft;
    container.scrollLeft += event.deltaY;
    if (container.scrollLeft !== previous) event.preventDefault();
  }, { passive: false });
  container.addEventListener("dragstart", (event) => event.preventDefault());

  const beginDrag = (clientX) => {
    startX = clientX;
    startScrollLeft = container.scrollLeft;
    dragged = false;
    container.classList.add("drag-ready");
  };

  const moveDrag = (clientX, event) => {
    const distance = clientX - startX;
    if (Math.abs(distance) > 5) dragged = true;
    if (!dragged) return;
    container.classList.add("dragging");
    container.scrollLeft = startScrollLeft - distance;
    event.preventDefault();
  };

  const finishDrag = () => {
    if (dragged) {
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 0);
    }
    container.classList.remove("drag-ready", "dragging");
  };

  // Desktop: track on document so dragging continues outside the row or card.
  container.addEventListener("mousedown", (event) => {
    if (event.button !== 0) return;
    mouseActive = true;
    beginDrag(event.clientX);
  });
  document.addEventListener("mousemove", (event) => {
    if (!mouseActive) return;
    moveDrag(event.clientX, event);
  });
  document.addEventListener("mouseup", (event) => {
    if (!mouseActive || event.button !== 0) return;
    mouseActive = false;
    finishDrag();
  });
  window.addEventListener("blur", () => {
    if (!mouseActive) return;
    mouseActive = false;
    finishDrag();
  });

  // Touch and pen retain pointer capture for off-element movement.
  container.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" || event.button !== 0) return;
    activeTouchPointer = event.pointerId;
    beginDrag(event.clientX);
    container.setPointerCapture(event.pointerId);
  });
  container.addEventListener("pointermove", (event) => {
    if (event.pointerId !== activeTouchPointer) return;
    moveDrag(event.clientX, event);
  });
  const finishTouchDrag = (event) => {
    if (event.pointerId !== activeTouchPointer) return;
    if (container.hasPointerCapture(event.pointerId)) container.releasePointerCapture(event.pointerId);
    activeTouchPointer = null;
    finishDrag();
  };
  container.addEventListener("pointerup", finishTouchDrag);
  container.addEventListener("pointercancel", finishTouchDrag);

  container.addEventListener("click", (event) => {
    if (!suppressClick) return;
    event.preventDefault();
    event.stopPropagation();
    suppressClick = false;
  }, true);

  container.tabIndex = 0;
  container.setAttribute("aria-label", "Ranked entries; drag or use arrow keys to browse");
  container.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    container.scrollBy({ left: event.key === "ArrowLeft" ? -240 : 240, behavior: "smooth" });
    event.preventDefault();
  });
}

async function loadIndex() {
  const manifestResponse = await fetch(MANIFEST_URL);
  if (!manifestResponse.ok) throw new Error(`Manifest returned ${manifestResponse.status}`);
  competitions = await manifestResponse.json();
  buildFilterButtons();

  const ids = competitions.flatMap((competition) => competition.entries);
  const records = await Promise.all(ids.map(async (id) => {
    const response = await fetch(`../data/extracted/designs/${id}.json`);
    if (!response.ok) throw new Error(`${id} returned ${response.status}`);
    return [id, await response.json()];
  }));
  const dataById = new Map(records);

  for (const competition of competitions) {
    const section = document.createElement("section");
    section.className = "competition-row";
    section.dataset.competition = competition.id;
    const meta = document.createElement("header");
    meta.className = "competition-meta";
    meta.innerHTML = `<span>COMPETITION</span><h2>${competition.id}</h2><p>${competition.entries.length} entries</p>`;
    const entries = document.createElement("div");
    entries.className = "ranked-entries";
    enableHorizontalNavigation(entries);

    [...competition.entries].sort((a, b) => rankOf(a) - rankOf(b)).forEach((id) => {
      const data = dataById.get(id);
      entries.append(makeEntry(id, data));
    });
    section.append(meta, entries);
    section.dataset.entries = competition.entries.length;
    section.dataset.critiques = competition.entries.reduce((count, id) => {
      const data = dataById.get(id);
      return count + data.jury_expression.positive.length + data.jury_expression.negative.length;
    }, 0);
    list.append(section);
  }

  const requested = new URLSearchParams(location.search).get("competition");
  activeCompetition = competitions.some((competition) => competition.id === requested) ? requested : "all";
  applyCompetitionFilter(false);
  document.body.dataset.ready = "true";
}

function applyCompetitionFilter(updateUrl = true) {
  document.querySelectorAll(".competition-row").forEach((row) => {
    const show = activeCompetition === "all" || row.dataset.competition === activeCompetition;
    row.hidden = !show;
  });
  filterButtons.forEach((button) => button.classList.toggle("active", button.dataset.competition === activeCompetition));
  if (updateUrl) {
    const url = new URL(location.href);
    if (activeCompetition === "all") url.searchParams.delete("competition");
    else url.searchParams.set("competition", activeCompetition);
    history.replaceState(null, "", url);
  }
}

loadIndex().catch((error) => {
  console.error(error);
  list.textContent = `Could not load competition index: ${error.message}`;
  list.classList.add("error");
  document.body.dataset.ready = "error";
});
