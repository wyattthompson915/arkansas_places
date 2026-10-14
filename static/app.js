/* Arkansas Places front end: three views (browse, place detail, compare) driven by the URL hash. */
const view = document.getElementById("view");
const SLOT = ["var(--s1)", "var(--s2)", "var(--s3)"];   // compare colours, fixed by position
const api = path => fetch("/api/" + path).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const num = v => v == null ? "–" : Math.round(v).toLocaleString();
const pctFmt = v => v == null ? "–" : v.toFixed(1) + "%";
const money = v => v == null ? "–" : "$" + Math.round(v).toLocaleString();
const signed = v => v == null ? "–" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(1) + "%";
const margin = v => v == null ? "–" : (v >= 0 ? "R+" : "D+") + Math.abs(v).toFixed(1);
const trend = v => v == null ? "" : v > 0 ? "up" : v < 0 ? "down" : "";
const kindLabel = k => k[0].toUpperCase() + k.slice(1);

/* ---- compare list (kept in the browser so it survives a refresh) ---- */
const compare = {
  ids: (() => { try { return JSON.parse(localStorage.getItem("compare") || "[]"); } catch { return []; } })(),
  save() { try { localStorage.setItem("compare", JSON.stringify(this.ids)); } catch {} updateNav(); },
  has(id) { return this.ids.includes(id); },
  toggle(id) {
    if (this.has(id)) this.ids = this.ids.filter(x => x !== id);
    else if (this.ids.length < 3) this.ids.push(id);
    else return false;
    this.save();
    return true;
  },
};

function updateNav() {
  const route = location.hash.split("/")[1] || "browse";
  document.querySelectorAll("[data-nav]").forEach(a =>
    a.classList.toggle("active", a.dataset.nav === (route === "place" ? "browse" : route)));
  document.getElementById("compare-count").textContent = compare.ids.length || "";
}

/* ---- Browse: map + table ---- */
const browse = { q: "", kind: "", county: "", sort: "population", order: "desc", metric: "population",
                 layer: "counties", view: { k: 1, x: 0, y: 0 }, placesGeo: null };
const COLUMNS = [
  ["name", "Name", "left"], ["kind", "Type", "left"], ["county_name", "County", "left"],
  ["population", "Population"], ["pop_change_pct", "Change"], ["median_age", "Median age"],
  ["pct_white", "White"], ["pct_black", "Black"], ["pct_hispanic", "Hispanic"], ["pct_65plus", "65+"],
  ["median_household_income", "Household income"], ["poverty_rate", "Poverty"], ["pct_bachelors", "Bachelor's+"],
  ["gop_margin", "Pres. margin"],
];

