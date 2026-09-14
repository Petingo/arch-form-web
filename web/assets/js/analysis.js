const SVG_NS = "http://www.w3.org/2000/svg";
const signalList = document.querySelector("#signal-list");
const tagSelect = document.querySelector("#tag-select");
const expressionGrid = document.querySelector("#expression-grid");
const tooltip = document.querySelector("#chart-tooltip");
const chartContainers = [...document.querySelectorAll(".chart")];
const state = { prevalence: "positive", winner: 12, pairwise: 12, heatmap: "both", emphasis: 12, signal: "18", palette: "color" };
const analysisMain = document.querySelector(".analysis-main");
let chartData = null;
let resizeFrame = null;

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(field); field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field); field = "";
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
    } else field += character;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [headers, ...values] = rows;
  return values.map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])));
}

async function fetchCsv(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return parseCsv(await response.text());
}

function svgNode(name, attributes = {}, content = "") {
  const node = document.createElementNS(SVG_NS, name);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
  if (content !== "") node.textContent = content;
  return node;
}

function chartSvg(container, width, height) {
  container.replaceChildren();
  const svg = svgNode("svg", { viewBox: `0 0 ${width} ${height}`, width, height, "aria-hidden": "true" });
  container.append(svg);
  return svg;
}

function showTooltip(event, title, rows) {
  tooltip.replaceChildren();
  const strong = document.createElement("strong");
  strong.textContent = title;
  tooltip.append(strong);
  rows.forEach((row) => {
    const line = document.createElement("span");
    line.textContent = row;
    tooltip.append(line);
  });
  tooltip.hidden = false;
  moveTooltip(event);
}

function moveTooltip(event) {
  const width = tooltip.offsetWidth || 220;
  const height = tooltip.offsetHeight || 90;
  tooltip.style.left = `${Math.min(event.clientX + 15, innerWidth - width - 12)}px`;
  tooltip.style.top = `${Math.min(event.clientY + 15, innerHeight - height - 12)}px`;
}

function addHover(node, title, rows) {
  node.classList.add("chart-hit");
  node.addEventListener("pointerenter", (event) => showTooltip(event, title, rows));
  node.addEventListener("pointermove", moveTooltip);
  node.addEventListener("pointerleave", () => { tooltip.hidden = true; });
}

function ticks(minimum, maximum, count = 5) {
  const values = [];
  for (let index = 0; index <= count; index += 1) values.push(minimum + (maximum - minimum) * index / count);
  return values;
}

/**
 * Charts are sized from their container so they never overflow the card. The
 * floor only covers the case where the container reports 0 (a hidden pane);
 * it used to be wide enough to force a horizontal scroll in the half-width
 * cards on narrower viewports.
 */
function chartWidth(container, floor) {
  // Never exceed the container: returning the floor when the container is
  // narrower is what made a chart overflow its card and scroll sideways.
  // A hidden pane reports 0, and the ResizeObserver re-renders once shown.
  return container.clientWidth || floor;
}

