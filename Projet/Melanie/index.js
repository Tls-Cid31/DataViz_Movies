// EXECUTION A PARTIR DU FICHIER CSV

d3.csv("../movie_dataset_transform.csv").then(function (csvData) {
    // Preparation des données
    originalData = prepareData(csvData);

    // Initialisation des filtres
    initializeFilters();

    // Initialisation de la visualization
    initializeVisualization();

    // Préparation des event listeners
    setupEventListeners();
});


// INITIALISATION & CHARGEMENT DES DONNEES

function initializeFilters() {
    // Décennies
    const decadesSet = Array.from(new Set(originalData.map(d => d.decade))).sort();
    const decadeSelect = d3.select("#filter-decade");
    decadeSelect.append("option").attr("value", "all").text("All");
    decadesSet.forEach(d => decadeSelect.append("option").attr("value", d).text(d));

    // Sociétés de production
    const companies = Array.from(new Set(originalData.flatMap(d => d.production_companies))).sort();
    const companyList = d3.select("#company-list");
    companies.forEach(c => companyList.append("option").attr("value", c));
}

function initializeVisualization() {
    // Aggregate data
    const aggregated = aggregateData(originalData, "decade");

    // Get domains
    const decades = Array.from(new Set(aggregated.map(d => d.decade))).sort();
    const genres = Array.from(new Set(aggregated.map(d => d.genre))).sort();

    // Create scales
    scales = createScales(decades, genres, aggregated);

    // Draw axes
    drawAxes(svg, scales);

    // Render heatmap
    renderHeatmap("decade");

    // Display global top 10
    const globalTop10 = getGlobalTop10(originalData);
    renderList(globalTop10, "Tous genres", "Top global", "global");
}


// CONFIGURATION

const CONFIG = {
    margin: {top: 10, right: 25, bottom: 30, left: 120},
    width: 550 - 120 - 25,
    height: 550 - 30 - 30,
    colorInterpolator: d3.interpolateViridis
};


// ETAT GLOBAL

let originalData = [];
let currentLevel = "decade"; // ou "year"
let scales;


// CREATION DES ELEMENTS

// Création du SVG principal
const svg = d3.select("#heatmap")
    .append("svg")
    .attr("width", CONFIG.width + CONFIG.margin.left + CONFIG.margin.right)
    .attr("height", CONFIG.height + CONFIG.margin.top + CONFIG.margin.bottom)
    .append("g")
    .attr("transform", `translate(${CONFIG.margin.left}, ${CONFIG.margin.top})`);

// Création du tooltip
const tooltip = d3.select("#heatmap")
    .append("div")
    .attr("class", "tooltip")
    .style("opacity", 0);


// PREPARATION DES DONNEES

// Conversion et ajout décennie
function prepareData(data) {
    for (const d of data) {
        // Valeurs numériques
        d.vote_average = +d.vote_average;
        d.vote_count = +d.vote_count;
        d.popularity = +d.popularity;
        d.budget = +d.budget;
        d.revenue = +d.revenue;
        d.runtime = +d.runtime;
        d.year = +d.year;
        // Listes
        d.genres = JSON.parse(d.genres);
        d.production_companies = JSON.parse(d.production_companies);
        // Ajouter la décennie
        d.decade = Math.floor(d.year / 10) * 10;
    }
    return data;
}

// Préparation des données agrégées
function aggregateData(data, level = "decade") {
    // Dupliquer les films pour qu'ils aient une ligne par genre
    const exploded = data.flatMap(d => d.genres.map(g => ({...d, genre: g})));

    return Array.from(
        d3.rollup(
            exploded,
            v => ({
                count: v.length,
                avgPopularity: d3.mean(v, d => d.popularity),
                avgVote: d3.mean(v, d => d.vote_average),
                avgRuntime: d3.mean(v, d => d.runtime),
            }),
            d => d.genre,
            d => d[level]
        ),
        ([genre, map]) =>
            Array.from(map, ([value, vals]) => ({genre, [level]: value, ...vals}))
    ).flat();
}

// Calcul des totaux pour le ratio
function computeTotals(data, level) {
    return Array.from(
        d3.rollup(
            data,
            v => v.length,
            d => d[level]
        ),
        ([period, total]) => ({period, total})
    );
}


// FILTRES