async function renderBrowse() {
  const [geo, counties] = await Promise.all([api("map"), api("places?kind=county&sort=name&order=asc")]);
  view.innerHTML = `
    <div class="grid browse">
      <section class="card map">
        <h2>Map</h2>
        <p class="sub">Click a place to open it. Scroll or use the buttons to zoom, drag to move.</p>
        <div class="controls">
          <div class="seg" id="layer"><button data-layer="counties">Counties</button><button data-layer="places">Cities &amp; towns</button></div>
          <select id="metric" aria-label="Map colour"></select>
        </div>
        <div id="map" class="mapframe"></div><div id="legend" class="legend"></div>
      </section>
      <section class="card">
        <div class="controls">
          <input id="q" type="search" placeholder="Search counties, cities and towns" value="${esc(browse.q)}">
          <div class="seg" id="kind">
            <button data-kind="">All</button><button data-kind="county">Counties</button>
            <button data-kind="municipality">Cities &amp; towns</button>
          </div>
          <select id="county" aria-label="County"><option value="">Any county</option>${counties
            .map(c => `<option value="${c.geoid}">${esc(c.name)}</option>`).join("")}</select>
          <span class="count" id="count"></span>
        </div>
        <div class="table-wrap"><table><thead id="thead"></thead><tbody id="tbody"></tbody></table></div>
      </section>
    </div>`;

  const metricSel = document.getElementById("metric");
  const paint = async () => {
    const cities = browse.layer === "places";
    if (cities && !browse.placesGeo) browse.placesGeo = await api("map?layer=places");   // fetched once, on first use
    if (cities && MAP_METRICS[browse.metric].countyOnly) browse.metric = "population";
    if (!document.getElementById("map")) return;
    metricSel.innerHTML = Object.entries(MAP_METRICS).filter(([, m]) => !(cities && m.countyOnly))
      .map(([k, m]) => `<option value="${k}">${m.label}</option>`).join("");
    metricSel.value = browse.metric;
    document.querySelectorAll("#layer button").forEach(b => b.classList.toggle("on", b.dataset.layer === browse.layer));
    drawMap(document.getElementById("map"), document.getElementById("legend"), {
      counties: geo, places: browse.placesGeo, layer: browse.layer, metricKey: browse.metric, view: browse.view,
      onClick: id => { hideTip(); location.hash = "#/place/" + id; },
    });
  };
  metricSel.onchange = () => { browse.metric = metricSel.value; paint(); };
  document.querySelectorAll("#layer button").forEach(b => b.onclick = () => { browse.layer = b.dataset.layer; paint(); });
  paint();

  const countySel = document.getElementById("county");
  countySel.value = browse.county;
  countySel.onchange = () => { browse.county = countySel.value; loadTable(); };
  let timer;
  document.getElementById("q").oninput = e => {
    browse.q = e.target.value; clearTimeout(timer); timer = setTimeout(loadTable, 150);
  };
  document.querySelectorAll("#kind button").forEach(b => b.onclick = () => { browse.kind = b.dataset.kind; loadTable(); });
  document.getElementById("thead").onclick = e => {
    const key = e.target.closest("th")?.dataset.key;
    if (!key) return;
    if (browse.sort === key) browse.order = browse.order === "asc" ? "desc" : "asc";
    else { browse.sort = key; browse.order = ["name", "kind", "county_name"].includes(key) ? "asc" : "desc"; }
    loadTable();
  };
  document.getElementById("tbody").onclick = e => {
    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;
    if (e.target.matches("input[type=checkbox]")) {
      if (!compare.toggle(tr.dataset.id)) { e.target.checked = false; alert("You can compare up to three places."); }
    } else location.hash = "#/place/" + tr.dataset.id;
  };
  loadTable();
}

async function loadTable() {
  const { q, kind, county, sort, order } = browse;
  const data = await api("places?" + new URLSearchParams({ q, kind, county, sort, order }));
  if (!document.getElementById("tbody")) return;       // user navigated away meanwhile
  document.querySelectorAll("#kind button").forEach(b => b.classList.toggle("on", b.dataset.kind === kind));
  document.getElementById("thead").innerHTML = "<tr><th class='left' title='Add to compare'>Compare</th>" +
    COLUMNS.map(([key, label, cls]) => `<th data-key="${key}" class="${cls || ""} ${sort === key ? "sorted" : ""}">${label}${
      sort === key ? (order === "asc" ? " ▲" : " ▼") : ""}</th>`).join("") + "</tr>";
  document.getElementById("count").textContent = `${data.length} place${data.length === 1 ? "" : "s"}`;
  document.getElementById("tbody").innerHTML = data.length ? data.map(p => `
    <tr class="rowlink" data-id="${p.geoid}">
      <td class="left"><input type="checkbox" aria-label="Compare ${esc(p.name)}" ${compare.has(p.geoid) ? "checked" : ""}></td>
      <td class="left name">${esc(p.name)}</td>
      <td class="left"><span class="tag">${kindLabel(p.kind)}</span></td>
      <td class="left">${p.kind === "county" ? "" : esc(p.county_name)}</td>
      <td>${num(p.population)}</td>
      <td class="${trend(p.pop_change_pct)}">${signed(p.pop_change_pct)}</td>
      <td>${p.median_age == null ? "–" : p.median_age.toFixed(1)}</td>
      <td>${pctFmt(p.pct_white)}</td><td>${pctFmt(p.pct_black)}</td><td>${pctFmt(p.pct_hispanic)}</td><td>${pctFmt(p.pct_65plus)}</td>
      <td>${money(p.median_household_income)}</td><td>${pctFmt(p.poverty_rate)}</td><td>${pctFmt(p.pct_bachelors)}</td>
      <td>${margin(p.gop_margin)}</td>
    </tr>`).join("") : `<tr><td colspan="${COLUMNS.length + 1}" class="empty">${
      kind === "municipality" && !q && !county ? "No cities or towns are loaded yet." : "Nothing matches those filters."}</td></tr>`;
}