function renderPrevalence() {
  const container = document.querySelector("#prevalence-chart");
  const width = chartWidth(container, 420);
  const records = chartData.prevalence
    .filter((record) => record.polarity === state.prevalence)
    .sort((a, b) => Number(b.design_prevalence_pct) - Number(a.design_prevalence_pct))
    .slice(0, 18);
  const margin = { top: 24, right: 52, bottom: 48, left: 155 };
  const rowHeight = 31;
  const height = margin.top + records.length * rowHeight + margin.bottom;
  const plotWidth = width - margin.left - margin.right;
  const svg = chartSvg(container, width, height);

  ticks(0, 100, 4).forEach((value) => {
    const x = margin.left + plotWidth * value / 100;
    svg.append(svgNode("line", { x1: x, y1: margin.top - 8, x2: x, y2: height - margin.bottom, class: "grid-line" }));
    svg.append(svgNode("text", { x, y: height - 20, class: "axis-tick", "text-anchor": "middle" }, `${value.toFixed(0)}%`));
  });

  records.forEach((record, index) => {
    const value = Number(record.design_prevalence_pct);
    const y = margin.top + index * rowHeight;
    const group = svgNode("g");
    group.append(svgNode("text", { x: margin.left - 12, y: y + 16, class: "row-label", "text-anchor": "end" }, record.tag));
    group.append(svgNode("rect", { x: margin.left, y: y + 5, width: plotWidth * value / 100, height: 15, class: `prevalence-bar ${state.prevalence}` }));
    group.append(svgNode("text", { x: margin.left + plotWidth * value / 100 + 7, y: y + 16, class: "value-label" }, `${value.toFixed(0)}%`));
    group.append(svgNode("rect", { x: 0, y, width, height: rowHeight, class: "hit-area" }));
    addHover(group, record.tag, [
      `${state.prevalence === "positive" ? "Positive" : "Critical"} in ${record.design_count} of ${record.total_designs} designs`,
      `Design prevalence ${value.toFixed(1)}%`,
      `${record.statement_count} statements · ${Number(record.statement_share_pct).toFixed(1)}% of statements`,
    ]);
    svg.append(group);
  });
  svg.append(svgNode("text", { x: margin.left + plotWidth / 2, y: height - 3, class: "axis-title", "text-anchor": "middle" }, "DESIGN PREVALENCE"));
}

function renderIntervalChart(containerId, records, options) {
  const container = document.querySelector(containerId);
  const width = chartWidth(container, 360);
  const filtered = records
    .filter(options.filter)
    .sort((a, b) => Number(b[options.valueKey]) - Number(a[options.valueKey]))
    .slice(0, options.limit);
  const margin = { top: 24, right: 34, bottom: 49, left: 142 };
  const rowHeight = 33;
  const height = margin.top + filtered.length * rowHeight + margin.bottom;
  const plotWidth = width - margin.left - margin.right;
  const allValues = filtered.flatMap((record) => [Number(record[options.lowKey]), Number(record[options.highKey]), Number(record[options.valueKey])]).filter(Number.isFinite);
  let minimum = Math.min(0, ...allValues);
  let maximum = Math.max(0, ...allValues);
  const padding = Math.max((maximum - minimum) * 0.08, options.minimumPadding);
  minimum -= padding;
  maximum += padding;
  const xScale = (value) => margin.left + (value - minimum) / (maximum - minimum) * plotWidth;
  const svg = chartSvg(container, width, height);

  ticks(minimum, maximum, 5).forEach((value) => {
    const x = xScale(value);
    svg.append(svgNode("line", { x1: x, y1: margin.top - 8, x2: x, y2: height - margin.bottom, class: Math.abs(value) < 1e-8 ? "zero-line" : "grid-line" }));
    svg.append(svgNode("text", { x, y: height - 21, class: "axis-tick", "text-anchor": "middle" }, options.tick(value)));
  });

  filtered.forEach((record, index) => {
    const value = Number(record[options.valueKey]);
    const low = Number(record[options.lowKey]);
    const high = Number(record[options.highKey]);
    const y = margin.top + index * rowHeight + 12;
    const group = svgNode("g");
    group.append(svgNode("text", { x: margin.left - 12, y: y + 4, class: "row-label", "text-anchor": "end" }, record.tag));
    group.append(svgNode("line", { x1: xScale(low), y1: y, x2: xScale(high), y2: y, class: "interval-line" }));
    group.append(svgNode("line", { x1: xScale(low), y1: y - 4, x2: xScale(low), y2: y + 4, class: "interval-cap" }));
    group.append(svgNode("line", { x1: xScale(high), y1: y - 4, x2: xScale(high), y2: y + 4, class: "interval-cap" }));
    group.append(svgNode("circle", { cx: xScale(value), cy: y, r: 5, class: value >= 0 ? "interval-point positive" : "interval-point negative" }));
    group.append(svgNode("rect", { x: 0, y: y - 13, width, height: rowHeight, class: "hit-area" }));
    addHover(group, record.tag, options.tooltip(record, value, low, high));
    svg.append(group);
  });
  svg.append(svgNode("text", { x: margin.left + plotWidth / 2, y: height - 3, class: "axis-title", "text-anchor": "middle" }, options.axisTitle));
}

