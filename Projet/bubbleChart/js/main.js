"use strict";

/* =========================================================
   CONSTANTES & ÉTAT GLOBAL
   ========================================================= */

const CSV_PATH = "../movie_dataset_transform.csv";

const state = {
  rawMovies: [],
  isLoaded: false,
  genres: [],          // liste globale de tous les genres (pour la légende)
  colorScale: null,    // scaleOrdinal partagée
  legendInitialized: false,
    missingPage: 0,          // page actuelle
};

/* =========================================================
   UTILITAIRES
   ========================================================= */

function numOrNull(v) {
  const n = +v;
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse une colonne "liste" (ex: '["Action", "Drama"]') en tableau JS.
 */
function parseJsonList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];

  const raw = value.trim();
  if (!raw) return [];

  // 1) Essai direct JSON.parse
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch (e) {}

  // 2) Essai en remplaçant les "" par "
  try {
    const normalized = raw.replace(/""/g, '"');
    const parsed2 = JSON.parse(normalized);
    if (Array.isArray(parsed2)) return parsed2;
  } catch (e2) {}

  // 3) Fallback : on nettoie à la main
  const cleaned = raw
    .replace(/^\[|\]$/g, "")
    .replace(/""/g, '"')
    .replace(/['"]/g, "");

  const parts = cleaned
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return parts;
}

/** Genre principal pour la couleur (premier genre) */
function getPrimaryGenre(movie) {
  if (Array.isArray(movie.genres) && movie.genres.length > 0) {
    return movie.genres[0];
  }
  return "non renseigné";
}

/* =========================================================
   PARSING LIGNE CSV
   ========================================================= */

function parseRow(d, index) {
  const budget = numOrNull(d.budget);
  const revenue = numOrNull(d.revenue);
  const genresArray = parseJsonList(d.genres);
  const companiesArray = parseJsonList(d.production_companies);

  return {
    _id: index,
    title: d.title || "",
    overview: d.overview || "",
    genres: genresArray,
    vote_average: numOrNull(d.vote_average),
    vote_count: numOrNull(d.vote_count),
    popularity: numOrNull(d.popularity),
    budget,
    revenue,
    runtime: numOrNull(d.runtime),
    year: numOrNull(d.year),
    production_companies: companiesArray,
    profit: budget != null && revenue != null ? revenue - budget : null,
  };
}

/* =========================================================
   FILTRES – LECTURE & APPLICATION
   ========================================================= */

function getFilterValues() {
  const yearMinEl = document.getElementById("year-min");
  const yearMaxEl = document.getElementById("year-max");
  const titleEl = document.getElementById("title-filter");
  const companyEl = document.getElementById("company-filter");
  const topNEl = document.getElementById("top-n");
  const sizeByEl = document.querySelector('input[name="sizeBy"]:checked');

  const yearMin =
    yearMinEl && yearMinEl.value !== "" ? +yearMinEl.value : null;
  const yearMax =
    yearMaxEl && yearMaxEl.value !== "" ? +yearMaxEl.value : null;

  const title = titleEl ? titleEl.value.trim().toLowerCase() : "";
  const company = companyEl
    ? companyEl.value.trim().toLowerCase()
    : "";

  let topN = null;
  if (topNEl) {
    const v = topNEl.value;
    if (v !== "all") {
      const n = parseInt(v, 10);
      topN = Number.isFinite(n) ? n : null;
    }
  }

  const sizeBy = sizeByEl ? sizeByEl.value : "popularity";

  // ⚠️ Désormais on lit les genres cochés DANS LA LÉGENDE
  const genreChecks = document.querySelectorAll(
    "#legend-genres .genre-check:checked"
  );
  const selectedGenres = Array.from(genreChecks).map((el) => el.value);

  return {
    yearMin,
    yearMax,
    title,
    company,
    topN,
    sizeBy,
    selectedGenres,
  };
}

function filterMovies(movies, filters) {
  const selectedGenresLower = (filters.selectedGenres || []).map((g) =>
    g.toLowerCase()
  );

  return movies.filter((m) => {
    // Années
    if (filters.yearMin != null) {
      if (m.year == null || m.year < filters.yearMin) return false;
    }
    if (filters.yearMax != null) {
      if (m.year == null || m.year > filters.yearMax) return false;
    }

    // Titre
    if (filters.title) {
      if (!m.title || !m.title.toLowerCase().includes(filters.title)) {
        return false;
      }
    }

    // Production
    if (filters.company) {
      const companies = Array.isArray(m.production_companies)
        ? m.production_companies
        : [];
      const ok = companies.some((c) =>
        c.toLowerCase().includes(filters.company)
      );
      if (!ok) return false;
    }

    // Genres (film gardé s'il a au moins un genre sélectionné)
    if (selectedGenresLower.length > 0) {
      const movieGenresLower = Array.isArray(m.genres)
        ? m.genres.map((g) => g.toLowerCase())
        : [];
      const ok = selectedGenresLower.some((g) =>
        movieGenresLower.includes(g)
      );
      if (!ok) return false;
    }

    return true;
  });
}

/* =========================================================
   LÉGENDE DES GENRES AVEC CHECKBOX
   ========================================================= */

function buildGenreLegend() {
  const container = d3.select("#legend-genres");
  if (!container.node() || !state.colorScale || !state.genres.length) return;

  container.selectAll("*").remove();

  container
    .selectAll(".legend-item")
    .data(state.genres)
    .enter()
    .append("label")
    .attr("class", "legend-item")
    .each(function (d) {
      const item = d3.select(this);

      // Checkbox = filtre de genre
      item
        .append("input")
        .attr("type", "checkbox")
        .attr("class", "genre-check")
        .attr("value", d)
        .on("change", applyFiltersAndRender);

      // • coloré
      item
        .append("span")
        .text("  ● ")
        .style("color", state.colorScale(d))
        .style("font-size", "14px");

      item
        .append("span")
        .attr("class", "legend-label")
        .text(d);
    });
}

/* =========================================================
   BUBBLE CHART + ZOOM
   ========================================================= */

function renderBaseBubbleChart(movies, filters) {
  const plotArea = d3.select("#plot-area");
  plotArea.text("");

  const width = 900;
  const height = 500;
  // augmenter légèrement les marges pour laisser de la place aux labels
  const margin = { top: 20, right: 20, bottom: 100, left: 80 };

  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  // Films avec budget & revenue valides
  const validMovies = movies.filter(
    (m) =>
      m.budget != null &&
      m.budget > 0 &&
      m.revenue != null &&
      m.revenue > 0
  );

  if (validMovies.length === 0) {
    plotArea.text(
      "Aucun film avec budget et revenue valides après application des filtres."
    );
    return;
  }

  const data = validMovies.map((m) => ({
    ...m,
    primaryGenre: getPrimaryGenre(m),
  }));

  // --- Échelles log ---
  const minBudget = d3.min(data, (d) => d.budget);
  const maxBudget = d3.max(data, (d) => d.budget);
  const minRevenue = d3.min(data, (d) => d.revenue);
  const maxRevenue = d3.max(data, (d) => d.revenue);

  const x = d3
    .scaleLog()
    .domain([Math.max(1, minBudget), maxBudget])
    .range([0, innerWidth]);

  const y = d3
    .scaleLog()
    .domain([Math.max(1, minRevenue), maxRevenue])
    .range([innerHeight, 0]);

  // Taille = popularity ou note
  const sizeMetric =
    filters && filters.sizeBy === "vote_average"
      ? "vote_average"
      : "popularity";

  const sizeValues = data
    .map((d) => d[sizeMetric])
    .filter((v) => v != null && v > 0);

  const r = d3
    .scaleSqrt()
    .domain(d3.extent(sizeValues.length ? sizeValues : [1, 10]))
    .range([4, 25]);

  // Domaine de couleurs = tous les genres possibles (global)
  const genreDomain =
    state.genres && state.genres.length
      ? state.genres
      : Array.from(new Set(data.map((d) => d.primaryGenre)));

  const color = d3
    .scaleOrdinal()
    .domain(genreDomain)
    .range(d3.schemeTableau10.concat(d3.schemeTableau10));

  // On garde cette scale dans le state pour la légende
  state.colorScale = color;

  // Si la légende n'a jamais été créée → on la construit maintenant
  if (!state.legendInitialized && state.genres.length > 0) {
    buildGenreLegend();
    state.legendInitialized = true;
  }

  // === SVG & GROUPES ===
  const svg = plotArea
    .append("svg")
    .attr("width", width)
    .attr("height", height);

  // Clip pour garder les bulles dans le cadre
  svg
    .append("defs")
    .append("clipPath")
    .attr("id", "plot-clip")
    .append("rect")
    .attr("width", innerWidth)
    .attr("height", innerHeight);

  const g = svg
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  const axesG = g.append("g");
  const dotsG = g
    .append("g")
    .attr("class", "dots-layer")
    .attr("clip-path", "url(#plot-clip)");

  // Axes format $...
  const fmtAxis = d3.format("~s");
  const axisMoney = (d) => "$" + fmtAxis(d);

  // Axes with reasonable ticks and padding
  // calcul dynamique du nombre de ticks selon l'espace en pixels
  const computeXTicks = () => Math.max(2, Math.floor(innerWidth / 120));
  const computeYTicks = () => Math.max(2, Math.floor(innerHeight / 80));

  const xAxis = d3
    .axisBottom(x)
    .ticks(computeXTicks())
    .tickFormat(axisMoney)
    .tickPadding(6);

  const yAxis = d3
    .axisLeft(y)
    .ticks(computeYTicks())
    .tickFormat(axisMoney)
    .tickPadding(6);

  const xAxisG = axesG
    .append("g")
    .attr("transform", `translate(0,${innerHeight})`)
    .call(xAxis);

  const yAxisG = axesG.append("g").call(yAxis);
  yAxisG.selectAll("text").attr("dx", "-0.5em");

  // Helper to rotate X axis tick labels consistently
  function rotateXAxisLabels(axisGroup) {
    axisGroup.selectAll(".tick text")
      .attr("transform", "rotate(-30)")
      .attr("text-anchor", "end")
      .attr("dx", "-0.6em")
      .attr("dy", "0.35em");
  }

  // Apply rotation after initial draw
  rotateXAxisLabels(xAxisG);


  svg
    .append("text")
    .attr("x", margin.left + innerWidth / 2)
    .attr("y", height - 10)
    .attr("text-anchor", "middle")
    .attr("fill", "#9aa3b8")
    .text("Budget (USD, log)");

  svg
    .append("text")
    .attr(
      "transform",
      `translate(18, ${margin.top + innerHeight / 2}) rotate(-90)`
    )
    .attr("text-anchor", "middle")
    .attr("fill", "#9aa3b8")
    .text("Revenue (USD, log)");

// Ligne y = x (break-even) étendue sur tout le domaine
const domainX = x.domain();
const domainY = y.domain();

// on prend vraiment le min et max possibles, la partie en dehors sera coupée par le clip
const lineMin = Math.min(domainX[0], domainY[0]);
const lineMax = Math.max(domainX[1], domainY[1]);

  const breakEvenLine =
    lineMin < lineMax
      ? dotsG
          .append("line")
          .attr("stroke", "#9ca3af")
          .attr("stroke-width", 1.5)
          .attr("stroke-dasharray", "6,4")
          .attr("opacity", 0.9)
      : null;

  // Tooltip
  const tooltip = d3.select("#tooltip");
  const fmt = d3.format("~s");
  const usd = (v) => (v != null ? "$" + fmt(v) : "—");

  const circles = dotsG
    .selectAll("circle.dot")
    .data(data, (d) => d._id)
    .enter()
    .append("circle")
    .attr("class", "dot")
    .attr("cx", (d) => x(d.budget))
    .attr("cy", (d) => y(d.revenue))
    .attr("r", (d) => r(d[sizeMetric] || 0))
    .attr("fill", (d) => color(d.primaryGenre))
    .attr("opacity", 0.85)
    .attr("stroke", "#111827")
    .attr("stroke-width", 1)
    .on("mouseenter", function (event, d) {
      const profit =
        d.profit != null
          ? d.profit >= 0
            ? `+${usd(d.profit)}`
            : `−${usd(Math.abs(d.profit))}`
          : "—";

      const genresFull =
        Array.isArray(d.genres) && d.genres.length
          ? d.genres.join(", ")
          : "—";

      tooltip
        .style("opacity", 1)
        .html(
          `
          <strong>${d.title}</strong><br/>
          <span>Année :</span> ${d.year ?? "—"}<br/>
          <span>Genre principal :</span> ${d.primaryGenre}<br/>
          <span>Genres (film) :</span> ${genresFull}<br/>
          <span>Note :</span> ${d.vote_average ?? "—"}<br/>
          <span>Popularité :</span> ${d.popularity ?? "—"}<br/>
          <span>Budget :</span> ${usd(d.budget)}<br/>
          <span>Revenue :</span> ${usd(d.revenue)}<br/>
          <span>Profit :</span> ${profit}
        `
        )
        .style("left", event.pageX + 12 + "px")
        .style("top", event.pageY + 12 + "px");
    })
    .on("mousemove", function (event) {
      tooltip
        .style("left", event.pageX + 12 + "px")
        .style("top", event.pageY + 12 + "px");
    })
    .on("mouseleave", function () {
      tooltip.style("opacity", 0);
    });

  // Zoom + pan
  const zoom = d3
    .zoom()
    // on limite le zoom pour éviter d'avoir un énorme vide
    .scaleExtent([0.5, 20])
    // on empêche trop de "dérapage" en pan
    .translateExtent([
      [-2, -5], // yMin = -100 → on peut monter 100px plus haut
      [innerWidth + 10, innerHeight +2], // xMax augmenté → on peut aller 50px à droite
    ])
    .extent([
      [0, 0],
      [innerWidth, innerHeight],
    ])
    .on("zoom", (event) => {
      const t = event.transform;
      const zx = t.rescaleX(x);
      const zy = t.rescaleY(y);

      // recalculer le nombre de ticks en fonction de l'espace disponible
      xAxisG.call(
        d3.axisBottom(zx)
          .ticks(computeXTicks())
          .tickFormat(axisMoney)
          .tickPadding(6)
      );
      // réappliquer la rotation aux labels X après redraw (zoom/pan)
      try {
        rotateXAxisLabels(xAxisG);
      } catch (e) {}

      yAxisG.call(
        d3.axisLeft(zy)
          .ticks(computeYTicks())
          .tickFormat(axisMoney)
          .tickPadding(6)
      );

      circles
        .attr("cx", (d) => zx(d.budget))
        .attr("cy", (d) => zy(d.revenue));

      if (breakEvenLine) {
        breakEvenLine
          .attr("x1", zx(lineMin))
          .attr("y1", zy(lineMin))
          .attr("x2", zx(lineMax))
          .attr("y2", zy(lineMax));
      }
    });

  // Zoom appliqué sur tout le SVG (tooltip OK)
  svg.call(zoom);

  const missingArea = document.getElementById("missing-area");
  if (missingArea) {
    missingArea.textContent =
      "Plus tard, ce panneau affichera les films sans budget/revenue (panneau B).";
  }
}

/* =========================================================
   PANNEAU B : FILMS SANS BUDGET / REVENUE (PAGINATION SIMPLE)
   ========================================================= */

function renderMissingMoviesPanel(filters) {
  const container = document.getElementById("missing-area");
  if (!container || !state.isLoaded) return;

  // 1) Appliquer les mêmes filtres globaux que le panneau A
  let filtered = filterMovies(state.rawMovies, filters);

  // 2) Garder uniquement ceux SANS budget OU revenue valides
  const missing = filtered.filter(
    (m) =>
      !(m.budget != null && m.budget > 0 && m.revenue != null && m.revenue > 0)
  );

  if (missing.length === 0) {
    container.textContent =
      "Aucun film sans budget / revenue pour les filtres actuels.";
    return;
  }

  // 3) Tri par métrique choisie (popularité ou note)
  const metricKey =
    filters && filters.sizeBy === "vote_average"
      ? "vote_average"
      : "popularity";
  const sorted = missing
    .slice()
    .sort((a, b) => (b[metricKey] || 0) - (a[metricKey] || 0));

  // 4) Pagination : 36 films par page (18 par colonne)
  const PAGE_SIZE = 36;
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);

  if (state.missingPage < 0) state.missingPage = 0;
  if (state.missingPage >= totalPages) state.missingPage = totalPages - 1;

  const start = state.missingPage * PAGE_SIZE;
  const end = start + PAGE_SIZE;
  const shown = sorted.slice(start, end);

  // 5) Construire le HTML

  let html = "";

  // Liste en 2 colonnes (gérée par le CSS)
  html += `<ul class="missing-list">`;

  for (const m of shown) {
    const year = m.year ?? "—";
    const budgetTxt =
      m.budget != null && m.budget > 0 ? "$" + d3.format("~s")(m.budget) : "—";
    const revTxt =
      m.revenue != null && m.revenue > 0
        ? "$" + d3.format("~s")(m.revenue)
        : "—";
    const metricVal =
      m[metricKey] != null ? m[metricKey].toString() : "—";

    const tooltipText =
      `Année : ${year}\n` +
      `Budget : ${budgetTxt}\n` +
      `Revenue : ${revTxt}\n` +
      `Métrique : ${metricVal}`;

    // couleur du dot = genre principal (fallback gris)
    const dotColor = state.colorScale ? state.colorScale(getPrimaryGenre(m)) : '#9aa3b8';
    html += `<li class="missing-item" title="${tooltipText.replace(/"/g, "&quot;")}">` +
      `<span class="missing-dot" style="color:${dotColor}">●</span>` +
      `${m.title}</li>`;
  }

  html += `</ul>`;

  container.innerHTML = html;

  // 6) Construire la pagination dans le footer et brancher les boutons
  const footer = document.querySelector(".missing-panel-footer");
  if (footer) {
    let footerHtml = `
      <button type="button" class="missing-nav" data-dir="prev" ${
        state.missingPage === 0 ? "disabled" : ""
      }>&lt;</button>
      <span class="missing-page-info">
        Page ${state.missingPage + 1} / ${totalPages} 
        ( ${shown.length} films / ${missing.length} )
      </span>
      <button type="button" class="missing-nav" data-dir="next" ${
        state.missingPage === totalPages - 1 ? "disabled" : ""
      }>&gt;</button>
    `;
    footer.innerHTML = footerHtml;

    // Brancher les boutons < et >
    const navButtons = footer.querySelectorAll(".missing-nav");
    navButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const dir = btn.getAttribute("data-dir");
        if (dir === "prev" && state.missingPage > 0) {
          state.missingPage--;
        } else if (dir === "next" && state.missingPage < totalPages - 1) {
          state.missingPage++;
        }
        renderMissingMoviesPanel(filters);
      });
    });
  }
}