function getFilteredData() {
    const decadeValue = d3.select("#filter-decade").property("value");
    const companyValue = d3.select("#filter-company").property("value").toLowerCase();
    const minRuntime = +d3.select("#filter-runtime").property("value");
    const minPopularity = +d3.select("#filter-popularity").property("value");
    const minVote = +d3.select("#filter-vote").property("value");

    // "All": decade, specific decade: year
    const level = (decadeValue === "all") ? "decade" : "year";

    const filtered = originalData.filter(d =>
        (decadeValue === "all" || Math.floor(d.year / 10) * 10 == +decadeValue) &&
        (companyValue === "" || d.production_companies.some(c => c.toLowerCase().includes(companyValue))) &&
        d.runtime >= minRuntime &&
        d.popularity >= minPopularity &&
        d.vote_average >= minVote
    );

    return {data: aggregateData(filtered, level), level};
}



// SCALES

function createScales(decades, genres, data) {
    // Build X scales
    const x = d3.scaleBand()
        .range([0, CONFIG.width])
        .domain(decades)
        .padding(0.05);

    // Build Y scales
    const y = d3.scaleBand()
        .range([0, CONFIG.height])
        .domain(genres)
        .padding(0.05);

    // Build color scale
    const color = d3.scaleSequential()
        .interpolator(CONFIG.colorInterpolator);

    return {x, y, color};
}



// AXES

function drawAxes(svg, scales) {
    // Axe X
    svg.append("g")
        .attr("class", "x-axis")
        .attr("transform", `translate(0, ${CONFIG.height})`)
        .call(d3.axisBottom(scales.x).tickSize(0))
        .call(g => g.selectAll("text").attr("dy", "1em").style("font-weight", 500))
        .select(".domain").remove();

    // Axe Y
    svg.append("g")
        .attr("class", "y-axis")
        .call(d3.axisLeft(scales.y).tickSize(0))
        .call(g => g.selectAll("text").style("font-weight", 500))
        .select(".domain").remove();
}


// AFFICHAGE HEATMAP

function renderHeatmap(level = currentLevel, data = null) {
    updateHeatmapTitle();

    // Update global state
    currentLevel = level;

    // Re-aggregate data for the selected resolution
    const aggregated = data || aggregateData(originalData, level);

    // Compute totals
    const totalsByPeriod = new Map(computeTotals(originalData, level).map(d => [d.period, d.total]));

    // Total movies by genre
    const genreCounts = d3.rollup(
        originalData.flatMap(d => d.genres.map(g => ({...d, genre: g}))),
        v => v.length,
        d => d.genre
    );
    const totalsByGenreMap = new Map(genreCounts);

    // Choose which ratio to use for coloring
    const colorBy = d3.select("#color-by").property("value");

    aggregated.forEach(d => {
        if (colorBy === "ratioPeriod") {
            d.ratio = d.count / totalsByPeriod.get(d[level]);
        } else if (colorBy === "ratioGenre") {
            d.ratio = d.count / totalsByGenreMap.get(d.genre);
        }
    });

    const minRatio = d3.min(aggregated, d => d.ratio);
    const maxRatio = d3.max(aggregated, d => d.ratio);
    scales.color.domain([minRatio, maxRatio]);

    // Update legend
    updateLegend(minRatio, maxRatio);

    // Recompute domains
    const xValues = Array.from(new Set(aggregated.map(d => d[level]))).sort();

    const yValues = Array.from(new Set(aggregated.map(d => d.genre)))
        .sort((a, b) => {
            const nr = "Non renseigné";
            if (a === nr && b !== nr) return 1;
            if (b === nr && a !== nr) return -1;
            return a.localeCompare(b);
        });

    scales.x.domain(xValues);
    scales.y.domain(yValues);

    // Update X axis
    let xAxis = svg.select(".x-axis");
    if (xAxis.empty()) {
        xAxis = svg.append("g")
            .attr("class", "x-axis")
            .attr("transform", `translate(0, ${CONFIG.height})`);
    }
    xAxis.transition()
        .duration(750)
        .call(d3.axisBottom(scales.x).tickSize(0))
        .select(".domain").remove();

    // Update Y axis
    let yAxis = svg.select(".y-axis");
    if (yAxis.empty()) {
        yAxis = svg.append("g")
            .attr("class", "y-axis");
    }
    yAxis.transition()
        .duration(750)
        .call(d3.axisLeft(scales.y).tickSize(0))
        .select(".domain").remove();

    // JOIN + ENTER + UPDATE + EXIT for heatmap rectangles
    const rects = svg.selectAll("rect")
        .data(aggregated, d => d.genre + ":" + d[level]);

    // ENTER
    rects.enter()
        .append("rect")
        .attr("x", d => scales.x(d[level]))
        .attr("y", d => scales.y(d.genre))
        .attr("width", scales.x.bandwidth())
        .attr("height", scales.y.bandwidth())
        .attr("rx", 2)
        .attr("ry", 2)
        .style("fill", d => scales.color(d.ratio))
        .style("stroke", "rgba(255,255,255,0.6)")
        .style("stroke-width", 0.5)
        .style("opacity", 0.9)
        .on("mouseover", mouseover)
        .on("mousemove", mousemove)
        .on("mouseleave", mouseleave)
        .on("click", cellClick);

    // UPDATE
    rects
        .on("click", cellClick)
        .transition()
        .duration(750)
        .attr("x", d => scales.x(d[level]))
        .attr("y", d => scales.y(d.genre))
        .attr("width", scales.x.bandwidth())
        .attr("height", scales.y.bandwidth())
        .style("fill", d => scales.color(d.ratio))
        .style("stroke", "rgba(255,255,255,0.6)")
        .style("stroke-width", 0.5)
        .style("opacity", 0.9);

    // EXIT
    rects.exit().remove();
}