function renderWinner() {
  renderIntervalChart("#winner-chart", chartData.winner, {
    valueKey: "combined_winner_signal_pp", lowKey: "ci_low", highKey: "ci_high", limit: state.winner, minimumPadding: 3,
    filter: (record) => Number(record.ranked_design_support) >= 50 && Number.isFinite(Number(record.ci_low)),
    tick: (value) => `${value.toFixed(0)}`,
    axisTitle: "COMBINED WINNER SIGNAL · PERCENTAGE POINTS",
    tooltip: (record, value, low, high) => [`Signal ${value.toFixed(1)} pp`, `95% CI ${low.toFixed(1)} to ${high.toFixed(1)}`, `${record.ranked_design_support} ranked-design support`],
  });
}

function renderPairwise() {
  renderIntervalChart("#pairwise-chart", chartData.pairwise, {
    valueKey: "pairwise_advantage_score", lowKey: "ci_low", highKey: "ci_high", limit: state.pairwise, minimumPadding: 0.04,
    filter: (record) => Number(record.discordant_evidence) >= 100 && Number.isFinite(Number(record.ci_low)),
    tick: (value) => value.toFixed(2),
    axisTitle: "PAIRWISE ADVANTAGE SCORE",
    tooltip: (record, value, low, high) => [`Advantage ${value.toFixed(3)}`, `95% CI ${low.toFixed(3)} to ${high.toFixed(3)}`, `${record.discordant_evidence} discordant comparisons`],
  });
}

function heatColor(value) {
  const amount = Math.max(0, Math.min(1, value / 100));
  const from = [244, 245, 189];
  const to = [17, 48, 109];
  return `rgb(${from.map((channel, index) => Math.round(channel + (to[index] - channel) * amount)).join(",")})`;
}

function renderHeatmap() {
  const container = document.querySelector("#heatmap-chart");
  const width = chartWidth(container, 520);
  const tags = ["layout", "functionality", "urban integration", "circulation", "open space", "massing", "expression", "landscape", "daylight", "structure", "sustainability", "cost", "facade", "identity", "flexibility"];
  const polarities = state.heatmap === "both" ? ["positive", "negative"] : [state.heatmap];
  const ranks = ["Rank 1", "Rank 2–3", "Rank 4+"];
  const columns = polarities.flatMap((polarity) => ranks.map((rank) => ({ polarity, rank })));
  const margin = { top: 72, right: 22, bottom: 22, left: 150 };
  const rowHeight = 35;
  const height = margin.top + tags.length * rowHeight + margin.bottom;
  // Separate the POSITIVE block from the CRITICAL one so the two groups of
  // rank columns read as distinct rather than one continuous band.
  const groupGap = polarities.length > 1 ? 22 : 0;
  const cellWidth = (width - margin.left - margin.right - groupGap * (polarities.length - 1)) / columns.length;
  const columnX = (index) => margin.left + index * cellWidth + Math.floor(index / ranks.length) * groupGap;
  const lookup = new Map(chartData.rankProfile.map((record) => [`${record.tag}:${record.polarity}:${record.rank_group}`, record]));
  const svg = chartSvg(container, width, height);

  columns.forEach((column, index) => {
    const x = columnX(index) + cellWidth / 2;
    svg.append(svgNode("text", { x, y: 29, class: `column-polarity ${column.polarity}`, "text-anchor": "middle" }, column.polarity === "positive" ? "POSITIVE" : "CRITICAL"));
    svg.append(svgNode("text", { x, y: 49, class: "column-label", "text-anchor": "middle" }, column.rank.replace("Rank ", "R")));
  });

  tags.forEach((tag, rowIndex) => {
    const y = margin.top + rowIndex * rowHeight;
    svg.append(svgNode("text", { x: margin.left - 12, y: y + 22, class: "row-label", "text-anchor": "end" }, tag));
    columns.forEach((column, columnIndex) => {
      const record = lookup.get(`${tag}:${column.polarity}:${column.rank}`);
      const value = Number(record?.prevalence_pct || 0);
      const x = columnX(columnIndex);
      const group = svgNode("g");
      group.append(svgNode("rect", { x: x + 1, y: y + 1, width: cellWidth - 2, height: rowHeight - 2, fill: heatColor(value), class: "heat-cell" }));
      group.append(svgNode("text", { x: x + cellWidth / 2, y: y + 22, class: value > 58 ? "heat-value light" : "heat-value", "text-anchor": "middle" }, value.toFixed(0)));
      addHover(group, tag, [`${column.polarity === "positive" ? "Positive" : "Critical"} · ${column.rank}`, `${value.toFixed(1)}% design prevalence`, `${record?.design_count || 0} of ${record?.total_designs || 0} designs`]);
      svg.append(group);
    });
  });
}