/* =========================================================
   PIPELINE : FILTRER + RENDRE
   ========================================================= */

function applyFiltersAndRender() {
  if (!state.isLoaded) return;

  const filters = getFilterValues();
  let movies = filterMovies(state.rawMovies, filters);

  if (filters.topN && Number.isFinite(filters.topN)) {
    movies = movies.slice(0, filters.topN);
  }

    // à chaque changement de filtres, on repart de la page 0 du panneau B
  state.missingPage = 0;

  renderBaseBubbleChart(movies, filters);
  renderMissingMoviesPanel(filters);  
}


/* =========================================================
   CHARGEMENT & INIT
   ========================================================= */

async function loadData() {
  const plotArea = document.getElementById("plot-area");
  if (plotArea) {
    plotArea.textContent = "Chargement des données en cours...";
  }

  try {
    const raw = await d3.csv(CSV_PATH);
    console.log("✅ CSV brut chargé. Exemple de ligne :", raw[0]);

    const parsed = raw.map((d, i) => parseRow(d, i));
    state.rawMovies = parsed;
    state.isLoaded = true;

    // On récupère la liste globale des genres (pour la légende)
    const gset = new Set();
    parsed.forEach((m) => {
      (Array.isArray(m.genres) ? m.genres : []).forEach((g) =>
        gset.add(g)
      );
    });
    state.genres = Array.from(gset).sort();

    console.log(
      `✅ ${parsed.length} films parsés, ${state.genres.length} genres.`
    );

    // Premier rendu (légende sera construite dans renderBaseBubbleChart)
    applyFiltersAndRender();

    window.state = state;
  } catch (error) {
    console.error(" Erreur lors du chargement ou parsing du CSV :", error);
    if (plotArea) {
      plotArea.textContent =
        "Erreur lors du chargement ou du parsing des données. Regarde la console (F12) pour le détail.";
    }
  }
}

function setupFilterListeners() {
  const ids = [
    "year-min",
    "year-max",
    "title-filter",
    "company-filter",
    "top-n",
  ];

  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const ev = el.tagName === "SELECT" ? "change" : "input";
    el.addEventListener(ev, applyFiltersAndRender);
  });

  const sizeRadios = document.querySelectorAll('input[name="sizeBy"]');
  sizeRadios.forEach((r) => {
    r.addEventListener("change", applyFiltersAndRender);
  });
}

function init() {
  console.log(
    "BubbleChart – init() (filtres + légende-filtre genres + log-log + zoom)"
  );
  setupFilterListeners();
  loadData();
}

window.addEventListener("DOMContentLoaded", init);
