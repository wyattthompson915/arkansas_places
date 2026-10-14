/* Small hand-rolled SVG charts: a line chart and a county map. No libraries. */
const SVG = "http://www.w3.org/2000/svg";
const tip = () => document.getElementById("tooltip");

function el(name, attrs = {}, parent) {
  const node = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

function showTip(html, evt) {
  const t = tip();
  t.innerHTML = html;
  t.hidden = false;
  const pad = 14, w = t.offsetWidth, h = t.offsetHeight;
  let x = evt.clientX + pad, y = evt.clientY + pad;
  if (x + w > innerWidth - 8) x = evt.clientX - w - pad;
  if (y + h > innerHeight - 8) y = evt.clientY - h - pad;
  t.style.left = x + "px";
  t.style.top = y + "px";
}
function hideTip() { tip().hidden = true; }

/* Round tick values covering [min, max]. */
function niceTicks(min, max, count = 4) {
  if (min === max) { min -= 1; max += 1; }
  const raw = (max - min) / count, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw);
  const ticks = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 0.999; v += step) ticks.push(+v.toFixed(10));
  return ticks;
}

/* series: [{name, color, points: [{x, y}]}]   x is a year, y a number.
   opts: {format(y), zero: bool (force axis to include 0), refLine: number} */
function lineChart(container, series, opts = {}) {
  const fmt = opts.format || (v => v.toLocaleString());
  const W = 560, H = 240, m = { t: 12, r: 96, b: 26, l: 52 };
  container.classList.add("chart");
  container.innerHTML = "";
  series = series.filter(s => s.points.length);
  if (!series.length) { container.innerHTML = '<p class="empty">No data</p>'; return; }

  const xs = [...new Set(series.flatMap(s => s.points.map(p => p.x)))].sort((a, b) => a - b);
  const ys = series.flatMap(s => s.points.map(p => p.y));
  let lo = Math.min(...ys), hi = Math.max(...ys);
  if (opts.zero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  if (opts.refLine != null) { lo = Math.min(lo, opts.refLine); hi = Math.max(hi, opts.refLine); }
  const ticks = niceTicks(lo, hi);
  lo = ticks[0]; hi = ticks[ticks.length - 1];
  const x0 = xs[0], x1 = xs[xs.length - 1];
  const sx = x => m.l + (x1 === x0 ? 0.5 : (x - x0) / (x1 - x0)) * (W - m.l - m.r);
  const sy = y => H - m.b - (y - lo) / (hi - lo) * (H - m.t - m.b);

  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" }, container);
  for (const t of ticks) {
    el("line", { class: t === (opts.refLine ?? lo) ? "baseline" : "gridline", x1: m.l, x2: W - m.r, y1: sy(t), y2: sy(t) }, svg);
    el("text", { x: m.l - 8, y: sy(t) + 4, "text-anchor": "end" }, svg).textContent = fmt(t);
  }
  const every = Math.ceil(xs.length / 7);
  xs.forEach((x, i) => {
    if (i % every === 0 || i === xs.length - 1 && (xs.length - 1) % every >= every / 2)
      el("text", { x: sx(x), y: H - 6, "text-anchor": "middle" }, svg).textContent = x;
  });

  const cross = el("line", { class: "cross", y1: m.t, y2: H - m.b, visibility: "hidden" }, svg);
  const dots = [];
  const ends = [];
  for (const s of series) {
    const d = s.points.map((p, i) => `${i ? "L" : "M"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join("");
    el("path", { d, fill: "none", stroke: s.color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
    if (s.points.length <= 8) for (const p of s.points)
      el("circle", { cx: sx(p.x), cy: sy(p.y), r: 3.5, fill: s.color, stroke: "var(--surface)", "stroke-width": 2 }, svg);
    const last = s.points[s.points.length - 1];
    ends.push({ y: sy(last.y), text: series.length > 1 ? `${s.name} ${fmt(last.y)}` : fmt(last.y), x: sx(last.x) });
    dots.push(el("circle", { r: 5, fill: s.color, stroke: "var(--surface)", "stroke-width": 2, visibility: "hidden" }, svg));
  }
  // Direct labels at the line ends, nudged apart so they never overlap.
  ends.sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;
  for (const e of ends) el("text", { class: "endlabel", x: e.x + 8, y: e.y + 4 }, svg).textContent = e.text;

  // Hover: snap to the nearest year, show every series' value there.
  const hit = el("rect", { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: "transparent" }, svg);
  hit.addEventListener("mousemove", evt => {
    const box = svg.getBoundingClientRect();
    const px = (evt.clientX - box.left) / box.width * W;
    const x = xs.reduce((best, v) => Math.abs(sx(v) - px) < Math.abs(sx(best) - px) ? v : best, xs[0]);
    cross.setAttribute("x1", sx(x)); cross.setAttribute("x2", sx(x)); cross.setAttribute("visibility", "visible");
    let html = `<b>${x}</b>`;
    series.forEach((s, i) => {
      const p = s.points.find(q => q.x === x);
      dots[i].setAttribute("visibility", p ? "visible" : "hidden");
      if (!p) return;
      dots[i].setAttribute("cx", sx(p.x)); dots[i].setAttribute("cy", sy(p.y));
      html += `<div class="row"><span><i style="background:${s.color}"></i>${s.name}</span><span>${(opts.tipFormat || fmt)(p.y, p)}</span></div>`;
    });
    showTip(html, evt);
  });
  hit.addEventListener("mouseleave", () => {
    hideTip(); cross.setAttribute("visibility", "hidden");
    dots.forEach(d => d.setAttribute("visibility", "hidden"));
  });
}

/* ---- Maps ---- */
const BLUES = ["#cde2fb", "#86b6ef", "#3987e5", "#1c5cab", "#0d366b"];
const MAP_METRICS = {
  population:     { label: "Population", fmt: v => v.toLocaleString(), scale: "quantile" },
  pop_change_pct: { label: "Population change, 2020–24", fmt: v => (v > 0 ? "+" : "") + v + "%",
                    bins: [-10, -5, 0, 5, 10],
                    colors: ["#b84a1e", "#eb6834", "#f6c3ad", "#b7d3f6", "#3987e5", "#184f95"],
                    binLabels: ["below −10%", "−10 to −5%", "−5 to 0%", "0 to +5%", "+5 to +10%", "above +10%"] },
  gop_margin:     { label: "Presidential margin", fmt: v => (v >= 0 ? "R+" : "D+") + Math.abs(v).toFixed(1),
                    countyOnly: true,              // votes are not reported by city
                    bins: [-20, 0, 20, 40, 60],
                    colors: ["#1c5cab", "#86b6ef", "#f6c7c6", "#ec8f8e", "#e34948", "#a82a2a"],
                    binLabels: ["D+20 or more", "D+0 to 20", "R+0 to 20", "R+20 to 40", "R+40 to 60", "R+60 or more"] },
  density:        { label: "People per sq. mile", fmt: v => Math.round(v).toLocaleString(), scale: "quantile" },
  median_age:     { label: "Median age", fmt: v => v.toFixed(1), scale: "quantile" },
  pct_65plus:     { label: "Age 65 and over", fmt: v => v + "%", scale: "quantile" },
  pct_black:      { label: "Black", fmt: v => v + "%", scale: "quantile" },
  pct_hispanic:   { label: "Hispanic", fmt: v => v + "%", scale: "quantile" },
  median_household_income: { label: "Median household income", fmt: v => "$" + v.toLocaleString(), scale: "quantile" },
  poverty_rate:   { label: "Poverty rate", fmt: v => v + "%", scale: "quantile" },
  pct_bachelors:  { label: "Bachelor's degree or higher", fmt: v => v + "%", scale: "quantile" },
};

const ringsOf = g => g.type === "Polygon" ? [g.coordinates] : g.coordinates;

/* Flat projection fitted to `features`, squeezed east-west by cos(latitude) so shapes look right. */
function fitProjection(features, W, pad = 0) {
  const k = Math.cos(34.8 * Math.PI / 180);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const f of features) for (const poly of ringsOf(f.geometry)) for (const [lon, lat] of poly[0]) {
    minX = Math.min(minX, lon * k); maxX = Math.max(maxX, lon * k);
    minY = Math.min(minY, lat); maxY = Math.max(maxY, lat);
  }
  const s = (W - 2 * pad) / (maxX - minX), H = (maxY - minY) * s + 2 * pad;
  const xy = ([lon, lat]) => [(lon * k - minX) * s + pad, (maxY - lat) * s + pad];
  const path = g => ringsOf(g).map(poly => poly.map(r =>
    "M" + r.map(p => xy(p).map(n => n.toFixed(1)).join(",")).join("L") + "Z").join("")).join("");
  return { W, H, xy, path };
}

/* Colour scale for one metric over a set of values: fixed bins, or five equal-count groups. */
function colorScale(metric, values) {
  let { bins, colors, binLabels: labels } = metric;
  if (metric.scale === "quantile") {
    const v = values.filter(x => x != null).sort((a, b) => a - b);
    bins = [1, 2, 3, 4].map(i => v[Math.floor(v.length * i / 5)]);
    colors = BLUES;
    const edges = [v[0], ...bins, v[v.length - 1]];
    labels = colors.map((_, i) => `${metric.fmt(edges[i])} – ${metric.fmt(edges[i + 1])}`);
  }
  return { colors, labels, colorFor: x => x == null ? "var(--nodata)" : colors[bins.filter(b => x >= b).length] };
}

/* State map. opts: {counties, places, layer: "counties"|"places", metricKey, view, onClick}
   `view` ({k, x, y}) is kept by the caller so zoom survives a redraw. */
function drawMap(container, legendEl, opts) {
  const { counties, places, layer, metricKey, view, onClick } = opts;
  const metric = MAP_METRICS[metricKey];
  const showPlaces = layer === "places";
  const data = showPlaces ? places : counties;
  const scale = colorScale(metric, data.features.map(f => f.properties[metricKey]));
  const P = fitProjection(counties.features, 400);

  container.innerHTML = `<div class="zoom"><button data-z="in" aria-label="Zoom in">+</button>
    <button data-z="out" aria-label="Zoom out">−</button><button data-z="reset" aria-label="Reset zoom">⟲</button></div>`;
  const svg = el("svg", { role: "img" }, container);
  const tipFor = (p, extra = "") => evt => showTip(
    `<b>${p.name}</b>${extra}<div class="row"><span>${metric.label}</span><span>${
      p[metricKey] == null ? "no data" : metric.fmt(p[metricKey])}</span></div>`, evt);

  for (const f of counties.features) {
    const p = f.properties;
    const path = el("path", { d: P.path(f.geometry), class: showPlaces ? "bg" : "area",
                              fill: showPlaces ? "var(--mapbg)" : scale.colorFor(p[metricKey]) }, svg);
    if (showPlaces) continue;
    path.addEventListener("mousemove", tipFor(p));
    path.addEventListener("mouseleave", hideTip);
    path.addEventListener("click", () => onClick(f.id));
  }
  const dots = [];
  if (showPlaces) {
    // Biggest first so small towns are drawn on top and stay clickable. Every place also gets
    // a dot at its centre, because many towns are smaller than a pixel at statewide zoom.
    const sorted = [...places.features].sort((a, b) => (b.properties.land_sqmi || 0) - (a.properties.land_sqmi || 0));
    for (const f of sorted) {
      const p = f.properties, fill = scale.colorFor(p[metricKey]);
      const g = el("g", { class: "place" }, svg);
      const [cx, cy] = P.xy([p.lon, p.lat]);
      dots.push(el("circle", { cx, cy, fill }, g));
      el("path", { d: P.path(f.geometry), fill }, g);
      g.addEventListener("mousemove", tipFor(p, `<div class="muted">${p.kind} in ${p.county_name}</div>`));
      g.addEventListener("mouseleave", hideTip);
      g.addEventListener("click", () => onClick(f.id));
    }
  }
  legendEl.innerHTML = scale.colors.map((c, i) => `<span><i style="background:${c}"></i>${scale.labels[i]}</span>`).join("")
    + (showPlaces ? `<span><i style="background:var(--nodata)"></i>no data</span>` : "");

  // ---- zoom and pan: change the viewBox, never the shapes ----
  const apply = () => {
    view.k = Math.max(1, Math.min(40, view.k));
    const w = P.W / view.k, h = P.H / view.k;
    view.x = Math.max(0, Math.min(P.W - w, view.x));
    view.y = Math.max(0, Math.min(P.H - h, view.y));
    svg.setAttribute("viewBox", `${view.x - 2 / view.k} ${view.y - 2 / view.k} ${w + 4 / view.k} ${h + 4 / view.k}`);
    dots.forEach(d => d.setAttribute("r", 2.2 / view.k));
    svg.style.cursor = view.k > 1 ? "grab" : "";
  };
  const zoomAt = (factor, fx = 0.5, fy = 0.5) => {     // fx, fy: where in the frame to hold still (0-1)
    const w = P.W / view.k, h = P.H / view.k, k = Math.max(1, Math.min(40, view.k * factor));
    view.x += (w - P.W / k) * fx; view.y += (h - P.H / k) * fy; view.k = k;
    apply();
  };
  container.querySelector(".zoom").onclick = e => {
    const z = e.target.dataset.z;
    if (z === "reset") { view.k = 1; view.x = view.y = 0; apply(); }
    else if (z) zoomAt(z === "in" ? 2 : 0.5);
  };
  svg.addEventListener("wheel", e => {
    e.preventDefault();
    const b = svg.getBoundingClientRect();
    zoomAt(e.deltaY < 0 ? 1.3 : 1 / 1.3, (e.clientX - b.left) / b.width, (e.clientY - b.top) / b.height);
  }, { passive: false });
  let drag = null;
  svg.addEventListener("pointerdown", e => { drag = { px: e.clientX, py: e.clientY, x: view.x, y: view.y, moved: false }; });
  addEventListener("pointermove", e => {
    if (!drag || !svg.isConnected) return;
    const b = svg.getBoundingClientRect(), dx = e.clientX - drag.px, dy = e.clientY - drag.py;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    if (!drag.moved) return;
    hideTip();
    view.x = drag.x - dx / b.width * P.W / view.k; view.y = drag.y - dy / b.height * P.H / view.k;
    apply();
  });
  addEventListener("pointerup", () => { setTimeout(() => drag = null, 0); });
  // A drag should not count as a click on whatever shape the pointer ends over.
  svg.addEventListener("click", e => { if (drag?.moved) e.stopPropagation(); }, true);
  apply();
}

/* Small map of one county with its cities and towns. data: {county, places} */
function drawLocator(container, data, highlightId, onClick) {
  const P = fitProjection([data.county], 400, 6);
  container.innerHTML = "";
  const svg = el("svg", { viewBox: `0 0 ${P.W} ${P.H}`, role: "img" }, container);
  el("path", { d: P.path(data.county.geometry), class: "county" }, svg);
  const sorted = [...data.places].sort((a, b) => (b.properties.land_sqmi || 0) - (a.properties.land_sqmi || 0));
  for (const f of sorted) {
    const p = f.properties;
    const g = el("g", { class: "place" + (f.id === highlightId ? " on" : "") }, svg);
    const [cx, cy] = P.xy([p.lon, p.lat]);
    el("circle", { cx, cy, r: 3 }, g);
    el("path", { d: P.path(f.geometry) }, g);
    g.addEventListener("mousemove", evt => showTip(
      `<b>${p.name}</b><div class="row"><span>Population</span><span>${(p.population ?? 0).toLocaleString()}</span></div>`, evt));
    g.addEventListener("mouseleave", hideTip);
    g.addEventListener("click", () => { hideTip(); onClick(f.id); });
  }
}