function updateHeatmapTitle() {
    const colorBy = d3.select("#color-by").property("value");
    const titleMap = {
        ratioPeriod: "Répartition des films par rapport au total de la période",
        ratioGenre: "Répartition des films par rapport au total du genre"
    };
    d3.select("#heatmap-title").text(titleMap[colorBy]);
}


// LEGEND RENDERING

function updateLegend(minRatio, maxRatio) {
    const legendContainer = d3.select("#heatmap-legend");

    const colorBy = d3.select("#color-by").property("value");
    const label = colorBy === "ratioPeriod" ? "% de la période" : "% du genre";

    const gradientId = "legend-gradient";

    // Remove old content
    legendContainer.html("");

    const legendHeight = 300;
    const legendWidth = 14;

    // SVG for gradient bar
    const svg = legendContainer.append("svg")
        .attr("width", legendWidth)
        .attr("height", legendHeight);

    // Gradient definition
    const defs = svg.append("defs");
    const gradient = defs.append("linearGradient")
        .attr("id", gradientId)
        .attr("x1", "0%").attr("y1", "100%")
        .attr("x2", "0%").attr("y2", "0%");

    // Smooth gradient
    const stops = d3.range(0, 1.01, 0.1);
    stops.forEach(t => {
        const value = minRatio + t * (maxRatio - minRatio);
        gradient.append("stop")
            .attr("offset", `${t * 100}%`)
            .attr("stop-color", scales.color(value));
    });

    // Gradient rectangle
    svg.append("rect")
        .attr("class", "legend-bar")
        .attr("x", 0)
        .attr("y", 0)
        .attr("width", legendWidth)
        .attr("height", legendHeight)
        .style("fill", `url(#${gradientId})`);

    // Numeric labels stacked vertically
    const labels = legendContainer.append("div")
        .attr("class", "legend-labels")
        .style("display", "flex")
        .style("flex-direction", "column")
        .style("justify-content", "space-between")
        .style("height", `${legendHeight}px`)
        .style("margin-left", "4px");

    labels.append("span").text(`${(maxRatio * 100).toFixed(1)}%`);
    labels.append("span").text(`${(minRatio * 100).toFixed(1)}%`);

    // Title below
    legendContainer.append("div")
        .style("margin-top", "6px")
        .style("font-size", "12px")
        .style("color", "#555")
        .text(`Échelle des couleurs : ${label}`);
}


// TOP MOVIES

function getBayesianScore(movie, minVotes = 10, globalAverage = 6.0) {
    const C = minVotes; // minimum de votes requis
    const m = globalAverage; // note moyenne globale
    const R = movie.vote_average; // note du film
    const v = movie.vote_count; // nombre de votes

    return (v / (v + C)) * R + (C / (v + C)) * m;
}

function getGlobalTop10(data) {
    // Calculer la moyenne globale pour le score bayésien
    const globalAverage = d3.mean(data, d => d.vote_average) || 6.0;

    return data
        .map(d => ({
            ...d,
            bayesianScore: getBayesianScore(d, 10, globalAverage)
        }))
        .sort((a, b) => b.bayesianScore - a.bayesianScore)
        .slice(0, 10);
}