/* ---- Place detail ---- */
function barList(items) {
  const max = Math.max(...items.map(i => i[1] ?? 0), 1);
  return `<div class="bars">${items.map(([label, v]) => `
    <span>${label}</span><div class="track"><div class="fill" style="width:${(v ?? 0) / max * 100}%"></div></div>
    <span class="v">${pctFmt(v)}</span>`).join("")}</div>`;
}
const voteLegend = `<div class="legend"><span><i class="line" style="background:var(--gop)"></i>Republican</span>
  <span><i class="line" style="background:var(--dem)"></i>Democratic</span></div>`;

async function renderPlace(id) {
  let p;
  try { p = await api("places/" + id); }
  catch { view.innerHTML = `<p class="empty">No place found for “${esc(id)}”. <a href="#/">Back to all places</a></p>`; return; }
  const isCounty = p.kind === "county";
  const last = p.elections[p.elections.length - 1];
  view.innerHTML = `
    <div class="crumbs"><a href="#/">All places</a> › ${isCounty ? "" : `<a href="#/place/${p.county_fips}">${esc(p.county_name)}</a> › `}${esc(p.name)}</div>
    <div class="head">
      <div><h1>${esc(p.name)}</h1>
        <p class="sub">${kindLabel(p.kind)}${isCounty ? "" : " in " + esc(p.county_name)}, Arkansas${
          p.other_counties ? ". Also extends into " + esc(p.other_counties) : ""}</p></div>
      <span class="spacer"></span>
      <button id="cmp" class="primary"></button>
    </div>
    <div class="tiles">
      <div class="card tile"><div class="label">Population</div><div class="value">${num(p.population)}</div>
        <div class="note">${p.pop_year ?? ""} estimate</div></div>
      <div class="card tile"><div class="label">Change since ${p.base_year ?? ""}</div>
        <div class="value ${trend(p.pop_change_pct)}">${signed(p.pop_change_pct)}</div>
        <div class="note">from ${num(p.base_population)}</div></div>
      <div class="card tile"><div class="label">Median age</div><div class="value">${p.median_age == null ? "–" : p.median_age.toFixed(1)}</div>
        <div class="note">${pctFmt(p.pct_65plus)} are 65 or older</div></div>
      <div class="card tile"><div class="label">Median household income</div><div class="value">${money(p.median_household_income)}</div>
        <div class="note">${money(p.per_capita_income)} per person</div></div>
      <div class="card tile"><div class="label">People per sq. mile</div><div class="value">${num(p.density)}</div>
        <div class="note">${p.land_sqmi == null ? "" : (p.land_sqmi < 10 ? p.land_sqmi.toFixed(1) : num(p.land_sqmi)) + " sq. mi of land"}</div></div>
      <div class="card tile"><div class="label">${last ? last.year : ""} presidential margin</div>
        <div class="value">${margin(p.gop_margin)}</div>
        <div class="note">${isCounty ? "" : esc(p.county_name) + " result"}</div></div>
    </div>
    <div class="grid two">
      <section class="card"><h2>Population</h2><p class="sub">Annual July 1 estimates</p><div id="pop"></div></section>
      <section class="card"><h2>Presidential vote share</h2>
        <p class="sub">${isCounty ? "County results" : "Results for " + esc(p.county_name) + "; votes are not reported by city"}</p>
        <div id="votes"></div>${voteLegend}</section>
      <section class="card"><h2>Race and ethnicity</h2><p class="sub">Share of residents, 2019–2023 survey average</p>
        ${barList([["White", p.pct_white], ["Black", p.pct_black], ["Hispanic or Latino", p.pct_hispanic],
                   ["Asian", p.pct_asian], ["Other or multiple", p.pct_other]])}
        <p class="sub" style="margin:10px 0 0">Race groups exclude Hispanic residents, so the bars add to 100%.</p></section>
      <section class="card"><h2>Age, education and poverty</h2>
        <p class="sub">Share of residents, 2019–2023 survey average</p>
        ${barList([["Under 18", p.pct_under18], ["65 and over", p.pct_65plus],
                   ["Bachelor's or higher (age 25+)", p.pct_bachelors], ["Below poverty line", p.poverty_rate]])}</section>
      <section class="card"><h2>Presidential results by year</h2><p class="sub">Votes cast</p>
        <div class="table-wrap"><table><thead><tr><th class="left">Year</th><th>Republican</th><th>Democratic</th><th>Total</th><th>Margin</th></tr></thead>
        <tbody>${p.elections.map(e => `<tr><td class="left">${e.year}</td><td>${num(e.gop)} (${pctFmt(e.gop_pct)})</td>
          <td>${num(e.dem)} (${pctFmt(e.dem_pct)})</td><td>${num(e.total)}</td><td>${margin(e.gop_margin)}</td></tr>`).join("")}</tbody></table></div></section>
      ${isCounty ? `<section class="card"><h2>Cities and towns</h2>
        <p class="sub">Municipalities based in this county; the map also shows any that cross in from a neighbour</p>
        <div id="locator" class="locator"></div>
        ${p.municipalities.length ? `<ul class="munis">${p.municipalities.map(m =>
          `<li><a href="#/place/${m.geoid}">${esc(m.name)}</a> <span class="muted">${num(m.population)}</span></li>`).join("")}</ul>`
          : '<p class="muted">No incorporated cities or towns.</p>'}</section>`
      : `<section class="card"><h2>Location</h2><p class="sub">${esc(p.name)} within ${esc(p.county_name)}; click another place to open it</p>
        <div id="locator" class="locator"></div></section>`}
    </div>`;

  lineChart(document.getElementById("pop"),
    [{ name: "Population", color: "var(--s1)", points: p.population_series.map(r => ({ x: r.year, y: r.population })) }]);
  lineChart(document.getElementById("votes"), [
    { name: "Rep.", color: "var(--gop)", points: p.elections.map(e => ({ x: e.year, y: e.gop_pct })) },
    { name: "Dem.", color: "var(--dem)", points: p.elections.map(e => ({ x: e.year, y: e.dem_pct })) },
  ], { format: v => v.toFixed(0) + "%", tipFormat: v => v.toFixed(1) + "%" });

  api("map/county/" + p.county_fips).then(data => {
    const box = document.getElementById("locator");
    if (box) drawLocator(box, data, id, pid => location.hash = "#/place/" + pid);
  });

  const btn = document.getElementById("cmp");
  const label = () => btn.textContent = compare.has(id) ? "Remove from compare" : "Add to compare";
  btn.onclick = () => { if (!compare.toggle(id)) alert("You can compare up to three places."); label(); };
  label();
}