function renderEmphasis() {
  renderIntervalChart("#emphasis-chart", chartData.emphasis, {
    valueKey: "combined_emphasis_signal_pp", lowKey: "ci_low", highKey: "ci_high", limit: state.emphasis, minimumPadding: 0.8,
    filter: (record) => Number(record.ranked_design_support) >= 50 && Number.isFinite(Number(record.ci_low)),
    tick: (value) => value.toFixed(1),
    axisTitle: "COMBINED NORMALIZED EMPHASIS · PERCENTAGE POINTS",
    tooltip: (record, value, low, high) => [`Emphasis ${value.toFixed(2)} pp`, `95% CI ${low.toFixed(2)} to ${high.toFixed(2)}`, `${record.ranked_design_support} ranked-design support`],
  });
}

function renderCharts() {
  if (!chartData) return;
  renderPrevalence();
  renderWinner();
  renderPairwise();
  renderHeatmap();
  renderEmphasis();
}

function renderSignals(records) {
  // Drawn like the Tag prevalence chart rather than as a bespoke list, and the
  // control exposes all 33 tags -- this used to be hard-coded to the top 6.
  const limit = state.signal === "all" ? records.length : Number(state.signal);
  const sorted = [...records]
    .sort((a, b) => Number(b.combined_winner_signal_pp) - Number(a.combined_winner_signal_pp))
    .slice(0, limit);

  const container = signalList;
  const width = chartWidth(container, 420);
  const margin = { top: 24, right: 64, bottom: 48, left: 155 };
  const rowHeight = 31;
  const height = margin.top + sorted.length * rowHeight + margin.bottom;
  const plotWidth = width - margin.left - margin.right;

  const values = sorted.map((record) => Number(record.combined_winner_signal_pp));
  const low = Math.min(0, ...values);
  const high = Math.max(1, ...values);
  const x = (value) => margin.left + plotWidth * (value - low) / (high - low);

  const svg = chartSvg(container, width, height);

  ticks(low, high, 4).forEach((value) => {
    svg.append(svgNode("line", { x1: x(value), y1: margin.top - 8, x2: x(value), y2: height - margin.bottom, class: "grid-line" }));
    svg.append(svgNode("text", { x: x(value), y: height - 20, class: "axis-tick", "text-anchor": "middle" }, `${value.toFixed(0)}`));
  });

  sorted.forEach((record, index) => {
    const value = Number(record.combined_winner_signal_pp);
    const y = margin.top + index * rowHeight;
    const group = svgNode("g");
    group.append(svgNode("text", { x: margin.left - 12, y: y + 16, class: "row-label", "text-anchor": "end" }, record.tag));
    const from = Math.min(x(0), x(value));
    group.append(svgNode("rect", { x: from, y: y + 5, width: Math.max(1, Math.abs(x(value) - x(0))), height: 15, class: `prevalence-bar ${value < 0 ? "negative" : "positive"}` }));
    group.append(svgNode("text", { x: x(value) + (value < 0 ? -7 : 7), y: y + 16, class: "value-label", "text-anchor": value < 0 ? "end" : "start" }, `${value > 0 ? "+" : ""}${value.toFixed(1)}`));
    group.append(svgNode("rect", { x: 0, y, width, height: rowHeight, class: "hit-area" }));
    addHover(group, record.tag, [
      `Winner signal ${value > 0 ? "+" : ""}${value.toFixed(1)} pp`,
      `95% CI ${Number(record.ci_low).toFixed(1)} to ${Number(record.ci_high).toFixed(1)}`,
      `${record.ranked_design_support} ranked designs`,
    ]);
    svg.append(group);
  });

  svg.append(svgNode("line", { x1: x(0), y1: margin.top - 8, x2: x(0), y2: height - margin.bottom, class: "grid-line zero" }));
  svg.append(svgNode("text", { x: margin.left + plotWidth / 2, y: height - 3, class: "axis-title", "text-anchor": "middle" }, "WINNER SIGNAL (PERCENTAGE POINTS)"));
}