function getMoviesForCell(data, genre, decadeOrYear, level) {
    const filteredData = data.filter(d =>
        d.genres.includes(genre) &&
        d[level] === decadeOrYear
    );

    // Calculer la moyenne pour ce sous-ensemble
    const localAverage = d3.mean(filteredData, d => d.vote_average) || 6.0;

    return filteredData
        .map(d => ({
            ...d,
            bayesianScore: getBayesianScore(d, 10, localAverage)
        }))
        .sort((a, b) => b.bayesianScore - a.bayesianScore)
        .slice(0, 10);
}

function renderList(movies, genre, label, level) {
    const container = d3.select("#list-section");
    const tableContainer = d3.select("#movies-table-container");

    // No data case
    if (movies.length === 0) {
        container.style("display", "block");
        tableContainer.html(`<p>Aucun film associé.</p>`);
        return;
    }

    // Show section
    container.style("display", "block");

    // Update title
    container.select("h3").text(`Top 10 - ${genre} (${label})`);

    // Clear old table
    tableContainer.html("");

    // Create table
    const table = tableContainer.append("table")
        .attr("class", "movie-table")
        .style("border-collapse", "collapse")
        .style("width", "100%");

    // Header
    const thead = table.append("thead").append("tr");
    thead.selectAll("th")
        .data(["", "Titre", "Note", "Popularité", "Durée"])
        .enter()
        .append("th")
        .text(d => d)
        .style("text-align", "left")
        .style("padding", "8px 6px")
        .style("border-bottom", "2px solid #ddd")
        .style("font-weight", "600")
        .style("font-size", "14px")
        .style("background", "#fafafa");

    // Body
    const tbody = table.append("tbody");

    movies.forEach((m, i) => {
        const row = tbody.append("tr")
            .style("border-bottom", "1px solid #eee");

        row.append("td")
            .text(i + 1)
            .style("padding", "6px 6px")
            .style("text-align", "center")
            .style("font-weight", "600")
            .style("color", "#333");

        row.append("td").text(m.title)
            .style("padding", "6px 6px");

        row.append("td").text(m.vote_average.toFixed(1))
            .style("padding", "6px 6px");

        row.append("td").text(m.popularity.toFixed(0))
            .style("padding", "6px 6px");

        row.append("td").text(m.runtime + " min")
            .style("padding", "6px 6px");
    });
}


// INTERACTION HANDLERS

const mouseover = function (event, d) {
    tooltip
        .transition()
        .duration(200)
        .style("opacity", 0.95);
    d3.select(this)
        .style("stroke", "#111")
        .style("stroke-width", 1.5)
        .style("filter", "brightness(1.2)");
};

const mousemove = function (event, d) {
    tooltip
        .html(
            `<strong>Nombre de films :</strong> ${d.count}<br>` +
            `<strong>Ratio :</strong> ${(d.ratio * 100).toFixed(0)} %<br>` +
            `<strong>Note moyenne :</strong> ${d.avgVote.toFixed(1)}<br>` +
            `<strong>Popularité moyenne :</strong> ${d.avgPopularity.toFixed(1)}<br>` +
            `<strong>Durée moyenne :</strong> ${d.avgRuntime.toFixed(0)} min`
        )
        .style("left", `${event.pageX + 15}px`)
        .style("top", `${event.pageY + 15}px`);
};

const mouseleave = function (event, d) {
    tooltip
        .transition()
        .duration(200)
        .style("opacity", 0);
    d3.select(this)
        .style("stroke", "none")
        .style("filter", "none");
};

function cellClick(event, d) {
    const genre = d.genre;
    const period = d[currentLevel];

    // Extract movies for clicked cell
    const movies = getMoviesForCell(originalData, genre, period, currentLevel);

    // Display them
    renderList(movies, genre, period, currentLevel);
}


// EVENT LISTENERS

function setupEventListeners() {
    // Filter changes
    d3.selectAll("#filter-decade, #filter-company, #filter-runtime, #filter-popularity, #filter-vote")
        .on("input.filter", () => {
            const {data, level} = getFilteredData();
            renderHeatmap(level, data);
        });

    // Slider label updates
    d3.select("#filter-runtime").on("input.label", function () {
        d3.select("#runtime-value").text(this.value + "+");
    });

    d3.select("#filter-popularity").on("input.label", function () {
        d3.select("#pop-value").text(this.value + "+");
    });

    d3.select("#filter-vote").on("input.label", function () {
        d3.select("#vote-value").text(this.value + "+");
    });

    // Color mode change
    d3.select("#color-by").on("change", () => {
        const {data, level} = getFilteredData();
        renderHeatmap(level, data);
    });
}