/* ---- Compare ---- */
async function renderCompare() {
  if (!compare.ids.length) {
    view.innerHTML = `<h1>Compare</h1><p class="empty">Nothing picked yet. Tick up to three places in the
      <a href="#/">table</a>, or use “Add to compare” on a place page.</p>`;
    return;
  }
  const places = await api("compare?ids=" + compare.ids.join(","));
  const row = (label, f) => `<tr><td class="left">${label}</td>${places.map(p => `<td>${f(p)}</td>`).join("")}</tr>`;
  view.innerHTML = `
    <h1>Compare</h1>
    <div class="chips">${places.map((p, i) => `<span class="chip"><i style="background:${SLOT[i]}"></i>
      <a href="#/place/${p.geoid}">${esc(p.name)}</a><button data-remove="${p.geoid}" aria-label="Remove ${esc(p.name)}">×</button></span>`).join("")}</div>
    <div class="grid two">
      <section class="card"><h2>Population growth</h2>
        <p class="sub">Indexed so each place starts at 100, which puts big and small places on one scale</p><div id="c-pop"></div></section>
      <section class="card"><h2>Presidential margin</h2>
        <p class="sub">Republican share minus Democratic share, in points; above the line is Republican. Cities and towns show their county</p><div id="c-margin"></div></section>
    </div>
    <section class="card" style="margin-top:16px"><div class="table-wrap"><table>
      <thead><tr><th class="left">Measure</th>${places.map(p => `<th>${esc(p.name)}</th>`).join("")}</tr></thead><tbody>
      ${row("Type", p => kindLabel(p.kind))}
      ${row("Population", p => `${num(p.population)} <span class="muted">(${p.pop_year ?? ""})</span>`)}
      ${row("Population change", p => `<span class="${trend(p.pop_change_pct)}">${signed(p.pop_change_pct)}</span> <span class="muted">since ${p.base_year ?? ""}</span>`)}
      ${row("People per sq. mile", p => num(p.density))}
      ${row("Median age", p => p.median_age == null ? "–" : p.median_age.toFixed(1))}
      ${row("White", p => pctFmt(p.pct_white))}${row("Black", p => pctFmt(p.pct_black))}
      ${row("Hispanic or Latino", p => pctFmt(p.pct_hispanic))}${row("Asian", p => pctFmt(p.pct_asian))}
      ${row("Other or multiple races", p => pctFmt(p.pct_other))}
      ${row("Under 18", p => pctFmt(p.pct_under18))}${row("65 and over", p => pctFmt(p.pct_65plus))}
      ${row("Median household income", p => money(p.median_household_income))}${row("Income per person", p => money(p.per_capita_income))}
      ${row("Poverty rate", p => pctFmt(p.poverty_rate))}${row("Bachelor's or higher (age 25+)", p => pctFmt(p.pct_bachelors))}
      ${row("Latest presidential margin", p => `${margin(p.gop_margin)} <span class="muted">(${p.election_year ?? ""}${p.kind === "county" ? "" : ", county"})</span>`)}
      </tbody></table></div></section>`;

  // Start every line at the latest first year any of the places has, so they share a baseline.
  const start = Math.max(...places.map(p => p.population_series[0]?.year ?? 0));
  lineChart(document.getElementById("c-pop"), places.map((p, i) => {
    const series = p.population_series.filter(r => r.year >= start);
    const base = series[0]?.population;
    return { name: p.name.replace(" County", ""), color: SLOT[i],
             points: series.map(r => ({ x: r.year, y: r.population / base * 100, raw: r.population })) };
  }), { format: v => String(+v.toFixed(1)), tipFormat: (v, pt) => `${v.toFixed(1)} · ${pt.raw.toLocaleString()}`, refLine: 100 });
  lineChart(document.getElementById("c-margin"), places.map((p, i) => ({
    name: p.name.replace(" County", ""), color: SLOT[i], points: p.elections.map(e => ({ x: e.year, y: e.gop_margin })),
  })), { format: v => margin(v).replace(".0", ""), tipFormat: v => margin(v), refLine: 0 });

  view.querySelectorAll("[data-remove]").forEach(b => b.onclick = () => { compare.toggle(b.dataset.remove); renderCompare(); });
}

/* ---- Data sources ---- */
async function renderAbout() {
  const meta = await api("meta");
  view.innerHTML = `<h1>Data</h1>
    <p class="sub">${meta.counts.map(c => `${c.n} ${c.kind === "county" ? "counties" : c.kind === "city" ? "cities" : "towns"}`).join(" · ")}</p>
    <section class="card"><div class="table-wrap"><table><thead><tr><th class="left">What</th><th class="left">Covers</th><th class="left">Source</th></tr></thead>
    <tbody>${meta.sources.map(s => `<tr><td class="left name">${esc(s.topic)}</td><td class="left">${esc(s.covers)}</td>
      <td class="left"><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.source)}</a></td></tr>`).join("")}</tbody></table></div></section>`;
}

/* ---- Router ---- */
function route() {
  hideTip();
  const [, page, arg] = location.hash.split("/");
  updateNav();
  window.scrollTo(0, 0);
  const go = page === "place" ? renderPlace(arg) : page === "compare" ? renderCompare()
           : page === "about" ? renderAbout() : renderBrowse();
  go.catch(err => { view.innerHTML = `<p class="empty">Could not load data (${esc(err.message)}). Is the API running?</p>`; });
}
addEventListener("hashchange", route);
route();