function renderExpressions(records, tag) {
  expressionGrid.replaceChildren();
  records.filter((record) => record.tag === tag).slice(0, 8).forEach((record) => {
    const card = document.createElement("article");
    card.className = `expression-card ${record.polarity}`;
    card.innerHTML = `<header><span></span><b></b><i></i></header><p></p>`;
    card.querySelector("span").textContent = record.design_id;
    card.querySelector("b").textContent = `RANK ${record.rank}`;
    card.querySelector("i").textContent = record.polarity;
    card.querySelector("p").textContent = record.statement;
    expressionGrid.append(card);
  });
}

document.querySelectorAll(".chart-controls").forEach((controls) => {
  controls.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    const name = controls.dataset.control;
    state[name] = ["winner", "pairwise", "emphasis"].includes(name) ? Number(button.dataset.value) : button.dataset.value;
    controls.querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === button));
    tooltip.hidden = true;
    if (name === "palette") {
      // A filter on the chart containers covers every colour at once, including
      // the heatmap cells whose fill is set per-cell in JS.
      analysisMain.dataset.palette = state.palette;
      return;
    }
    if (name === "signal") renderSignals(chartData.winner);
    else renderCharts();
  });
});

new ResizeObserver(() => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(renderCharts);
}).observe(document.querySelector(".figure-grid"));

async function loadAnalysis() {
  const [winner, expressions, prevalence, pairwise, rankProfile, emphasis] = await Promise.all([
    fetchCsv("../jury-text-analysis/results/winner_tag_signal.csv"),
    fetchCsv("../jury-text-analysis/results/representative_expressions.csv"),
    fetchCsv("../jury-text-analysis/results/tag_frequency.csv"),
    fetchCsv("../jury-text-analysis/results/pairwise_rank_signal.csv"),
    fetchCsv("../jury-text-analysis/results/rank_profile.csv"),
    fetchCsv("../jury-text-analysis/results/winner_tag_emphasis.csv"),
  ]);
  chartData = { winner, prevalence, pairwise, rankProfile, emphasis };
  renderSignals(winner);
  renderCharts();
  const tags = [...new Set(expressions.map((record) => record.tag))];
  tags.forEach((tag) => tagSelect.add(new Option(tag, tag)));
  const initialTag = tags.includes("urban integration") ? "urban integration" : tags[0];
  tagSelect.value = initialTag;
  renderExpressions(expressions, initialTag);
  tagSelect.addEventListener("change", () => renderExpressions(expressions, tagSelect.value));
  document.body.dataset.ready = "true";
}

// Charts are sized from their container, so they are rebuilt whenever that
// container changes width -- a window resize, but also the pane being shown for
// the first time, which a window resize listener alone would miss.
let resizeTimer = null;
const observedWidths = new Map();
const chartObserver = new ResizeObserver((entries) => {
  let changed = false;
  for (const entry of entries) {
    const width = Math.round(entry.contentRect.width);
    if (!width || observedWidths.get(entry.target) === width) continue;
    observedWidths.set(entry.target, width);
    changed = true;
  }
  if (!changed || !chartData) return;
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    renderCharts();
    renderSignals(chartData.winner);
  }, 160);
});

for (const id of ["#signal-list", "#prevalence-chart", "#winner-chart", "#pairwise-chart", "#heatmap-chart", "#emphasis-chart"]) {
  const container = document.querySelector(id);
  if (container) chartObserver.observe(container);
}

loadAnalysis().catch((error) => {
  console.error(error);
  signalList.textContent = `Could not load analysis: ${error.message}`;
  expressionGrid.replaceChildren();
  document.body.dataset.ready = "error";
});
