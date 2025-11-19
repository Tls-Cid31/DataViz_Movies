// Configuration globale
const config = {
  dataPath: '../movie_dataset_transform.csv',
  packDiameter: 720,
  packPadding: 3,
  pieWidth: 560,
  pieHeight: 360,
  topGroups: 18,           // limiter le nombre de groupes affichés (performance/lecture)
  maxFilmsPerGroup: 250,   // limiter le nombre de films par groupe
  itemsPerPage: 10         // nombre de films par page dans le tableau
};// Variables globales
let moviesData = [];
let filteredData = [];
let currentMode = 'genre'; // 'genre' | 'production'
let currentSizeMode = 'popularity'; // 'popularity' | 'budget'
let currentTopMode = 'all'; // 'all' | 'top10' | 'top100'
let currentFocus = null;   // focus du zoom (node group)
let currentTableData = []; // données actuelles du tableau
let baseTableData = []; // données de base avant filtres de table
// Note: selectedYears et selectedNotes sont les références, pas besoin de dupliquer
let tableFilters = {
    title: new Set(),
    year: null, // Sera initialisé avec selectedYears
    note: null, // Sera initialisé avec selectedNotes
    genres: new Set(),
    productions: new Set()
};
// Filtres numériques du tableau (opérateur et valeurs)
let numericTableFilters = {
    popularity: null, // { op: 'gte'|'lte'|'between', v1: number, v2?: number }
    budget: null,
    revenue: null
};
let activeTableFilters = new Set(); // colonnes avec filtre actif visible
let tableSortColumn = 'popularity'; // colonne de tri actuelle (tri par défaut sur la métrique choisie)
let tableSortOrder = 'desc'; // 'asc' ou 'desc' (valeurs les plus élevées en premier)
let currentPage = 1;       // page actuelle de la pagination
let selectedGenres = new Set();
let selectedCompanies = new Set();
let selectedTitles = new Set(); // Titres sélectionnés depuis le tableau
let excludedGenres = new Set(); // Genres exclus (clic droit)
let excludedCompanies = new Set(); // Productions exclues (clic droit)
let excludedTitles = new Set(); // Films exclus (clic droit dans le filtre films)
let selectedYears = new Set(); // Années sélectionnées (équivalent à tableFilters.year)
let selectedNotes = new Set(); // Notes sélectionnées (équivalent à tableFilters.note)
let excludedYears = new Set(); // Années exclues (clic droit)
let excludedNotes = new Set(); // Notes exclues (clic droit)
let genreOptions = [];
let prodOptions = []; // Liste limitée à 200 pour l'affichage initial
let allProdOptions = []; // Liste complète de toutes les sociétés pour la recherche
let filmOptions = []; // Liste des titres pour le filtre films
let yearOptions = []; // Liste des années pour le filtre années
let noteOptions = []; // Liste des notes pour le filtre notes
let filterHistory = []; // historique des sélections pour retour
let redoHistory = []; // historique pour avancer
// Zoom UI state
let uiZoomScale = 1;
const uiZoomMin = 0.2;
const uiZoomMax = 3;
const uiZoomStep = 0.1;
// Strict filter modes
let strictGenre = false;
let strictProd = false;
let showTitles = false; // Affichage des titres dans le circle packing

// Initialisation au chargement de la page
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    // DOM déjà chargé
    init();
}

async function init() {
    try {
        // Vérifier que D3 est chargé
        if (typeof d3 === 'undefined') {
            console.error('❌ D3.js n\'est pas chargé!');
            // Attendre un peu et réessayer
            setTimeout(() => {
                if (typeof d3 !== 'undefined') {
                    // D3 chargé après attente
                    init();
                } else {
                    showError('Erreur: Bibliothèque D3.js non chargée');
                }
            }, 500);
            return;
        }
        // D3 version disponible
        
        showLoading();
        await loadData();
        populateFilters();
        setupEventListeners();
        updateFilteredData();
        updateVisualization();
        hideLoading();
    } catch (error) {
        console.error('Erreur lors de l\'initialisation:', error);
        showError('Erreur lors du chargement des données');
    }
}

// Chargement des données
async function loadData() {
    try {
        moviesData = await d3.csv(config.dataPath, d => ({
            title: d.title,
            genres: d.genres,
            vote_average: +d.vote_average,
            vote_count: +d.vote_count,
            popularity: +d.popularity,
            overview: d.overview,
            budget: +d.budget,
            production_companies: d.production_companies,
            revenue: +d.revenue,
            runtime: +d.runtime,
            year: +d.year
        }));
        
        // Update total count in header
        const uniqueTotalFilms = new Set(moviesData.map(d => d.title || d.original_title)).size;
        document.getElementById('totalCount').textContent = uniqueTotalFilms;

        // Définir les bornes du slider année
        const years = moviesData.map(d => d.year).filter(y => !isNaN(y));
        const yearFilterMin = document.getElementById('yearFilterMin');
        const yearFilterMax = document.getElementById('yearFilterMax');
        const yearDisplayMin = document.getElementById('yearDisplayMin');
        const yearDisplayMax = document.getElementById('yearDisplayMax');
        const rangeFill = document.getElementById('rangeFill');
        if (yearFilterMin && yearFilterMax && years.length) {
            const minYear = Math.min(...years);
            const maxYear = Math.max(...years);
            yearFilterMin.min = minYear;
            yearFilterMin.max = maxYear;
            yearFilterMin.value = minYear;
            yearFilterMax.min = minYear;
            yearFilterMax.max = maxYear;
            yearFilterMax.value = maxYear;
            if (yearDisplayMin) yearDisplayMin.textContent = String(minYear);
            if (yearDisplayMax) yearDisplayMax.textContent = String(maxYear);
            
            // Initialize range fill
            if (rangeFill) {
                const minPercent = ((minYear - minYear) / (maxYear - minYear)) * 100;
                const maxPercent = ((maxYear - minYear) / (maxYear - minYear)) * 100;
                rangeFill.style.left = minPercent + '%';
                rangeFill.style.width = (maxPercent - minPercent) + '%';
            }
        }
    } catch (error) {
        throw new Error(`Impossible de charger les données: ${error.message}`);
    }
}

// Utils: parser un champ tableau (genres/production_companies)
function parseArrayField(s) {
    if (!s) return [];
    // Essayer JSON.parse directement
    try {
        const val = JSON.parse(s);
        if (Array.isArray(val)) return val.filter(Boolean);
    } catch (_) {
        // Fallback: enlever crochets et séparer par virgules
        const cleaned = String(s).replace(/^\s*\[|\]\s*$/g, '');
        return cleaned
            .split(',')
            .map(x => String(x).trim().replace(/^"|"$/g, ''))
            .filter(Boolean);
    }
    return [];
}

// Construction hiérarchie + totaux groupes
function buildHierarchy(mode, data, sizeMode) {
  const groupMap = new Map(); // groupName -> films[]

  for (const d of data) {
    let sizeValue;
    if (sizeMode === 'budget') {
      sizeValue = +d.budget;
    } else if (sizeMode === 'revenue') {
      sizeValue = +d.revenue;
    } else if (sizeMode === 'vote_average') {
      // Utiliser une fonction exponentielle pour amplifier les différences
      // Note de 5 -> 5^2.5 = 55.9, Note de 8 -> 8^2.5 = 181, Note de 10 -> 10^2.5 = 316
      const note = +d.vote_average;
      sizeValue = Math.pow(note, 2.5) * 10;
    } else {
      sizeValue = +d.popularity;
    }
    if (!isFinite(sizeValue) || sizeValue <= 0) continue;

    const groups = mode === 'genre' ? parseArrayField(d.genres) : parseArrayField(d.production_companies);
    if (!groups.length) continue;

    for (const g of groups) {
      if (!g) continue;
      if (!groupMap.has(g)) groupMap.set(g, []);
      groupMap.get(g).push({
        name: d.title,
        value: sizeValue,
        popularity: +d.popularity,
        year: d.year,
        vote_average: d.vote_average,
        revenue: d.revenue,
        budget: d.budget,
        runtime: d.runtime,
        overview: d.overview,
        genres: d.genres,
        production_companies: d.production_companies
      });
    }
  }    // Calculer totaux et limiter le nombre de groupes
    let groups = Array.from(groupMap, ([name, films]) => {
        let sortedFilms = films
            .filter(f => isFinite(f.value) && f.value > 0)
            .sort((a, b) => b.value - a.value);
        
        // Appliquer la limite Top 10/Top 100 par groupe si activée
        if (currentTopMode === 'top10') {
            sortedFilms = sortedFilms.slice(0, 10);
        } else if (currentTopMode === 'top100') {
            sortedFilms = sortedFilms.slice(0, 100);
        } else {
            sortedFilms = sortedFilms.slice(0, config.maxFilmsPerGroup);
        }
        
        return {
            name,
            films: sortedFilms
        };
    });

    // En mode strict, n'afficher que les groupes sélectionnés
    if (mode === 'genre' && strictGenre && selectedGenres.size) {
        groups = groups.filter(g => selectedGenres.has(g.name));
    }
    if (mode === 'production' && strictProd && selectedCompanies.size) {
        groups = groups.filter(g => selectedCompanies.has(g.name));
    }

    groups = groups
        .map(g => ({
            name: g.name,
            total: d3.sum(g.films, d => d.value),
            children: g.films
        }))
        .filter(g => g.total > 0)
        .sort((a, b) => b.total - a.total)
        .slice(0, config.topGroups);

  const root = { name: 'root', children: groups };
  return { root };
}

// Configuration des écouteurs d'événements
function setupEventListeners() {
    const yearFilterMin = document.getElementById('yearFilterMin');
    const yearFilterMax = document.getElementById('yearFilterMax');
    const yearDisplayMin = document.getElementById('yearDisplayMin');
    const yearDisplayMax = document.getElementById('yearDisplayMax');
    const rangeFill = document.getElementById('rangeFill');

    // Use timestamp to detect programmatic changes
    let lastProgrammaticUpdate = 0;

    function updateRangeFill() {
        if (!yearFilterMin || !yearFilterMax || !rangeFill) return;
        const min = +yearFilterMin.min;
        const max = +yearFilterMin.max;
        const minVal = +yearFilterMin.value;
        const maxVal = +yearFilterMax.value;
        
        // Determine actual min and max (allow crossing)
        const actualMin = Math.min(minVal, maxVal);
        const actualMax = Math.max(minVal, maxVal);
        
        const minPercent = ((actualMin - min) / (max - min)) * 100;
        const maxPercent = ((actualMax - min) / (max - min)) * 100;
        
        rangeFill.style.left = minPercent + '%';
        rangeFill.style.width = (maxPercent - minPercent) + '%';
        
        // Update display to always show min-max in correct order
        if (yearDisplayMin) yearDisplayMin.textContent = String(actualMin);
        if (yearDisplayMax) yearDisplayMax.textContent = String(actualMax);
    }
    
    // Expose updateRangeFill globally for use in overlay year selection
    window.updateRangeFillDisplay = updateRangeFill;
    window.setYearSliderProgrammatically = function(minYear, maxYear) {
        lastProgrammaticUpdate = Date.now();
        if (yearFilterMin) yearFilterMin.value = minYear;
        if (yearFilterMax) yearFilterMax.value = maxYear;
        updateRangeFill();
    };

    if (yearFilterMin) {
        yearFilterMin.addEventListener('input', (e) => {
            updateRangeFill();
            applySelectionsToUI(); // Update filter states in real-time
        });
        yearFilterMin.addEventListener('change', () => {
            // Skip if this change happened within 100ms of programmatic update
            if (Date.now() - lastProgrammaticUpdate < 100) {
                return;
            }
            updateFilteredData();
            updateVisualization();
        });
    }

    if (yearFilterMax) {
        yearFilterMax.addEventListener('input', (e) => {
            updateRangeFill();
            applySelectionsToUI(); // Update filter states in real-time
        });
        yearFilterMax.addEventListener('change', () => {
            // Skip if this change happened within 100ms of programmatic update
            if (Date.now() - lastProgrammaticUpdate < 100) {
                return;
            }
            updateFilteredData();
            updateVisualization();
        });
    }
    
    // Initial fill update
    updateRangeFill();
    
    // Click sur la piste pour déplacer la poignée la plus proche
    const rangeContainer = document.querySelector('.range-slider-container');
    if (rangeContainer && yearFilterMin && yearFilterMax) {
        let isDragging = false;
        
        rangeContainer.addEventListener('mousedown', (e) => {
            // Ignorer les clics sur les thumbs des sliders
            if (e.target.classList.contains('range-slider')) {
                isDragging = true;
                return;
            }
            
            const rect = rangeContainer.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const percent = Math.max(0, Math.min(1, clickX / rect.width));
            
            const min = +yearFilterMin.min;
            const max = +yearFilterMin.max;
            const clickedYear = Math.round(min + (max - min) * percent);
            
            // Déterminer quelle poignée est la plus proche
            const minVal = +yearFilterMin.value;
            const maxVal = +yearFilterMax.value;
            const distToMin = Math.abs(clickedYear - minVal);
            const distToMax = Math.abs(clickedYear - maxVal);
            
            if (distToMin <= distToMax) {
                yearFilterMin.value = clickedYear;
            } else {
                yearFilterMax.value = clickedYear;
            }
            
            updateRangeFill();
            applySelectionsToUI();
            updateFilteredData();
            updateVisualization();
        });
        
        rangeContainer.addEventListener('mouseup', () => {
            isDragging = false;
        });
    }

    const modeRadios = document.querySelectorAll('input[name="mode"]');
    modeRadios.forEach(r => r.addEventListener('change', (e) => {
        currentMode = e.target.value;
        updateVisualization();
    }));

    const sizeRadios = document.querySelectorAll('input[name="sizeMode"]');
    sizeRadios.forEach(r => r.addEventListener('change', (e) => {
        currentSizeMode = e.target.value;
        // Mettre à jour le tri du tableau selon la métrique choisie
        tableSortColumn = currentSizeMode === 'vote_average' ? 'note' : currentSizeMode;
        tableSortOrder = 'desc';
        sortTableData();
        updateVisualization();
        renderTable();
    }));

    const topRadios = document.querySelectorAll('input[name="topMode"]');
    topRadios.forEach(r => r.addEventListener('change', (e) => {
        currentTopMode = e.target.value;
        updateFilteredData();
        updateVisualization();
        renderTable();
    }));

    // Les listes custom gèrent leurs propres événements dans renderMultiList

    // Boutons retour, avancer et annuler
    const undoBtn = document.getElementById('filtersUndo');
    const redoBtn = document.getElementById('filtersRedo');
    const clearBtn = document.getElementById('filtersClear');
    const strictGenreCheckbox = document.getElementById('strictGenre');
    const strictProdCheckbox = document.getElementById('strictProd');
    if (undoBtn) {
        undoBtn.addEventListener('click', () => {
            if (!filterHistory.length) return;
            // Save current state to redo history
            redoHistory.push({
                genres: Array.from(selectedGenres),
                companies: Array.from(selectedCompanies),
                titles: Array.from(selectedTitles),
                years: Array.from(selectedYears),
                notes: Array.from(selectedNotes),
                excludedGenres: Array.from(excludedGenres),
                excludedCompanies: Array.from(excludedCompanies),
                excludedTitles: Array.from(excludedTitles),
                excludedYears: Array.from(excludedYears),
                excludedNotes: Array.from(excludedNotes),
                strictGenre,
                strictProd,
                numericPop: numericTableFilters.popularity,
                numericBudget: numericTableFilters.budget,
                numericRevenue: numericTableFilters.revenue
            });
            const prev = filterHistory.pop();
            selectedGenres = new Set(prev.genres);
            selectedCompanies = new Set(prev.companies);
            selectedTitles = new Set(prev.titles || []);
            selectedYears = new Set(prev.years || []);
            selectedNotes = new Set(prev.notes || []);
            excludedGenres = new Set(prev.excludedGenres || []);
            excludedCompanies = new Set(prev.excludedCompanies || []);
            excludedTitles = new Set(prev.excludedTitles || []);
            excludedYears = new Set(prev.excludedYears || []);
            excludedNotes = new Set(prev.excludedNotes || []);
            strictGenre = !!prev.strictGenre;
            strictProd = !!prev.strictProd;
            numericTableFilters.popularity = prev.numericPop || null;
            numericTableFilters.budget = prev.numericBudget || null;
            numericTableFilters.revenue = prev.numericRevenue || null;
            if (strictGenreCheckbox) strictGenreCheckbox.checked = strictGenre;
            if (strictProdCheckbox) strictProdCheckbox.checked = strictProd;
            applySelectionsToUI();
            updateFilteredData();
            applyTableFilters();
            updateVisualization();
        });
    }
    if (redoBtn) {
        redoBtn.addEventListener('click', () => {
            if (!redoHistory.length) return;
            // Save current state to undo history
            filterHistory.push({
                genres: Array.from(selectedGenres),
                companies: Array.from(selectedCompanies),
                titles: Array.from(selectedTitles),
                years: Array.from(selectedYears),
                notes: Array.from(selectedNotes),
                excludedGenres: Array.from(excludedGenres),
                excludedCompanies: Array.from(excludedCompanies),
                excludedTitles: Array.from(excludedTitles),
                excludedYears: Array.from(excludedYears),
                excludedNotes: Array.from(excludedNotes),
                strictGenre,
                strictProd,
                numericPop: numericTableFilters.popularity,
                numericBudget: numericTableFilters.budget,
                numericRevenue: numericTableFilters.revenue
            });
            const next = redoHistory.pop();
            selectedGenres = new Set(next.genres);
            selectedCompanies = new Set(next.companies);
            selectedTitles = new Set(next.titles || []);
            selectedYears = new Set(next.years || []);
            selectedNotes = new Set(next.notes || []);
            excludedGenres = new Set(next.excludedGenres || []);
            excludedCompanies = new Set(next.excludedCompanies || []);
            excludedTitles = new Set(next.excludedTitles || []);
            excludedYears = new Set(next.excludedYears || []);
            excludedNotes = new Set(next.excludedNotes || []);
            strictGenre = !!next.strictGenre;
            strictProd = !!next.strictProd;
            numericTableFilters.popularity = next.numericPop || null;
            numericTableFilters.budget = next.numericBudget || null;
            numericTableFilters.revenue = next.numericRevenue || null;
            if (strictGenreCheckbox) strictGenreCheckbox.checked = strictGenre;
            if (strictProdCheckbox) strictProdCheckbox.checked = strictProd;
            applySelectionsToUI();
            updateFilteredData();
            applyTableFilters();
            updateVisualization();
        });
    }
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            pushFiltersHistory();
            selectedGenres.clear();
            selectedCompanies.clear();
            selectedTitles.clear();
            selectedYears.clear();
            selectedNotes.clear();
            excludedGenres.clear();
            excludedCompanies.clear();
            excludedTitles.clear();
            excludedYears.clear();
            excludedNotes.clear();
            strictGenre = false;
            strictProd = false;
            numericTableFilters.popularity = null;
            numericTableFilters.budget = null;
            numericTableFilters.revenue = null;
            if (strictGenreCheckbox) strictGenreCheckbox.checked = false;
            if (strictProdCheckbox) strictProdCheckbox.checked = false;
            applySelectionsToUI();
            updateFilteredData();
            applyTableFilters();
            updateVisualization();
        });
    }

    if (strictGenreCheckbox) {
        strictGenreCheckbox.addEventListener('change', (e) => {
            pushFiltersHistory();
            strictGenre = !!e.target.checked;
            updateFilteredData();
            updateVisualization();
        });
    }
    if (strictProdCheckbox) {
        strictProdCheckbox.addEventListener('change', (e) => {
            pushFiltersHistory();
            strictProd = !!e.target.checked;
            updateFilteredData();
            updateVisualization();
        });
    }

    // Show titles toggle
    const showTitlesCheckbox = document.getElementById('showTitles');
    if (showTitlesCheckbox) {
        showTitlesCheckbox.addEventListener('change', (e) => {
            showTitles = !!e.target.checked;
            if (showTitles) {
                if (typeof window.__displayFilmTitles === 'function') {
                    window.__displayFilmTitles();
                }
            } else {
                if (typeof window.__hideFilmTitles === 'function') {
                    window.__hideFilmTitles();
                }
            }
        });
    }

    // Zoom controls
    const zoomSlider = document.getElementById('zoomSlider');
    const zoomInBtn = document.getElementById('zoomIn');
    const zoomOutBtn = document.getElementById('zoomOut');
    if (zoomSlider) {
        zoomSlider.min = String(uiZoomMin);
        zoomSlider.max = String(uiZoomMax);
        zoomSlider.step = String(uiZoomStep);
        zoomSlider.value = String(uiZoomScale);
        zoomSlider.addEventListener('input', (e) => {
            uiZoomScale = Math.max(uiZoomMin, Math.min(uiZoomMax, parseFloat(e.target.value)));
            // Recalcule uniquement la transform de zoom sans reconstruire
            if (typeof window.__reapplyZoom === 'function') {
                window.__reapplyZoom();
            } else {
                updateVisualization();
            }
        });
    }
    if (zoomInBtn) {
        zoomInBtn.addEventListener('click', () => {
            uiZoomScale = Math.min(uiZoomMax, +(uiZoomScale + uiZoomStep).toFixed(2));
            if (zoomSlider) zoomSlider.value = String(uiZoomScale);
            if (typeof window.__reapplyZoom === 'function') window.__reapplyZoom();
        });
    }
    if (zoomOutBtn) {
        zoomOutBtn.addEventListener('click', () => {
            uiZoomScale = Math.max(uiZoomMin, +(uiZoomScale - uiZoomStep).toFixed(2));
            if (zoomSlider) zoomSlider.value = String(uiZoomScale);
            if (typeof window.__reapplyZoom === 'function') window.__reapplyZoom();
        });
    }
    
    // Bouton retour en haut
    const scrollToTopBtn = document.getElementById('scrollToTop');
    if (scrollToTopBtn) {
        // Afficher/masquer le bouton selon le scroll
        window.addEventListener('scroll', () => {
            if (window.pageYOffset > 300) {
                scrollToTopBtn.classList.add('visible');
            } else {
                scrollToTopBtn.classList.remove('visible');
            }
        });
        
        // Scroll vers le haut au clic
        scrollToTopBtn.addEventListener('click', () => {
            window.scrollTo({
                top: 0,
                behavior: 'smooth'
            });
        });
    }
}

// Filtrage des données par année (<= year)
function filterDataByYear(year) {
    if (!isFinite(year)) {
        filteredData = moviesData.slice();
        return;
    }
    filteredData = moviesData.filter(d => (isFinite(d.year) ? d.year <= year : true));
}

// Mise à jour de toutes les visualisations
function updateVisualization(skipTableRecreation = false) {
    const { root } = buildHierarchy(currentMode, filteredData, currentSizeMode);
    
    // Update film count display with actual visualized films
    const visualizedFilms = root.children ? 
        root.children.flatMap(g => g.children || []).filter(d => d && isFinite(d.value)) : [];
    const uniqueFilms = new Set(visualizedFilms.map(d => d.name)).size;
    document.getElementById('filteredCount').textContent = uniqueFilms;
    
    renderPack(root);
    
    // Ne pas recréer le tableau si on vient d'appliquer des filtres de tableau
    if (!skipTableRecreation) {
        createDataTableForRoot(root);
    }
}

// Rendu du Circle Packing zoomable
function renderPack(dataRoot) {
    const container = d3.select('#pack');
    container.html('');

    const diameter = config.packDiameter;
    const pack = d3.pack().size([diameter, diameter]).padding(config.packPadding);

    const root = d3.hierarchy(dataRoot)
        .sum(d => d.value || 0)
        .sort((a, b) => (b.value || 0) - (a.value || 0));

    const nodes = pack(root).descendants();
    let focus = root;
    let view;

    const color = d3.scaleOrdinal()
        .domain(dataRoot.children.map(d => d.name))
        .range(d3.schemeCategory10.concat(d3.schemeSet3 || []));

    const svg = container
        .append('svg')
        .attr('viewBox', `-${diameter / 2} -${diameter / 2} ${diameter} ${diameter}`)
        .style('display', 'block')
        .style('cursor', 'pointer');

    // Configuration du zoom D3 (molette + drag)
    const d3ZoomBehavior = d3.zoom()
        .scaleExtent([0.2, 10])
        .on('zoom', (event) => {
            if (event.sourceEvent && event.sourceEvent.type === 'wheel') {
                // Zoom molette: ajuster uiZoomScale
                const newScale = Math.max(0.2, Math.min(3, uiZoomScale * (event.transform.k / (lastD3Transform ? lastD3Transform.k : 1))));
                uiZoomScale = newScale;
                document.getElementById('zoomSlider').value = uiZoomScale;
                if (view) zoomTo(view);
                lastD3Transform = event.transform;
            } else if (event.sourceEvent && (event.sourceEvent.type === 'mousemove' || event.sourceEvent.type === 'touchmove')) {
                // Pan/drag: décaler la vue
                const dx = event.transform.x - (lastD3Transform ? lastD3Transform.x : 0);
                const dy = event.transform.y - (lastD3Transform ? lastD3Transform.y : 0);
                if (view && (dx !== 0 || dy !== 0)) {
                    const k = diameter / view[2];
                    view = [view[0] - dx / k / uiZoomScale, view[1] - dy / k / uiZoomScale, view[2]];
                    zoomTo(view);
                }
                lastD3Transform = event.transform;
            }
        });
    
    let lastD3Transform = null;
    svg.call(d3ZoomBehavior);

    const circle = svg.append('g')
        .selectAll('circle')
        .data(nodes)
        .join('circle')
        .attr('class', d => d.parent ? (d.children ? 'node group' : 'node leaf') : 'node root')
        .style('fill', d => d.children ? '#f7f7ff' : color(d.parent && d.parent.data.name || ''))
        .style('stroke', d => d.children ? '#dcdcff' : '#c9c9ff')
        .style('stroke-width', '1px')
        .on('click', (event, d) => {
            // Comportement normal : zoom
            const target = (!d.children && d.parent) ? d.parent : d;
            if (focus !== target) {
                zoom(target);
                event.stopPropagation();
                if (target.children) {
                    createDataTable(target.data.children);
                }
            }
        })
    .append('title')
    .text(d => {
      if (d.children && d.depth === 1) {
        const metric = currentSizeMode === 'budget' ? 'Budget total' : 'Popularité totale';
        return `${d.data.name}\n${metric}: ${d3.format(',')(Math.round(d.value))}`;
      }
      if (!d.children && d.data) {
        const metric = currentSizeMode === 'budget' ? 'Budget' : 'Popularité';
        const value = currentSizeMode === 'budget' ? `$${(d.data.value / 1e6).toFixed(1)}M` : Math.round(d.data.value);
        return `${d.data.name}\n${metric}: ${value}\nNote: ${d.data.vote_average || 'N/A'}\nAnnée: ${d.data.year || 'N/A'}`;
      }
      return '';
    });
    
    const label = svg.append('g')
        .attr('pointer-events', 'none')
        .attr('text-anchor', 'middle')
        .selectAll('text')
        .data(nodes.filter(d => d.depth === 1)) // Seulement les groupes
        .join('text')
        .attr('class', 'group-label')
        .style('fill-opacity', d => d.parent === root ? 1 : 0)
        .style('display', d => d.parent === root ? 'inline' : 'none')
        .text(d => d.data.name);

    svg.on('click', () => {
        zoom(root);
        createDataTableForRoot(root.data);
    });

    zoomTo([root.x, root.y, root.r * 2]);

    function zoom(d) {
        focus = d;
        const transition = svg.transition().duration(650);
        transition.tween('zoom', () => {
            const i = d3.interpolateZoom(view, [focus.x, focus.y, focus.r * 2]);
            return t => zoomTo(i(t));
        });

        label
            .filter(function(l) { return l.parent === focus || this.style.display === 'inline'; })
            .transition(transition)
            .style('fill-opacity', l => l.parent === focus ? 1 : 0)
            .on('start', function(l) { if (l.parent === focus) this.style.display = 'inline'; })
            .on('end', function(l) { if (l.parent !== focus) this.style.display = 'none'; });
        
        // Mettre à jour les labels de films si activés
        if (showTitles && typeof window.__displayFilmTitles === 'function') {
            // Attendre la fin de la transition avant d'afficher les titres
            transition.on('end', () => {
                window.__displayFilmTitles();
            });
        }
    }

    function zoomTo(v) {
        const k = (diameter / v[2]) * uiZoomScale;
        view = v;
        svg.selectAll('circle')
            .attr('transform', d => `translate(${(d.x - v[0]) * k}, ${(d.y - v[1]) * k})`)
            .attr('r', d => d.r * k);
        svg.selectAll('text')
            .attr('transform', d => `translate(${(d.x - v[0]) * k}, ${(d.y - v[1]) * k})`)
            .style('font-size', d => `${Math.max(10, Math.min(18, d.r * k / 4))}px`);
    }

    // Expose a hook to reapply zoom when UI slider changes
    window.__reapplyZoom = () => {
        if (view) zoomTo(view);
    };
    
    // Fonction pour afficher les titres des films
    window.__displayFilmTitles = () => {
        if (!showTitles) return;
        
        // Récupérer tous les films (nodes sans enfants)
        const filmNodes = nodes.filter(d => !d.children && d.depth > 1);
        
        // Ajouter les labels pour les films
        const filmLabels = svg.select('g').selectAll('.film-label')
            .data(filmNodes)
            .join('text')
            .attr('class', 'film-label label')
            .attr('pointer-events', 'none')
            .attr('text-anchor', 'middle')
            .style('fill-opacity', d => d.parent === focus ? 1 : 0)
            .style('display', d => d.parent === focus ? 'inline' : 'none')
            .text(d => d.data.name.length > 18 ? d.data.name.slice(0, 18) + '…' : d.data.name)
            .attr('transform', d => `translate(${(d.x - view[0]) * (diameter / view[2]) * uiZoomScale}, ${(d.y - view[1]) * (diameter / view[2]) * uiZoomScale})`)
            .style('font-size', d => `${Math.max(10, Math.min(18, d.r * (diameter / view[2]) * uiZoomScale / 4))}px`);
    };
    
    // Fonction pour masquer les titres des films
    window.__hideFilmTitles = () => {
        svg.selectAll('.film-label').remove();
    };
}

// Tableau: par défaut, top films global ou du groupe sélectionné
function createDataTableForRoot(rootData) {
    if (!rootData || !rootData.children) { createDataTable([]); return; }
    // Tous les films globaux dans les groupes affichés, dédupliqués par titre
    const films = rootData.children.flatMap(g => g.children || [])
        .filter(d => d && isFinite(d.value));
    
    // Dédupliquer par titre (garder celui avec la plus grande valeur)
    const uniqueFilms = Array.from(
        films.reduce((map, film) => {
            const existing = map.get(film.name);
            if (!existing || film.value > existing.value) {
                map.set(film.name, film);
            }
            return map;
        }, new Map()).values()
    ).sort((a, b) => b.value - a.value);
    
    createDataTable(uniqueFilms);
}

function createDataTable(films) {
    const container = d3.select('#dataTable');
    container.html('');

    // Dédupliquer par titre
    const uniqueFilms = Array.from(
        films.reduce((map, film) => {
            const existing = map.get(film.name);
            if (!existing || film.value > existing.value) {
                map.set(film.name, film);
            }
            return map;
        }, new Map()).values()
    );

    baseTableData = uniqueFilms;
    tableFilters = {
        title: new Set(),
        year: selectedYears,
        note: selectedNotes,
        genres: new Set(),
        productions: new Set()
    };
    applyTableFilters();
}

function applyTableFilters() {
    // Ne plus synchroniser les titres avec le graphique
    
    // Mettre à jour la colonne de tri en fonction de currentSizeMode
    if (tableSortColumn === 'popularity' || tableSortColumn === 'budget' || tableSortColumn === 'revenue' || tableSortColumn === 'vote_average') {
        // Si on est sur un tri de métrique, mettre à jour selon currentSizeMode
        tableSortColumn = currentSizeMode === 'vote_average' ? 'note' : currentSizeMode;
    }
    
    currentTableData = baseTableData.filter(film => {
        // Filter by title
        if (tableFilters.title.size > 0 && !tableFilters.title.has(film.name)) {
            return false;
        }
        // Filter by year
        if (tableFilters.year.size > 0 && !tableFilters.year.has(String(film.year || ''))) {
            return false;
        }
        // Filter by note
        if (tableFilters.note.size > 0 && !tableFilters.note.has(String(film.vote_average ? film.vote_average.toFixed(1) : ''))) {
            return false;
        }
        // Filter by genres
        if (tableFilters.genres.size > 0) {
            const genres = parseArrayField(film.genres);
            if (!genres.some(g => tableFilters.genres.has(g))) {
                return false;
            }
        }
        // Filter by productions
        if (tableFilters.productions.size > 0) {
            const prods = parseArrayField(film.production_companies);
            if (!prods.some(p => tableFilters.productions.has(p))) {
                return false;
            }
        }
        // Numeric filters: popularity, budget, revenue
        if (numericTableFilters.popularity) {
            const f = numericTableFilters.popularity;
            const val = film.popularity ?? null;
            if (val === null) return false;
            if (f.op === 'gte' && !(val >= f.v1)) return false;
            if (f.op === 'lte' && !(val <= f.v1)) return false;
            if (f.op === 'between' && !(val >= f.v1 && val <= f.v2)) return false;
        }
        if (numericTableFilters.budget) {
            const f = numericTableFilters.budget;
            const val = film.budget ?? null;
            if (val === null) return false;
            if (f.op === 'gte' && !(val >= f.v1)) return false;
            if (f.op === 'lte' && !(val <= f.v1)) return false;
            if (f.op === 'between' && !(val >= f.v1 && val <= f.v2)) return false;
        }
        if (numericTableFilters.revenue) {
            const f = numericTableFilters.revenue;
            const val = film.revenue ?? null;
            if (val === null) return false;
            if (f.op === 'gte' && !(val >= f.v1)) return false;
            if (f.op === 'lte' && !(val <= f.v1)) return false;
            if (f.op === 'between' && !(val >= f.v1 && val <= f.v2)) return false;
        }
        return true;
    });
    currentPage = 1;
    
    // Trier les données après le filtrage
    sortTableData();
    
    // Mettre à jour le compteur de films filtrés
    updateTableFilterCount();
    
    // Mettre à jour les KPI
    updateFilterKPI();
    
    // Ne plus mettre à jour le graphique depuis les filtres du tableau
    
    if (!currentTableData.length) {
        const container = d3.select('#dataTable');
        container.html('<p class="loading">Aucune donnée à afficher</p>');
        return;
    }

    renderTable(); // Don't preserve scroll, just re-render normally
}

function updateTableFilterCount() {
    const countElement = document.getElementById('tableFilteredCount');
    if (!countElement) return;
    
    const totalFilms = baseTableData.length;
    const filteredFilms = currentTableData.length;
    const baseCount = Array.from(Object.values(tableFilters)).reduce((sum, set) => sum + set.size, 0);
    const numericCount = ['popularity','budget','revenue'].reduce((sum, k) => sum + (numericTableFilters[k] ? 1 : 0), 0);
    const activeFiltersCount = baseCount + numericCount;
    
    if (activeFiltersCount === 0) {
        countElement.textContent = `(${totalFilms} films)`;
    } else {
        countElement.textContent = `(${filteredFilms} / ${totalFilms} films - ${activeFiltersCount} filtre${activeFiltersCount > 1 ? 's' : ''} actif${activeFiltersCount > 1 ? 's' : ''})`;
    }
}

function updateFilterKPI() {
    const genresCount = selectedGenres.size + excludedGenres.size;
    const prodsCount = selectedCompanies.size + excludedCompanies.size;
    const titlesCount = selectedTitles.size + excludedTitles.size;
    const yearsCount = selectedYears.size + excludedYears.size;
    const notesCount = selectedNotes.size + excludedNotes.size;
    // Compteurs dynamiques pour numériques: nombre de valeurs uniques correspondant au filtre actif
    const countNumeric = (key) => {
        const nf = numericTableFilters[key];
        if (!nf) return 0;
        const list = getUniqueValuesForColumn(key)
            .map(v => parseFloat(v))
            .filter(v => !isNaN(v));
        if (nf.op === 'gte') return list.filter(v => v >= nf.v1).length;
        if (nf.op === 'lte') return list.filter(v => v <= nf.v1).length;
        if (nf.op === 'between') return list.filter(v => v >= nf.v1 && v <= nf.v2).length;
        return 0;
    };
    const popularityCount = countNumeric('popularity');
    const budgetCount = countNumeric('budget');
    const revenueCount = countNumeric('revenue');
    const total = genresCount + prodsCount + titlesCount + yearsCount + notesCount + popularityCount + budgetCount + revenueCount;
    
    const kpiGenres = document.getElementById('kpiGenres');
    const kpiProductions = document.getElementById('kpiProductions');
    const kpiTitles = document.getElementById('kpiTitles');
    const kpiYears = document.getElementById('kpiYears');
    const kpiNotes = document.getElementById('kpiNotes');
    const kpiPopularity = document.getElementById('kpiPopularity');
    const kpiBudget = document.getElementById('kpiBudget');
    const kpiRevenue = document.getElementById('kpiRevenue');
    const kpiTotal = document.getElementById('kpiTotal');
    
    if (kpiGenres) kpiGenres.textContent = `Genres: ${genresCount}`;
    if (kpiProductions) kpiProductions.textContent = `Productions: ${prodsCount}`;
    if (kpiTitles) kpiTitles.textContent = `Films: ${titlesCount}`;
    if (kpiYears) kpiYears.textContent = `Années: ${yearsCount}`;
    if (kpiNotes) kpiNotes.textContent = `Notes: ${notesCount}`;
    if (kpiPopularity) kpiPopularity.textContent = `Popularité: ${popularityCount}`;
    if (kpiBudget) kpiBudget.textContent = `Budget: ${budgetCount}`;
    if (kpiRevenue) kpiRevenue.textContent = `Revenus: ${revenueCount}`;
    if (kpiTotal) kpiTotal.textContent = `Total: ${total}`;
    
    // KPI mis à jour
}

function sortTableData() {
    if (!tableSortColumn) return;
    
    currentTableData.sort((a, b) => {
        let aVal, bVal;
        
        if (tableSortColumn === 'title') {
            aVal = a.name || '';
            bVal = b.name || '';
        } else if (tableSortColumn === 'year') {
            aVal = a.year || 0;
            bVal = b.year || 0;
        } else if (tableSortColumn === 'note') {
            aVal = a.vote_average || 0;
            bVal = b.vote_average || 0;
        } else if (tableSortColumn === 'popularity') {
            aVal = a.popularity || 0;
            bVal = b.popularity || 0;
        } else if (tableSortColumn === 'budget') {
            aVal = a.budget || 0;
            bVal = b.budget || 0;
        } else if (tableSortColumn === 'revenue') {
            aVal = a.revenue || 0;
            bVal = b.revenue || 0;
        } else if (tableSortColumn === 'vote_average') {
            aVal = a.vote_average || 0;
            bVal = b.vote_average || 0;
        } else if (tableSortColumn === 'genres') {
            const genresA = parseArrayField(a.genres);
            const genresB = parseArrayField(b.genres);
            aVal = genresA.length > 0 ? genresA[0] : '';
            bVal = genresB.length > 0 ? genresB[0] : '';
        } else if (tableSortColumn === 'productions') {
            const prodsA = parseArrayField(a.production_companies);
            const prodsB = parseArrayField(b.production_companies);
            aVal = prodsA.length > 0 ? prodsA[0] : '';
            bVal = prodsB.length > 0 ? prodsB[0] : '';
        } else {
            return 0;
        }
        
        // Sort numbers or strings
        let comparison = 0;
        if (typeof aVal === 'number' && typeof bVal === 'number') {
            comparison = aVal - bVal;
        } else {
            comparison = String(aVal).localeCompare(String(bVal), 'fr');
        }
        
        return tableSortOrder === 'asc' ? comparison : -comparison;
    });
}

function getUniqueValuesForColumn(filterKey) {
    const values = new Set();
    
    moviesData.forEach(film => {
        if (filterKey === 'title') {
            values.add(film.title);
        } else if (filterKey === 'year') {
            if (film.year) values.add(String(film.year));
        } else if (filterKey === 'note') {
            if (film.vote_average) values.add(film.vote_average.toFixed(1));
        } else if (filterKey === 'popularity') {
            if (film.popularity !== undefined && film.popularity !== null) values.add(String(Number(film.popularity)));
        } else if (filterKey === 'budget') {
            if (film.budget !== undefined && film.budget !== null) values.add(String(Number(film.budget)));
        } else if (filterKey === 'revenue') {
            if (film.revenue !== undefined && film.revenue !== null) values.add(String(Number(film.revenue)));
        } else if (filterKey === 'genres') {
            const genres = parseArrayField(film.genres);
            genres.forEach(g => values.add(g));
        } else if (filterKey === 'productions') {
            const prods = parseArrayField(film.production_companies);
            prods.forEach(p => values.add(p));
        }
    });
    
    return Array.from(values).sort((a, b) => {
        // Sort numbers numerically, strings alphabetically
        const aNum = parseFloat(a);
        const bNum = parseFloat(b);
        if (!isNaN(aNum) && !isNaN(bNum)) {
            return bNum - aNum; // Descending for numbers
        }
        return a.localeCompare(b, 'fr');
    });
}

function renderTable() {
    const container = d3.select('#dataTable');
    container.html('');

    const totalPages = Math.ceil(currentTableData.length / config.itemsPerPage);
    const startIndex = (currentPage - 1) * config.itemsPerPage;
    const endIndex = startIndex + config.itemsPerPage;
    const pageData = currentTableData.slice(startIndex, endIndex);

    const table = container.append('table');
    const thead = table.append('thead');
    
    // Remove any existing click listener first to prevent duplicates
    d3.select('body').on('click.closeOverlay', null);
    
    // Add click listener on body to close overlays when clicking outside
    if (activeTableFilters.size > 0) {
        d3.select('body').on('click.closeOverlay', function(event) {
            if (activeTableFilters.size > 0) {
                activeTableFilters.clear();
                renderTable();
            }
        });
    }
    
    // Create header row
    const headerRow = thead.append('tr');
    const headerData = [
        { label: 'Titre', filterKey: 'title', sortKey: 'title' },
        { label: 'Popularité', filterKey: 'popularity', sortKey: 'popularity' },
        { label: 'Note', filterKey: 'note', sortKey: 'note' },
        { label: 'Budget', filterKey: 'budget', sortKey: 'budget' },
        { label: 'Revenus', filterKey: 'revenue', sortKey: 'revenue' },
        { label: 'Année', filterKey: 'year', sortKey: 'year' },
        { label: 'Genres', filterKey: 'genres', sortKey: 'genres' },
        { label: 'Productions', filterKey: 'productions', sortKey: 'productions' }
    ];
    
    headerRow.selectAll('th')
        .data(headerData)
        .enter()
        .append('th')
        .attr('data-filter-key', d => d.filterKey ? d.filterKey : null)
        .style('position', 'relative')
        .each(function(d, i) {
            const th = d3.select(this);
            const isFilterActive = d.filterKey && activeTableFilters.has(d.filterKey);
            
            // Always show label with optional search icon and sort button
            const headerContent = th.append('div')
                .style('display', 'flex')
                .style('align-items', 'center')
                .style('gap', '5px')
                .style('justify-content', 'space-between');
            
            headerContent.append('span').text(d.label);
            
            const iconsContainer = headerContent.append('div')
                .style('display', 'flex')
                .style('gap', '5px')
                .style('align-items', 'center');
            
            // Sort button for all columns
            if (d.sortKey) {
                const isSorted = tableSortColumn === d.sortKey;
                const sortButton = iconsContainer.append('button')
                    .html(isSorted ? (tableSortOrder === 'asc' ? '▲' : '▼') : '⇅')
                    .attr('class', isSorted ? 'active' : '')
                    .attr('title', 'Trier')
                    .on('click', function(event) {
                        event.stopPropagation();
                        const columnKey = d.sortKey;
                        if (tableSortColumn === columnKey) {
                            tableSortOrder = tableSortOrder === 'asc' ? 'desc' : 'asc';
                        } else {
                            tableSortColumn = columnKey;
                            tableSortOrder = 'asc';
                        }
                        sortTableData();
                        renderTable();
                    });
            }
            
            if (d.filterKey) {
                // Compter sélections + exclusions, ou taille du filtre numérique actif
                let filterCount = 0;
                if (d.filterKey === 'genres') {
                    filterCount = selectedGenres.size + excludedGenres.size;
                } else if (d.filterKey === 'productions') {
                    filterCount = selectedCompanies.size + excludedCompanies.size;
                } else if (d.filterKey === 'title') {
                    filterCount = selectedTitles.size + excludedTitles.size;
                } else if (d.filterKey === 'year') {
                    filterCount = selectedYears.size + excludedYears.size;
                } else if (d.filterKey === 'note') {
                    filterCount = selectedNotes.size + excludedNotes.size;
                } else if (d.filterKey === 'popularity' || d.filterKey === 'budget' || d.filterKey === 'revenue') {
                    const nf = numericTableFilters[d.filterKey];
                    if (!nf) {
                        filterCount = 0;
                    } else {
                        // Compter le nombre de valeurs uniques correspondant au filtre
                        const uniqueVals = getUniqueValuesForColumn(d.filterKey).map(v => parseFloat(v)).filter(v => !isNaN(v));
                        if (nf.op === 'gte') {
                            filterCount = uniqueVals.filter(v => v >= nf.v1).length;
                        } else if (nf.op === 'lte') {
                            filterCount = uniqueVals.filter(v => v <= nf.v1).length;
                        } else if (nf.op === 'between') {
                            filterCount = uniqueVals.filter(v => v >= nf.v1 && v <= nf.v2).length;
                        } else {
                            filterCount = 1;
                        }
                    }
                }
                
                // Compteur filtre calculé
                
                const filterIcon = iconsContainer.append('span')
                    .attr('class', 'filter-icon')
                    .attr('title', 'Filtrer')
                    .style('position', 'relative')
                    .style('display', 'inline-block')
                    .on('click', function(event) {
                        event.stopPropagation();
                        activeTableFilters.clear(); // Fermer les autres overlays
                        activeTableFilters.add(d.filterKey);
                        renderTable();
                    });
                
                filterIcon.append('span').text('🔍');
                
                // Afficher le compteur dans un badge sur la loupe
                if (filterCount > 0) {
                    filterIcon.append('span')
                        .attr('class', 'filter-badge')
                        .style('position', 'absolute')
                        .style('top', '-8px')
                        .style('right', '-8px')
                        .style('background', '#28a745')
                        .style('color', 'white')
                        .style('border-radius', '12px')
                        .style('padding', '3px 7px')
                        .style('font-size', '11px')
                        .style('font-weight', 'bold')
                        .style('min-width', '20px')
                        .style('text-align', 'center')
                        .style('line-height', '1')
                        .text(filterCount);
                }
                
                // Icône filtre créée
            }
            
            if (d.filterKey && isFilterActive) {
                // Calculer le nombre d'éléments dans l'overlay
                const allValues = getUniqueValuesForColumn(d.filterKey);
                const itemCount = Math.min(allValues.length, 100); // Limité à 100
                
                // Hauteur estimée de l'overlay
                const itemHeight = 40; // padding + border par item
                const headerHeight = 50; // header + search input
                const maxListHeight = 300; // max-height du scroll
                const estimatedOverlayHeight = headerHeight + Math.min(itemCount * itemHeight, maxListHeight);
                
                // Position du header de colonne et espaces disponibles autour
                const anchorEl = th.node();
                const anchorRect = anchorEl ? anchorEl.getBoundingClientRect() : null;
                const spaceBelow = anchorRect ? (window.innerHeight - anchorRect.bottom) : 0;
                const spaceAbove = anchorRect ? anchorRect.top : 0;

                // Ouvrir vers le haut uniquement si pas assez d'espace en dessous
                // ET suffisamment d'espace au-dessus
                const shouldOpenUpward = !!anchorRect && (estimatedOverlayHeight > spaceBelow) && (spaceAbove >= estimatedOverlayHeight);
                
                // Show filter panel overlay
                const filterPanel = th.append('div')
                    .attr('class', 'filter-panel-overlay')
                    .style('position', 'absolute')
                    .style(shouldOpenUpward ? 'bottom' : 'top', '100%')
                    .style('left', '0')
                    .style('min-width', '250px')
                    .style('max-width', '380px')
                    .style('background', 'white')
                    .style('border', '2px solid #667eea')
                    .style('border-radius', '8px')
                    .style('box-shadow', '0 4px 12px rgba(0,0,0,0.15)')
                    .style('z-index', '1000')
                    .style(shouldOpenUpward ? 'margin-bottom' : 'margin-top', '4px')
                    .style('padding', '12px')
                    .style('display', 'flex')
                    .style('flex-direction', 'column')
                    .style('gap', '10px')
                    .on('click', function(event) { event.stopPropagation(); });
                
                // Header with clear and close buttons
                const panelHeader = filterPanel.append('div')
                    .style('display', 'flex')
                    .style('align-items', 'center')
                    .style('justify-content', 'space-between')
                    .style('margin-bottom', '8px')
                    .style('padding-bottom', '8px')
                    .style('border-bottom', '2px solid #667eea');
                
                panelHeader.append('span')
                    .text(d.label)
                    .style('font-weight', 'bold')
                    .style('color', '#667eea')
                    .style('font-size', '14px');
                
                const buttonGroup = panelHeader.append('div')
                    .style('display', 'flex')
                    .style('gap', '8px')
                    .style('align-items', 'center');
                
                // Clear filter button
                buttonGroup.append('button')
                    .attr('type', 'button')
                    .text('Effacer')
                    .style('padding', '4px 8px')
                    .style('background', '#dc3545')
                    .style('color', 'white')
                    .style('border', 'none')
                    .style('border-radius', '4px')
                    .style('cursor', 'pointer')
                    .style('font-size', '12px')
                    .style('font-weight', 'bold')
                    .on('click', function(event) {
                        event.stopPropagation();
                        pushFiltersHistory();
                        // Effacer les filtres pour cette colonne
                        if (d.filterKey === 'genres') {
                            selectedGenres.clear();
                            excludedGenres.clear();
                            tableFilters.genres.clear();
                        } else if (d.filterKey === 'productions') {
                            selectedCompanies.clear();
                            excludedCompanies.clear();
                            tableFilters.productions.clear();
                        } else if (d.filterKey === 'title') {
                            selectedTitles.clear();
                            excludedTitles.clear();
                            tableFilters.title.clear();
                        } else if (d.filterKey === 'year') {
                            selectedYears.clear();
                            excludedYears.clear();
                            tableFilters.year.clear();
                        } else if (d.filterKey === 'note') {
                            selectedNotes.clear();
                            excludedNotes.clear();
                            tableFilters.note.clear();
                        } else if (d.filterKey === 'popularity' || d.filterKey === 'budget' || d.filterKey === 'revenue') {
                            delete numericTableFilters[d.filterKey];
                        }
                        applyTableFilters();
                        updateFilteredData();
                        updateVisualization();
                        applySelectionsToUI();
                        activeTableFilters.delete(d.filterKey);
                        renderTable();
                    });
                
                // Close button
                buttonGroup.append('span')
                    .html('×')
                    .style('cursor', 'pointer')
                    .style('font-size', '24px')
                    .style('color', '#999')
                    .style('font-weight', 'bold')
                    .style('line-height', '1')
                    .on('click', function() {
                        activeTableFilters.delete(d.filterKey);
                        renderTable();
                    });
                
                // Get unique values for this column
                const uniqueValues = getUniqueValuesForColumn(d.filterKey);
                
                // Pour les filtres numériques (year, note, popularity, budget, revenue), afficher interface avec opérateurs
                const isNumericFilter = ['year', 'note', 'popularity', 'budget', 'revenue'].includes(d.filterKey);
                const hasExactOption = d.filterKey === 'year' || d.filterKey === 'note';
                
                if (isNumericFilter) {
                    // Interface pour filtres numériques
                    let currentOperator = null;
                    
                    // Conteneur pour les boutons d'opérateurs
                    const operatorButtons = filterPanel.append('div')
                        .style('display', 'flex')
                        .style('gap', '8px')
                        .style('margin-bottom', '12px')
                        .style('flex-wrap', 'wrap');
                    
                    let operators = [
                        { value: 'gte', label: '≥ Supérieur ou égal', symbol: '≥' },
                        { value: 'lte', label: '≤ Inférieur ou égal', symbol: '≤' },
                        { value: 'between', label: '↔ Entre', symbol: '↔' }
                    ];
                    if (hasExactOption) operators.push({ value: 'exact', label: '= Exact', symbol: '=' });
                    
                    // Conteneur pour les champs de saisie (caché initialement)
                    const inputContainer = filterPanel.append('div')
                        .style('display', 'none')
                        .style('margin-bottom', '12px');
                    
                    operators.forEach(op => {
                        operatorButtons.append('button')
                            .attr('type', 'button')
                            .text(op.symbol + ' ' + (op.value === 'gte' ? 'Sup.' : op.value === 'lte' ? 'Inf.' : op.value === 'exact' ? 'Égal' : 'Entre'))
                            .style('flex', hasExactOption ? '0 0 48%' : '0 0 32%')
                            .style('padding', '8px 12px')
                            .style('background', '#667eea')
                            .style('color', 'white')
                            .style('border', 'none')
                            .style('border-radius', '4px')
                            .style('cursor', 'pointer')
                            .style('font-size', '12px')
                            .style('font-weight', 'bold')
                            .style('transition', 'background 0.2s')
                            .on('mouseenter', function() {
                                d3.select(this).style('background', '#5568d3');
                            })
                            .on('mouseleave', function() {
                                d3.select(this).style('background', '#667eea');
                            })
                            .on('click', function(event) {
                                event.stopPropagation();
                                currentOperator = op.value;
                                
                                // Afficher les champs de saisie
                                inputContainer
                                    .style('display', 'flex')
                                    .style('flex-direction', 'column')
                                    .style('gap', '8px');
                                inputContainer.html('');
                                
                                const minVal = Math.min(...uniqueValues.map(v => parseFloat(v)));
                                const maxVal = Math.max(...uniqueValues.map(v => parseFloat(v)));
                                // pas de NaN en cas de données manquantes
                                const safeMin = isFinite(minVal) ? minVal : 0;
                                const safeMax = isFinite(maxVal) ? maxVal : 0;
                                
                                // Déterminer le pas
                                let step = 1; // pas par défaut
                                if (d.filterKey === 'note') step = 0.1;
                                // budget/revenue saisis en millions => step=1 (1 million)
                                
                                if (op.value === 'exact') {
                                    // Valeur exacte (seulement year/note) - bouton appliquer en dessous du champ, hors zone scroll
                                    const exactWrapper = inputContainer.append('div')
                                        .style('display', 'flex')
                                        .style('flex-direction', 'column')
                                        .style('gap', '8px');
                                    const input = exactWrapper.append('input')
                                        .attr('type', 'number')
                                        .attr('placeholder', 'Valeur exacte')
                                        .attr('min', safeMin)
                                        .attr('max', safeMax)
                                        .attr('step', step)
                                        .style('width', '100%')
                                        .style('padding', '6px 10px')
                                        .style('border', '1px solid #ddd')
                                        .style('border-radius', '4px')
                                        .style('font-size', '13px')
                                        .style('box-sizing', 'border-box')
                                        .on('keydown', function(event){ if (event.key === 'Enter') exactWrapper.select('button.apply-btn').dispatch('click'); });
                                    exactWrapper.append('button')
                                        .attr('type', 'button')
                                        .attr('class', 'apply-btn')
                                        .text('Appliquer')
                                        .style('width', '100%')
                                        .style('margin', '4px 0 0 0')
                                        .style('padding', '10px')
                                        .style('background', '#28a745')
                                        .style('color', 'white')
                                        .style('border', 'none')
                                        .style('border-radius', '6px')
                                        .style('cursor', 'pointer')
                                        .style('font-weight', 'bold')
                                        .on('click', function() {
                                            const val = parseFloat(input.node().value);
                                            if (isNaN(val)) return;
                                            pushFiltersHistory();
                                            const selectedSet = d.filterKey === 'year' ? selectedYears : selectedNotes;
                                            const tableFilterSet = tableFilters[d.filterKey];
                                            selectedSet.clear();
                                            tableFilterSet.clear();
                                            uniqueValues.forEach(v => {
                                                const numVal = parseFloat(v);
                                                if (Math.abs(numVal - val) < 0.0001) { selectedSet.add(v); tableFilterSet.add(v); }
                                            });
                                            applyTableFilters();
                                            activeTableFilters.delete(d.filterKey);
                                            renderTable();
                                            updateFilteredData();
                                            updateVisualization();
                                            applySelectionsToUI();
                                            
                                            // Repositionner le slider si c'est une année
                                            if (d.filterKey === 'year' && selectedYears.size > 0) {
                                                const years = Array.from(selectedYears).map(y => parseInt(y)).filter(y => !isNaN(y));
                                                if (years.length > 0) {
                                                    const minYear = Math.min(...years);
                                                    const maxYear = Math.max(...years);
                                                    if (window.setYearSliderProgrammatically) {
                                                        window.setYearSliderProgrammatically(minYear, maxYear);
                                                    }
                                                }
                                            }
                                        });
                                } else if (op.value === 'between') {
                                    // Deux champs pour "entre"
                                    const inputGroup = inputContainer.append('div')
                                        .style('display', 'flex')
                                        .style('gap', '8px')
                                        .style('align-items', 'center');
                                    
                                    const input1 = inputGroup.append('input')
                                        .attr('type', 'number')
                                        .attr('placeholder', d.filterKey === 'budget' || d.filterKey === 'revenue' ? 'Min (M€)' : 'Min')
                                        .attr('min', safeMin)
                                        .attr('max', safeMax)
                                        .attr('step', step)
                                        .style('flex', '1')
                                        .style('padding', '6px 10px')
                                        .style('border', '1px solid #ddd')
                                        .style('border-radius', '4px')
                                        .style('font-size', '13px')
                                        .style('box-sizing', 'border-box')
                                        .on('keydown', function(event){ if (event.key === 'Enter') inputContainer.select('button.apply-btn').dispatch('click'); });
                                    
                                    inputGroup.append('span').text('à').style('color', '#666');
                                    
                                    const input2 = inputGroup.append('input')
                                        .attr('type', 'number')
                                        .attr('placeholder', d.filterKey === 'budget' || d.filterKey === 'revenue' ? 'Max (M€)' : 'Max')
                                        .attr('min', safeMin)
                                        .attr('max', safeMax)
                                        .attr('step', step)
                                        .style('flex', '1')
                                        .style('padding', '6px 10px')
                                        .style('border', '1px solid #ddd')
                                        .style('border-radius', '4px')
                                        .style('font-size', '13px')
                                        .style('box-sizing', 'border-box')
                                        .on('keydown', function(event){ if (event.key === 'Enter') d3.select(this.parentNode.parentNode).select('button.apply-btn').dispatch('click'); });
                                    
                                    const applyBtn = inputContainer.append('button')
                                        .attr('type', 'button')
                                        .attr('class', 'apply-btn')
                                        .text('Appliquer')
                                        .style('width', '100%')
                                        .style('margin-top', '4px')
                                        .style('padding', '10px')
                                        .style('background', '#28a745')
                                        .style('color', 'white')
                                        .style('border', 'none')
                                        .style('border-radius', '6px')
                                        .style('cursor', 'pointer')
                                        .style('font-weight', 'bold')
                                        .on('click', function() {
                                            const val1 = parseFloat(input1.node().value);
                                            const val2 = parseFloat(input2.node().value);
                                            if (!isNaN(val1) && !isNaN(val2)) {
                                                pushFiltersHistory();
                                                const lo = Math.min(val1, val2), hi = Math.max(val1, val2);
                                                if (d.filterKey === 'year' || d.filterKey === 'note') {
                                                    const selectedSet = d.filterKey === 'year' ? selectedYears : selectedNotes;
                                                    const tableFilterSet = tableFilters[d.filterKey];
                                                    selectedSet.clear();
                                                    tableFilterSet.clear();
                                                    uniqueValues.forEach(v => {
                                                        const numVal = parseFloat(v);
                                                        if (numVal >= lo && numVal <= hi) { selectedSet.add(v); tableFilterSet.add(v); }
                                                    });
                                                } else {
                                                    // budget/revenue en millions -> stocker valeurs réelles
                                                    const scale = (d.filterKey === 'budget' || d.filterKey === 'revenue') ? 1000000 : 1;
                                                    numericTableFilters[d.filterKey] = { op: 'between', v1: lo * scale, v2: hi * scale };
                                                }
                                                applyTableFilters();
                                                activeTableFilters.delete(d.filterKey);
                                                renderTable();
                                                // Synchroniser graphique
                                                updateFilteredData();
                                                updateVisualization();
                                                applySelectionsToUI();
                                                
                                                // Repositionner le slider si c'est une année
                                                if (d.filterKey === 'year' && selectedYears.size > 0) {
                                                    const years = Array.from(selectedYears).map(y => parseInt(y)).filter(y => !isNaN(y));
                                                    if (years.length > 0) {
                                                        const minYear = Math.min(...years);
                                                        const maxYear = Math.max(...years);
                                                        if (window.setYearSliderProgrammatically) {
                                                            window.setYearSliderProgrammatically(minYear, maxYear);
                                                        }
                                                    }
                                                }
                                            }
                                        });
                                } else {
                                    // Un seul champ pour >= ou <=
                                    const input = inputContainer.append('input')
                                        .attr('type', 'number')
                                        .attr('placeholder', (d.filterKey === 'budget' || d.filterKey === 'revenue') ? 'Valeur (M€)' : 'Valeur')
                                        .attr('min', safeMin)
                                        .attr('max', safeMax)
                                        .attr('step', step)
                                        .style('width', '100%')
                                        .style('padding', '6px 10px')
                                        .style('border', '1px solid #ddd')
                                        .style('border-radius', '4px')
                                        .style('font-size', '13px')
                                        .style('box-sizing', 'border-box')
                                        .on('keydown', function(event){ if (event.key === 'Enter') inputContainer.select('button.apply-btn').dispatch('click'); });
                                    
                                    const applyBtn2 = inputContainer.append('button')
                                        .attr('type', 'button')
                                        .attr('class', 'apply-btn')
                                        .text('Appliquer')
                                        .style('width', '100%')
                                        .style('margin-top', '4px')
                                        .style('padding', '10px')
                                        .style('background', '#28a745')
                                        .style('color', 'white')
                                        .style('border', 'none')
                                        .style('border-radius', '6px')
                                        .style('cursor', 'pointer')
                                        .style('font-weight', 'bold')
                                        .on('click', function() {
                                            const val = parseFloat(input.node().value);
                                            if (!isNaN(val)) {
                                                pushFiltersHistory();
                                                if (d.filterKey === 'year' || d.filterKey === 'note') {
                                                    const selectedSet = d.filterKey === 'year' ? selectedYears : selectedNotes;
                                                    const tableFilterSet = tableFilters[d.filterKey];
                                                    selectedSet.clear();
                                                    tableFilterSet.clear();
                                                    uniqueValues.forEach(v => {
                                                        const numVal = parseFloat(v);
                                                        if (op.value === 'gte' && numVal >= val) { selectedSet.add(v); tableFilterSet.add(v); }
                                                        else if (op.value === 'lte' && numVal <= val) { selectedSet.add(v); tableFilterSet.add(v); }
                                                    });
                                                } else {
                                                    // valeur en millions pour budget/revenue
                                                    const scale = (d.filterKey === 'budget' || d.filterKey === 'revenue') ? 1000000 : 1;
                                                    numericTableFilters[d.filterKey] = { op: op.value, v1: val * scale };
                                                }
                                                applyTableFilters();
                                                activeTableFilters.delete(d.filterKey);
                                                renderTable();
                                                // Synchroniser graphique
                                                updateFilteredData();
                                                updateVisualization();
                                                applySelectionsToUI();
                                                
                                                // Repositionner le slider si c'est une année
                                                if (d.filterKey === 'year' && selectedYears.size > 0) {
                                                    const years = Array.from(selectedYears).map(y => parseInt(y)).filter(y => !isNaN(y));
                                                    if (years.length > 0) {
                                                        const minYear = Math.min(...years);
                                                        const maxYear = Math.max(...years);
                                                        if (window.setYearSliderProgrammatically) {
                                                            window.setYearSliderProgrammatically(minYear, maxYear);
                                                        }
                                                    }
                                                }
                                            }
                                        });
                                }
                            });
                    });
                    
                    return; // Ne pas afficher la liste de valeurs pour les filtres numériques
                }
                
                // Search input (pour les filtres non-numériques uniquement)
                const searchInput = filterPanel.append('input')
                    .attr('type', 'text')
                    .attr('placeholder', 'Rechercher...')
                    .style('width', '100%')
                    .style('margin-bottom', '8px')
                    .style('padding', '6px 10px')
                    .style('border', '1px solid #ddd')
                    .style('border-radius', '4px')
                    .style('font-size', '13px')
                    .style('box-sizing', 'border-box')
                    .style('outline', 'none')
                    .style('color', '#333')
                    .style('background', 'white');
                
                // Values list panel
                const valuesPanel = filterPanel.append('div')
                    .attr('class', 'filter-values-panel')
                    .style('max-height', '300px')
                    .style('overflow-y', 'auto')
                    .style('border', '1px solid #ddd')
                    .style('border-radius', '4px')
                    .style('background', '#fafafa');
                
                const renderValues = (searchTerm = '') => {
                    valuesPanel.html('');
                    const filtered = searchTerm 
                        ? uniqueValues.filter(v => v.toLowerCase().includes(searchTerm.toLowerCase()))
                        : uniqueValues;
                    
                    // Déterminer les sets d'exclusion et de sélection selon le type
                    let selectedSet, excludedSet;
                    if (d.filterKey === 'genres') {
                        selectedSet = selectedGenres;
                        excludedSet = excludedGenres;
                    } else if (d.filterKey === 'productions') {
                        selectedSet = selectedCompanies;
                        excludedSet = excludedCompanies;
                    } else if (d.filterKey === 'title') {
                        selectedSet = selectedTitles;
                        excludedSet = excludedTitles;
                    } else if (d.filterKey === 'year') {
                        selectedSet = selectedYears;
                        excludedSet = excludedYears;
                    } else if (d.filterKey === 'note') {
                        selectedSet = selectedNotes;
                        excludedSet = excludedNotes;
                    } else {
                        selectedSet = new Set();
                        excludedSet = new Set();
                    }
                    
                    // Calculer les items disponibles
                    let availableItems = new Set();
                    if (d.filterKey === 'genres') {
                        availableItems = getAvailableItems('genre');
                    } else if (d.filterKey === 'productions') {
                        availableItems = getAvailableItems('prod');
                    } else if (d.filterKey === 'title') {
                        availableItems = getAvailableItems('film');
                    } else if (d.filterKey === 'year') {
                        availableItems = getAvailableItems('year');
                    } else if (d.filterKey === 'note') {
                        availableItems = getAvailableItems('note');
                    }
                    
                    // Séparer par état: sélectionné, exclu, disponible, indisponible
                    const selected = filtered.filter(v => selectedSet.has(v)).sort((a, b) => {
                        // Tri numérique pour year et note, alphabétique pour le reste
                        if (d.filterKey === 'year' || d.filterKey === 'note') {
                            return parseFloat(b) - parseFloat(a); // Décroissant
                        }
                        return a.localeCompare(b, 'fr');
                    });
                    const excluded = filtered.filter(v => !selectedSet.has(v) && excludedSet.has(v)).sort((a, b) => {
                        if (d.filterKey === 'year' || d.filterKey === 'note') {
                            return parseFloat(b) - parseFloat(a);
                        }
                        return a.localeCompare(b, 'fr');
                    });
                    const available = filtered.filter(v => !selectedSet.has(v) && !excludedSet.has(v) && (availableItems.size === 0 || availableItems.has(v))).sort((a, b) => {
                        if (d.filterKey === 'year' || d.filterKey === 'note') {
                            return parseFloat(b) - parseFloat(a);
                        }
                        return a.localeCompare(b, 'fr');
                    });
                    const unavailable = filtered.filter(v => !selectedSet.has(v) && !excludedSet.has(v) && availableItems.size > 0 && !availableItems.has(v)).sort((a, b) => {
                        if (d.filterKey === 'year' || d.filterKey === 'note') {
                            return parseFloat(b) - parseFloat(a);
                        }
                        return a.localeCompare(b, 'fr');
                    });
                    
                    // Ordonner: sélectionné, exclu, disponible, indisponible
                    const ordered = [...selected, ...excluded, ...available, ...unavailable];
                    
                    ordered.slice(0, 100).forEach(value => {
                        const isSelected = selectedSet.has(value);
                        const isExcluded = excludedSet.has(value);
                        const isUnavailable = !isSelected && !isExcluded && availableItems.size > 0 && !availableItems.has(value);
                        let bgColor = 'white';
                        let textColor = '#333';
                        let opacity = 1;
                        let borderLeft = 'none';
                        let fontWeight = 'normal';
                        let textDecoration = 'none';
                        
                        if (isSelected) {
                            bgColor = '#d4edda';
                            textColor = '#155724';
                            borderLeft = '4px solid #28a745';
                            fontWeight = 'bold';
                        } else if (isExcluded) {
                            bgColor = '#f8d7da';
                            textColor = '#721c24';
                            borderLeft = '4px solid #dc3545';
                            fontWeight = 'bold';
                            textDecoration = 'line-through';
                        } else if (isUnavailable) {
                            bgColor = '#f5f5f5';
                            textColor = '#999';
                            opacity = 0.6;
                        }
                        
                        const item = valuesPanel.append('div')
                            .style('padding', '8px 10px')
                            .style('cursor', isUnavailable ? 'not-allowed' : 'pointer')
                            .style('background', bgColor)
                            .style('color', textColor)
                            .style('border-left', borderLeft)
                            .style('font-weight', fontWeight)
                            .style('text-decoration', textDecoration)
                            .style('opacity', opacity)
                            .style('border-bottom', '1px solid #eee')
                            .style('display', 'flex')
                            .style('align-items', 'center')
                            .style('gap', '8px')
                            .style('transition', 'background 0.2s')
                            .on('mouseenter', function() {
                                if (!isSelected && !isExcluded && !isUnavailable) {
                                    d3.select(this).style('background', '#f0f0f0');
                                }
                            })
                            .on('mouseleave', function() {
                                d3.select(this).style('background', bgColor);
                            })
                            .on('click', function(event) {
                                event.stopPropagation();
                                // Click item overlay
                                
                                // Sauvegarder l'état actuel dans l'historique
                                pushFiltersHistory();
                                // Retirer de l'exclusion si présent
                                if (isExcluded) {
                                    if (d.filterKey === 'genres') excludedGenres.delete(value);
                                    else if (d.filterKey === 'productions') excludedCompanies.delete(value);
                                    else if (d.filterKey === 'title') excludedTitles.delete(value);
                                    else if (d.filterKey === 'year') excludedYears.delete(value);
                                    else if (d.filterKey === 'note') excludedNotes.delete(value);
                                }
                                // Toggle sélection
                                if (tableFilters[d.filterKey].has(value)) {
                                    tableFilters[d.filterKey].delete(value);
                                } else {
                                    tableFilters[d.filterKey].add(value);
                                }
                                
                                // Synchroniser avec les filtres principaux
                                if (d.filterKey === 'genres') {
                                    if (tableFilters.genres.has(value)) {
                                        selectedGenres.add(value);
                                    } else {
                                        selectedGenres.delete(value);
                                    }
                                } else if (d.filterKey === 'productions') {
                                    if (tableFilters.productions.has(value)) {
                                        selectedCompanies.add(value);
                                    } else {
                                        selectedCompanies.delete(value);
                                    }
                                } else if (d.filterKey === 'title') {
                                    if (tableFilters.title.has(value)) {
                                        selectedTitles.add(value);
                                    } else {
                                        selectedTitles.delete(value);
                                    }
                                } else if (d.filterKey === 'year') {
                                    if (tableFilters.year.has(value)) {
                                        selectedYears.add(value);
                                    } else {
                                        selectedYears.delete(value);
                                    }
                                } else if (d.filterKey === 'note') {
                                    if (tableFilters.note.has(value)) {
                                        selectedNotes.add(value);
                                    } else {
                                        selectedNotes.delete(value);
                                    }
                                }
                                
                                // Synchronisation terminée
                                
                                // Update data and re-render values list only
                                currentTableData = baseTableData.filter(film => {
                                    if (tableFilters.title.size > 0 && !tableFilters.title.has(film.name)) return false;
                                    if (tableFilters.year.size > 0 && !tableFilters.year.has(String(film.year || ''))) return false;
                                    if (tableFilters.note.size > 0 && !tableFilters.note.has(String(film.vote_average ? film.vote_average.toFixed(1) : ''))) return false;
                                    if (tableFilters.genres.size > 0) {
                                        const genres = parseArrayField(film.genres);
                                        if (!genres.some(g => tableFilters.genres.has(g))) return false;
                                    }
                                    if (tableFilters.productions.size > 0) {
                                        const prods = parseArrayField(film.production_companies);
                                        if (!prods.some(p => tableFilters.productions.has(p))) return false;
                                    }
                                    return true;
                                });
                                currentPage = 1;
                                // Re-render the values to update checkboxes
                                const currentSearch = searchInput.node().value;
                                renderValues(currentSearch);
                                
                                // Update table body without full re-render to preserve overlay
                                updateTableBody();
                                // Mettre à jour la visualisation pour TOUS les filtres (pas seulement genres/productions/titres)
                                if (d.filterKey === 'genres' || d.filterKey === 'productions' || d.filterKey === 'title' || d.filterKey === 'year' || d.filterKey === 'note') {
                                    updateFilteredData();
                                    updateVisualization();
                                    applySelectionsToUI();
                                    
                                    // Si c'est une année, ajuster les poignées du slider
                                    if (d.filterKey === 'year' && selectedYears.size > 0) {
                                        const years = Array.from(selectedYears).map(y => parseInt(y)).filter(y => !isNaN(y));
                                        if (years.length > 0) {
                                            const minYear = Math.min(...years);
                                            const maxYear = Math.max(...years);
                                            if (window.setYearSliderProgrammatically) {
                                                window.setYearSliderProgrammatically(minYear, maxYear);
                                            }
                                        }
                                    }
                                }
                                
                                // KPI
                                updateFilterKPI();
                            })
                            .on('contextmenu', function(event) {
                                event.preventDefault();
                                event.stopPropagation();
                                
                                if (isUnavailable) return;
                                
                                // Clic droit item overlay
                                
                                // Sauvegarder l'état actuel dans l'historique
                                pushFiltersHistory();
                                
                                // Gérer l'exclusion selon le type
                                if (d.filterKey === 'genres') {
                                    if (excludedGenres.has(value)) {
                                        excludedGenres.delete(value);
                                    } else {
                                        excludedGenres.add(value);
                                        selectedGenres.delete(value);
                                    }
                                } else if (d.filterKey === 'productions') {
                                    if (excludedCompanies.has(value)) {
                                        excludedCompanies.delete(value);
                                    } else {
                                        excludedCompanies.add(value);
                                        selectedCompanies.delete(value);
                                    }
                                } else if (d.filterKey === 'title') {
                                    if (excludedTitles.has(value)) {
                                        excludedTitles.delete(value);
                                    } else {
                                        excludedTitles.add(value);
                                        selectedTitles.delete(value);
                                    }
                                } else if (d.filterKey === 'year') {
                                    if (excludedYears.has(value)) {
                                        excludedYears.delete(value);
                                    } else {
                                        excludedYears.add(value);
                                        selectedYears.delete(value);
                                    }
                                } else if (d.filterKey === 'note') {
                                    if (excludedNotes.has(value)) {
                                        excludedNotes.delete(value);
                                    } else {
                                        excludedNotes.add(value);
                                        selectedNotes.delete(value);
                                    }
                                }
                                
                                // Re-render the values to update display
                                const currentSearch = searchInput.node().value;
                                renderValues(currentSearch);
                                
                                updateFilteredData();
                                updateVisualization();
                                applySelectionsToUI();
                                
                                // Update table body
                                updateTableBody();
                                
                                updateFilterKPI();
                            });
                        
                        item.append('input')
                            .attr('type', 'checkbox')
                            .property('checked', isSelected)
                            .style('pointer-events', 'none')
                            .style('margin', '0');
                        
                        item.append('span')
                            .text(value)
                            .style('font-size', '13px')
                            .style('color', '#333');
                    });
                    
                    if (filtered.length > 100) {
                        valuesPanel.append('div')
                            .style('padding', '8px 10px')
                            .style('color', '#999')
                            .style('font-style', 'italic')
                            .style('font-size', '12px')
                            .style('text-align', 'center')
                            .text(`... et ${filtered.length - 100} autres`);
                    }
                    
                    if (filtered.length === 0) {
                        valuesPanel.append('div')
                            .style('padding', '20px')
                            .style('color', '#999')
                            .style('text-align', 'center')
                            .style('font-size', '13px')
                            .text('Aucun résultat');
                    }
                };
                
                searchInput.on('input', function() {
                    renderValues(this.value);
                });
                
                renderValues();
            }
        });

    const tbody = table.append('tbody');
    const rows = tbody.selectAll('tr')
        .data(pageData)
        .enter()
        .append('tr');

    rows.append('td').text(d => d.name);
    rows.append('td').text(d => Math.round(d.popularity || 0));
    rows.append('td').text(d => d.vote_average ? d.vote_average.toFixed(1) : 'N/A');
    rows.append('td').text(d => d.budget ? `$${(d.budget / 1e6).toFixed(1)}M` : 'N/A');
    rows.append('td').text(d => d.revenue ? `$${(d.revenue / 1e6).toFixed(1)}M` : 'N/A');
    rows.append('td').text(d => d.year || 'N/A');
    
    // Genres column with clickable tags
    rows.append('td')
        .each(function(d) {
            const cell = d3.select(this);
            const genres = parseArrayField(d.genres);
            if (genres.length === 0) {
                cell.text('N/A');
                return;
            }
            genres.forEach((genre, i) => {
                if (i > 0) cell.append('span').text(', ');
                const tag = cell.append('span')
                    .attr('class', 'filter-tag')
                    .text(genre)
                    .style('cursor', 'pointer')
                    .style('text-decoration', 'underline');
                
                // Coloration selon l'état
                if (excludedGenres.has(genre)) {
                    tag.style('color', '#ff4444')
                        .style('text-decoration', 'line-through')
                        .style('font-weight', 'bold');
                } else if (selectedGenres.has(genre)) {
                    tag.style('color', '#667eea')
                        .style('font-weight', 'bold');
                } else {
                    tag.style('color', '#667eea')
                        .style('font-weight', 'normal');
                }
                
                // Clic gauche : sélectionner/désélectionner
                tag.on('click', function(event) {
                    event.preventDefault();
                    event.stopPropagation();
                    pushFiltersHistory();
                    if (selectedGenres.has(genre)) {
                        selectedGenres.delete(genre);
                    } else {
                        selectedGenres.add(genre);
                        excludedGenres.delete(genre);
                    }
                    applySelectionsToUI();
                    updateFilteredData();
                    updateVisualization();
                });
                
                // Clic droit : exclure/inclure
                tag.on('contextmenu', function(event) {
                    event.preventDefault();
                    event.stopPropagation();
                    pushFiltersHistory();
                    if (excludedGenres.has(genre)) {
                        excludedGenres.delete(genre);
                    } else {
                        excludedGenres.add(genre);
                        selectedGenres.delete(genre);
                    }
                    applySelectionsToUI();
                    updateFilteredData();
                    updateVisualization();
                });
            });
        });
    
    // Productions column with clickable tags
    rows.append('td')
        .each(function(d) {
            const cell = d3.select(this);
            const prods = parseArrayField(d.production_companies);
            if (prods.length === 0) {
                cell.text('N/A');
                return;
            }
            prods.slice(0, 3).forEach((prod, i) => {
                if (i > 0) cell.append('span').text(', ');
                const tag = cell.append('span')
                    .attr('class', 'filter-tag')
                    .text(prod)
                    .style('cursor', 'pointer')
                    .style('text-decoration', 'underline');
                
                // Coloration selon l'état
                if (excludedCompanies.has(prod)) {
                    tag.style('color', '#ff4444')
                        .style('text-decoration', 'line-through')
                        .style('font-weight', 'bold');
                } else if (selectedCompanies.has(prod)) {
                    tag.style('color', '#667eea')
                        .style('font-weight', 'bold');
                } else {
                    tag.style('color', '#667eea')
                        .style('font-weight', 'normal');
                }
                
                // Clic gauche : sélectionner/désélectionner
                tag.on('click', function(event) {
                    event.preventDefault();
                    event.stopPropagation();
                    pushFiltersHistory();
                    if (selectedCompanies.has(prod)) {
                        selectedCompanies.delete(prod);
                    } else {
                        selectedCompanies.add(prod);
                        excludedCompanies.delete(prod);
                    }
                    applySelectionsToUI();
                    updateFilteredData();
                    updateVisualization();
                });
                
                // Clic droit : exclure/inclure
                tag.on('contextmenu', function(event) {
                    event.preventDefault();
                    event.stopPropagation();
                    pushFiltersHistory();
                    if (excludedCompanies.has(prod)) {
                        excludedCompanies.delete(prod);
                    } else {
                        excludedCompanies.add(prod);
                        selectedCompanies.delete(prod);
                    }
                    applySelectionsToUI();
                    updateFilteredData();
                    updateVisualization();
                });
            });
            if (prods.length > 3) {
                cell.append('span').text(' ...');
            }
        });

    // Ajouter les contrôles de pagination
    if (totalPages > 1) {
        const pagination = container.append('div')
            .attr('class', 'pagination')
            .style('margin-top', '15px')
            .style('display', 'flex')
            .style('justify-content', 'center')
            .style('align-items', 'center')
            .style('gap', '10px');

        // Bouton précédent
        pagination.append('button')
            .attr('class', 'page-btn')
            .text('‹ Précédent')
            .style('padding', '8px 15px')
            .style('border', '1px solid #667eea')
            .style('background', currentPage === 1 ? '#f0f0f0' : 'white')
            .style('color', currentPage === 1 ? '#999' : '#667eea')
            .style('border-radius', '5px')
            .style('cursor', currentPage === 1 ? 'not-allowed' : 'pointer')
            .style('font-weight', 'bold')
            .property('disabled', currentPage === 1)
            .on('click', () => {
                if (currentPage > 1) {
                    currentPage--;
                    renderTable();
                }
            });

        // Info page
        pagination.append('span')
            .style('color', '#666')
            .style('font-size', '14px')
            .text(`Page ${currentPage} sur ${totalPages} (${currentTableData.length} films)`);

        // Bouton suivant
        pagination.append('button')
            .attr('class', 'page-btn')
            .text('Suivant ›')
            .style('padding', '8px 15px')
            .style('border', '1px solid #667eea')
            .style('background', currentPage === totalPages ? '#f0f0f0' : 'white')
            .style('color', currentPage === totalPages ? '#999' : '#667eea')
            .style('border-radius', '5px')
            .style('cursor', currentPage === totalPages ? 'not-allowed' : 'pointer')
            .style('font-weight', 'bold')
            .property('disabled', currentPage === totalPages)
            .on('click', () => {
                if (currentPage < totalPages) {
                    currentPage++;
                    renderTable();
                }
            });
    }
}

function updateTableBody() {
    const table = d3.select('#dataTable table');
    if (table.empty()) return;
    
    const totalPages = Math.ceil(currentTableData.length / config.itemsPerPage);
    const startIndex = (currentPage - 1) * config.itemsPerPage;
    const endIndex = startIndex + config.itemsPerPage;
    const pageData = currentTableData.slice(startIndex, endIndex);
    
    // Remove old tbody and pagination
    table.select('tbody').remove();
    d3.select('#dataTable .pagination').remove();
    
    // Re-create tbody
    const tbody = table.append('tbody');
    const rows = tbody.selectAll('tr')
        .data(pageData)
        .enter()
        .append('tr');

    rows.append('td').text(d => d.name);
    rows.append('td').text(d => Math.round(d.popularity || 0));
    rows.append('td').text(d => d.vote_average ? d.vote_average.toFixed(1) : 'N/A');
    rows.append('td').text(d => d.budget ? `$${(d.budget / 1e6).toFixed(1)}M` : 'N/A');
    rows.append('td').text(d => d.revenue ? `$${(d.revenue / 1e6).toFixed(1)}M` : 'N/A');
    rows.append('td').text(d => d.year || 'N/A');
    
    // Genres column with clickable tags
    rows.append('td')
        .each(function(d) {
            const cell = d3.select(this);
            const genres = parseArrayField(d.genres);
            if (genres.length === 0) {
                cell.text('N/A');
                return;
            }
            genres.forEach((genre, i) => {
                if (i > 0) cell.append('span').text(', ');
                const tag = cell.append('span')
                    .attr('class', 'filter-tag')
                    .text(genre)
                    .style('cursor', 'pointer')
                    .style('text-decoration', 'underline');
                
                // Coloration selon l'état
                if (excludedGenres.has(genre)) {
                    tag.style('color', '#ff4444')
                        .style('text-decoration', 'line-through')
                        .style('font-weight', 'bold');
                } else if (selectedGenres.has(genre)) {
                    tag.style('color', '#667eea')
                        .style('font-weight', 'bold');
                } else {
                    tag.style('color', '#667eea')
                        .style('font-weight', 'normal');
                }
                
                // Clic gauche : sélectionner/désélectionner
                tag.on('click', function(event) {
                    event.preventDefault();
                    event.stopPropagation();
                    pushFiltersHistory();
                    if (selectedGenres.has(genre)) {
                        selectedGenres.delete(genre);
                    } else {
                        selectedGenres.add(genre);
                        excludedGenres.delete(genre);
                    }
                    applySelectionsToUI();
                    updateFilteredData();
                    updateVisualization();
                });
                
                // Clic droit : exclure/inclure
                tag.on('contextmenu', function(event) {
                    event.preventDefault();
                    event.stopPropagation();
                    pushFiltersHistory();
                    if (excludedGenres.has(genre)) {
                        excludedGenres.delete(genre);
                    } else {
                        excludedGenres.add(genre);
                        selectedGenres.delete(genre);
                    }
                    applySelectionsToUI();
                    updateFilteredData();
                    updateVisualization();
                });
            });
        });
    
    // Productions column with clickable tags
    rows.append('td')
        .each(function(d) {
            const cell = d3.select(this);
            const prods = parseArrayField(d.production_companies);
            if (prods.length === 0) {
                cell.text('N/A');
                return;
            }
            prods.slice(0, 3).forEach((prod, i) => {
                if (i > 0) cell.append('span').text(', ');
                const tag = cell.append('span')
                    .attr('class', 'filter-tag')
                    .text(prod)
                    .style('cursor', 'pointer')
                    .style('text-decoration', 'underline');
                
                // Coloration selon l'état
                if (excludedCompanies.has(prod)) {
                    tag.style('color', '#ff4444')
                        .style('text-decoration', 'line-through')
                        .style('font-weight', 'bold');
                } else if (selectedCompanies.has(prod)) {
                    tag.style('color', '#667eea')
                        .style('font-weight', 'bold');
                } else {
                    tag.style('color', '#667eea')
                        .style('font-weight', 'normal');
                }
                
                // Clic gauche : sélectionner/désélectionner
                tag.on('click', function(event) {
                    event.preventDefault();
                    event.stopPropagation();
                    pushFiltersHistory();
                    if (selectedCompanies.has(prod)) {
                        selectedCompanies.delete(prod);
                    } else {
                        selectedCompanies.add(prod);
                        excludedCompanies.delete(prod);
                    }
                    applySelectionsToUI();
                    updateFilteredData();
                    updateVisualization();
                });
                
                // Clic droit : exclure/inclure
                tag.on('contextmenu', function(event) {
                    event.preventDefault();
                    event.stopPropagation();
                    pushFiltersHistory();
                    if (excludedCompanies.has(prod)) {
                        excludedCompanies.delete(prod);
                    } else {
                        excludedCompanies.add(prod);
                        selectedCompanies.delete(prod);
                    }
                    applySelectionsToUI();
                    updateFilteredData();
                    updateVisualization();
                });
            });
            if (prods.length > 3) {
                cell.append('span').text(' ...');
            }
        });
    
    // Add pagination
    if (totalPages > 1) {
        const container = d3.select('#dataTable');
        const pagination = container.append('div')
            .attr('class', 'pagination')
            .style('margin-top', '15px')
            .style('display', 'flex')
            .style('justify-content', 'center')
            .style('align-items', 'center')
            .style('gap', '10px');

        pagination.append('button')
            .attr('class', 'page-btn')
            .text('‹ Précédent')
            .style('padding', '8px 15px')
            .style('border', '1px solid #667eea')
            .style('background', currentPage === 1 ? '#f0f0f0' : 'white')
            .style('color', currentPage === 1 ? '#999' : '#667eea')
            .style('border-radius', '5px')
            .style('cursor', currentPage === 1 ? 'not-allowed' : 'pointer')
            .style('font-weight', 'bold')
            .property('disabled', currentPage === 1)
            .on('click', () => {
                if (currentPage > 1) {
                    currentPage--;
                    updateTableBody();
                }
            });

        pagination.append('span')
            .style('color', '#666')
            .style('font-size', '14px')
            .text(`Page ${currentPage} sur ${totalPages} (${currentTableData.length} films)`);

        pagination.append('button')
            .attr('class', 'page-btn')
            .text('Suivant ›')
            .style('padding', '8px 15px')
            .style('border', '1px solid #667eea')
            .style('background', currentPage === totalPages ? '#f0f0f0' : 'white')
            .style('color', currentPage === totalPages ? '#999' : '#667eea')
            .style('border-radius', '5px')
            .style('cursor', currentPage === totalPages ? 'not-allowed' : 'pointer')
            .style('font-weight', 'bold')
            .property('disabled', currentPage === totalPages)
            .on('click', () => {
                if (currentPage < totalPages) {
                    currentPage++;
                    updateTableBody();
                }
            });
    }
}

// États
function showLoading() {
  const pack = document.getElementById('pack');
  const table = document.getElementById('dataTable');
  if (pack) pack.innerHTML = '<p class="loading">Chargement des données...</p>';
  if (table) table.innerHTML = '<p class="loading">Chargement des données...</p>';
}function hideLoading() {
    // rien de spécifique; les vues se rendent
}

function showError(message) {
  const errorHtml = `<p class="loading" style="color: red;">${message}</p>`;
  const pack = document.getElementById('pack');
  const table = document.getElementById('dataTable');
  if (pack) pack.innerHTML = errorHtml;
  if (table) table.innerHTML = errorHtml;
}

// Utilities: history + UI apply + reorder selected options
function pushFiltersHistory() {
    filterHistory.push({
        genres: Array.from(selectedGenres),
        companies: Array.from(selectedCompanies),
        titles: Array.from(selectedTitles),
        years: Array.from(selectedYears),
        notes: Array.from(selectedNotes),
        excludedGenres: Array.from(excludedGenres),
        excludedCompanies: Array.from(excludedCompanies),
        excludedTitles: Array.from(excludedTitles),
        excludedYears: Array.from(excludedYears),
        excludedNotes: Array.from(excludedNotes),
        strictGenre,
        strictProd,
        numericPop: numericTableFilters.popularity,
        numericBudget: numericTableFilters.budget,
        numericRevenue: numericTableFilters.revenue
    });
    // Clear redo history when a new action is performed
    redoHistory = [];
}

function applySelectionsToUI() {
    // Mise à jour UI multi-listes
    
    // Mettre à jour prodOptions pour prioriser les productions disponibles
    if (allProdOptions && allProdOptions.length > 0) {
        const availableProds = getAvailableItems('prod');
        
        // Créer un map avec les fréquences pour trier
        const prodFreqMap = new Map();
        allProdOptions.forEach((prod, index) => {
            prodFreqMap.set(prod, allProdOptions.length - index); // Score basé sur la position
        });
        
        // Séparer disponibles et non disponibles
        const availableProdsArray = allProdOptions.filter(p => availableProds.has(p));
        const unavailableProdsArray = allProdOptions.filter(p => !availableProds.has(p));
        
        // Limiter à 200 pour l'affichage : disponibles en priorité
        prodOptions = [...availableProdsArray, ...unavailableProdsArray].slice(0, 200);
    }
    
    renderMultiList('genreList', genreOptions, selectedGenres, 'genre');
    renderMultiList('prodList', prodOptions, selectedCompanies, 'prod', allProdOptions);
    if (filmOptions && filmOptions.length) {
        renderMultiList('filmList', filmOptions, selectedTitles, 'film');
    }
    if (yearOptions && yearOptions.length) {
        // Rendu liste années
        renderMultiList('yearList', yearOptions, selectedYears, 'year');
    } else {
        // Années indisponibles
    }
    if (noteOptions && noteOptions.length) {
        // Rendu liste notes
        renderMultiList('noteList', noteOptions, selectedNotes, 'note');
    } else {
        // Notes indisponibles
    }
    // Re-apply search filters after rendering
    reapplySearchFilters();
}

// Re-apply active search filters
function reapplySearchFilters() {
    const genreSearch = document.getElementById('genreSearch');
    const prodSearch = document.getElementById('prodSearch');
    const filmSearch = document.getElementById('filmSearch');
    const yearSearch = document.getElementById('yearSearch');
    const noteSearch = document.getElementById('noteSearch');
    
    if (genreSearch && genreSearch.value) {
        filterListItems('genreList', genreSearch.value.toLowerCase().trim());
    }
    if (prodSearch && prodSearch.value) {
        filterListItems('prodList', prodSearch.value.toLowerCase().trim());
    }
    if (filmSearch && filmSearch.value) {
        filterListItems('filmList', filmSearch.value.toLowerCase().trim());
    }
    if (yearSearch && yearSearch.value) {
        filterListItems('yearList', yearSearch.value.toLowerCase().trim());
    }
    if (noteSearch && noteSearch.value) {
        filterListItems('noteList', noteSearch.value.toLowerCase().trim());
    }
}

// Render a custom multi-select list with left click add, right click remove
function renderMultiList(containerId, allItems, selectedSet, kind, allItemsForSearch = null) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    // Si allItemsForSearch n'est pas fourni, utiliser allItems
    const searchableItems = allItemsForSearch || allItems;
    
    // Stocker la liste complète comme attribut data pour la recherche
    container.dataset.allItems = JSON.stringify(searchableItems);
    container.innerHTML = '';

    // Rendu multi-liste
    
    // Convertir selectedSet en Set si c'est un tableau
    const selectedSetObj = Array.isArray(selectedSet) ? new Set(selectedSet) : selectedSet;
    
    // Déterminer quel Set/Array d'exclusion utiliser
    let excludedSet;
    if (kind === 'genre') excludedSet = excludedGenres;
    else if (kind === 'prod') excludedSet = excludedCompanies;
    else if (kind === 'film') excludedSet = excludedTitles;
    else if (kind === 'year') excludedSet = excludedYears;
    else if (kind === 'note') excludedSet = excludedNotes;
    else excludedSet = new Set();

    // Calculate available items based on current filters
    const availableItems = getAvailableItems(kind);

    // Fonction de tri : numérique pour year/note, alphabétique pour le reste
    const sortFn = (kind === 'year' || kind === 'note') 
        ? (a, b) => parseFloat(b) - parseFloat(a)
        : (a, b) => a.localeCompare(b, 'fr');

    // Separate items into four categories
    const selected = allItems.filter(x => selectedSetObj.has(x)).sort(sortFn);
    const excluded = allItems.filter(x => excludedSet.has(x)).sort(sortFn);
    const available = allItems.filter(x => !selectedSetObj.has(x) && !excludedSet.has(x) && availableItems.has(x)).sort(sortFn);
    const unavailable = allItems.filter(x => !selectedSetObj.has(x) && !excludedSet.has(x) && !availableItems.has(x)).sort(sortFn);
    
    // Order: selected → excluded → available → unavailable
    const ordered = [...selected, ...excluded, ...available, ...unavailable];

    let isDragging = false;
    let dragMode = null; // 'add' or 'remove'
    let hasChanges = false;
    let dragStartItem = null;
    let hasMoved = false;

    const stopDragging = () => {
        if (isDragging && hasChanges) {
            updateFilteredData();
            updateVisualization();
            hasChanges = false;
        }
        isDragging = false;
        dragMode = null;
        dragStartItem = null;
        hasMoved = false;
    };

    document.addEventListener('mouseup', stopDragging);

    container.addEventListener('mouseleave', stopDragging);

    ordered.forEach(name => {
        const div = document.createElement('div');
        const isSelected = selectedSetObj.has(name);
        const isExcluded = excludedSet.has(name);
        const isUnavailable = !isSelected && !isExcluded && !availableItems.has(name);
        
        div.className = 'multi-item';
        if (isSelected) {
            div.className += ' selected';
            div.style.backgroundColor = '#d4edda';
            div.style.color = '#155724';
            div.style.fontWeight = 'bold';
            div.style.borderLeft = '4px solid #28a745';
        } else if (isExcluded) {
            div.className += ' excluded';
            div.style.backgroundColor = '#f8d7da';
            div.style.color = '#721c24';
            div.style.fontWeight = 'bold';
            div.style.borderLeft = '4px solid #dc3545';
            div.style.textDecoration = 'line-through';
        } else if (isUnavailable) {
            div.className += ' unavailable';
            div.style.opacity = '0.5';
        }
        
        div.textContent = name;
        
        // Prevent text selection during drag
        div.addEventListener('selectstart', (e) => e.preventDefault());
        
        // Helper functions pour gérer Set ou Array
        const addToSelected = (val) => {
            if (Array.isArray(selectedSet)) {
                if (!selectedSet.includes(val)) selectedSet.push(val);
            } else {
                selectedSet.add(val);
            }
        };
        
        const removeFromSelected = (val) => {
            if (Array.isArray(selectedSet)) {
                const idx = selectedSet.indexOf(val);
                if (idx > -1) selectedSet.splice(idx, 1);
            } else {
                selectedSet.delete(val);
            }
        };
        
        const hasInSelected = (val) => {
            return Array.isArray(selectedSet) ? selectedSet.includes(val) : selectedSet.has(val);
        };
        
        // Mouse down: prepare for drag or click
        div.addEventListener('mousedown', (e) => {
            if (e.button === 0) { // Left click
                e.preventDefault();
                // MouseDown multi-liste
                isDragging = true;
                dragStartItem = name;
                hasMoved = false;
                
                // Determine mode and apply to start item immediately
                if (isExcluded) {
                    // Si exclu, on l'inclut (devient sélectionné)
                    dragMode = 'add';
                    pushFiltersHistory();
                    excludedSet.delete(name);
                    addToSelected(name);
                    // Exclu -> sélectionné
                    hasChanges = true;
                    applySelectionsToUI();
                } else if (!isUnavailable && !hasInSelected(name)) {
                    // Si normal et disponible, on le sélectionne
                    dragMode = 'add';
                    pushFiltersHistory();
                    addToSelected(name);
                    excludedSet.delete(name);
                    // Normal -> sélectionné
                    hasChanges = true;
                    applySelectionsToUI();
                } else if (hasInSelected(name)) {
                    // Si déjà sélectionné, on le désélectionne
                    dragMode = 'remove';
                    pushFiltersHistory();
                    removeFromSelected(name);
                    // Sélectionné -> normal
                    hasChanges = true;
                    applySelectionsToUI();
                }
            }
        });

        // Mouse up: update visualization if simple click
        div.addEventListener('mouseup', (e) => {
            if (e.button === 0 && isDragging && dragStartItem === name && !hasMoved) {
                // Simple click without drag - update visualization
                updateFilteredData();
                updateVisualization();
            }
        });

        // Drag over: apply action during drag
        div.addEventListener('mouseenter', (e) => {
            if (!isDragging || !dragMode) return;
            
            // Mark that we've moved to a different item
            if (dragStartItem !== name) {
                hasMoved = true;
            }
            
            if (dragMode === 'add') {
                if (!availableItems.has(name) || hasInSelected(name) || excludedSet.has(name)) return;
                addToSelected(name);
                excludedSet.delete(name);
                hasChanges = true;
                applySelectionsToUI();
            } else if (dragMode === 'remove') {
                if (!hasInSelected(name)) return;
                removeFromSelected(name);
                hasChanges = true;
                applySelectionsToUI();
            }
        });

        // Right click: exclure/inclure (maintenant aussi pour films)
        div.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            // Clic droit multi-liste
            pushFiltersHistory();
            if (excludedSet.has(name)) {
                excludedSet.delete(name);
                // Exclu -> normal
            } else {
                excludedSet.add(name);
                removeFromSelected(name);
                // Normal/Sélectionné -> exclu
            }
            applySelectionsToUI();
            updateFilteredData();
            updateVisualization();
        });
        container.appendChild(div);
    });
}

// Get available items based on current filters (excluding the kind being checked)
function getAvailableItems(kind) {
    const yearFilterMin = document.getElementById('yearFilterMin');
    const yearFilterMax = document.getElementById('yearFilterMax');
    const minVal = yearFilterMin ? +yearFilterMin.value : -Infinity;
    const maxVal = yearFilterMax ? +yearFilterMax.value : Infinity;
    const yearMin = Math.min(minVal, maxVal);
    const yearMax = Math.max(minVal, maxVal);

    const availableSet = new Set();
    
    for (const movie of moviesData) {
        // Apply year filter
        if (isFinite(movie.year) && (movie.year < yearMin || movie.year > yearMax)) {
            continue;
        }
        
        // Apply year table filter
        if (kind !== 'year' && selectedYears.size > 0) {
            if (!selectedYears.has(String(movie.year || ''))) continue;
        }
        
        // Exclure les années exclues (sauf si on calcule year)
        if (kind !== 'year' && excludedYears.size > 0) {
            if (excludedYears.has(String(movie.year || ''))) continue;
        }
        
        // Apply note table filter
        if (kind !== 'note' && selectedNotes.size > 0) {
            const noteStr = movie.vote_average ? movie.vote_average.toFixed(1) : '';
            if (!selectedNotes.has(noteStr)) continue;
        }
        
        // Exclure les notes exclues (sauf si on calcule note)
        if (kind !== 'note' && excludedNotes.size > 0) {
            const noteStr = movie.vote_average ? movie.vote_average.toFixed(1) : '';
            if (excludedNotes.has(noteStr)) continue;
        }
        
        const gs = parseArrayField(movie.genres);
        const ps = parseArrayField(movie.production_companies);
        
        if (kind === 'film') {
            // Le film est disponible si il satisfait déjà les autres filtres actifs
            // Vérifier genres
            if (selectedGenres.size > 0) {
                if (strictGenre) {
                    const requireAllSelected = Array.from(selectedGenres).every(x => gs.includes(x));
                    if (!requireAllSelected) continue;
                } else if (!gs.some(x => selectedGenres.has(x))) {
                    continue;
                }
            }
            // Vérifier productions
            if (selectedCompanies.size > 0) {
                if (strictProd) {
                    const requireAllSelectedP = Array.from(selectedCompanies).every(x => ps.includes(x));
                    if (!requireAllSelectedP) continue;
                } else if (!ps.some(x => selectedCompanies.has(x))) {
                    continue;
                }
            }
            availableSet.add(movie.title);
        } else if (kind === 'genre') {
            // Check if movie matches production and title filters
            if (selectedCompanies.size > 0) {
                if (strictProd) {
                    const requireAllSelectedP = Array.from(selectedCompanies).every(x => ps.includes(x));
                    if (!requireAllSelectedP) continue;
                } else {
                    if (!ps.some(x => selectedCompanies.has(x))) continue;
                }
            }
            // Vérifier les films sélectionnés
            if (selectedTitles.size > 0 && !selectedTitles.has(movie.title)) continue;
            // Exclure les films exclus
            if (excludedTitles.has(movie.title)) continue;
            // Add all genres from this movie
            gs.forEach(g => availableSet.add(g));
        } else if (kind === 'prod') { // productions
            // Check if movie matches genre and title filters
            if (selectedGenres.size > 0) {
                if (strictGenre) {
                    const requireAllSelected = Array.from(selectedGenres).every(x => gs.includes(x));
                    if (!requireAllSelected) continue;
                } else {
                    if (!gs.some(x => selectedGenres.has(x))) continue;
                }
            }
            // Vérifier les films sélectionnés
            if (selectedTitles.size > 0 && !selectedTitles.has(movie.title)) continue;
            // Exclure les films exclus
            if (excludedTitles.has(movie.title)) continue;
            // Add all productions from this movie
            ps.forEach(p => availableSet.add(p));
        } else if (kind === 'year') {
            // Calculer les années disponibles en excluant le filtre year lui-même
            // Vérifier genres
            if (selectedGenres.size > 0) {
                if (strictGenre) {
                    const requireAllSelected = Array.from(selectedGenres).every(x => gs.includes(x));
                    if (!requireAllSelected) continue;
                } else if (!gs.some(x => selectedGenres.has(x))) {
                    continue;
                }
            }
            // Vérifier productions
            if (selectedCompanies.size > 0) {
                if (strictProd) {
                    const requireAllSelectedP = Array.from(selectedCompanies).every(x => ps.includes(x));
                    if (!requireAllSelectedP) continue;
                } else if (!ps.some(x => selectedCompanies.has(x))) {
                    continue;
                }
            }
            // Vérifier les films sélectionnés
            if (selectedTitles.size > 0 && !selectedTitles.has(movie.title)) continue;
            // Exclure les films exclus
            if (excludedTitles.has(movie.title)) continue;
            // Vérifier notes (mais pas year)
            if (selectedNotes.size > 0) {
                const noteStr = movie.vote_average ? movie.vote_average.toFixed(1) : '';
                if (!selectedNotes.has(noteStr)) continue;
            }
            // Exclure les notes exclues
            if (excludedNotes.size > 0) {
                const noteStr = movie.vote_average ? movie.vote_average.toFixed(1) : '';
                if (excludedNotes.has(noteStr)) continue;
            }
            // Add year from this movie
            if (movie.year) availableSet.add(String(movie.year));
        } else if (kind === 'note') {
            // Calculer les notes disponibles en excluant le filtre note lui-même
            // Vérifier genres
            if (selectedGenres.size > 0) {
                if (strictGenre) {
                    const requireAllSelected = Array.from(selectedGenres).every(x => gs.includes(x));
                    if (!requireAllSelected) continue;
                } else if (!gs.some(x => selectedGenres.has(x))) {
                    continue;
                }
            }
            // Vérifier productions
            if (selectedCompanies.size > 0) {
                if (strictProd) {
                    const requireAllSelectedP = Array.from(selectedCompanies).every(x => ps.includes(x));
                    if (!requireAllSelectedP) continue;
                } else if (!ps.some(x => selectedCompanies.has(x))) {
                    continue;
                }
            }
            // Vérifier les films sélectionnés
            if (selectedTitles.size > 0 && !selectedTitles.has(movie.title)) continue;
            // Exclure les films exclus
            if (excludedTitles.has(movie.title)) continue;
            // Vérifier years (mais pas note)
            if (selectedYears.size > 0) {
                if (!selectedYears.has(String(movie.year || ''))) continue;
            }
            // Exclure les années exclues
            if (excludedYears.size > 0) {
                if (excludedYears.has(String(movie.year || ''))) continue;
            }
            // Add note from this movie
            if (movie.vote_average) availableSet.add(movie.vote_average.toFixed(1));
        }
    }
    
    return availableSet;
}

// Compute filtered data combining year + genre + production filters
function updateFilteredData() {
    const yearFilterMin = document.getElementById('yearFilterMin');
    const yearFilterMax = document.getElementById('yearFilterMax');
    const minVal = yearFilterMin ? +yearFilterMin.value : -Infinity;
    const maxVal = yearFilterMax ? +yearFilterMax.value : Infinity;
    
    // Allow crossing: actual min/max
    const yearMin = Math.min(minVal, maxVal);
    const yearMax = Math.max(minVal, maxVal);
    
    filteredData = moviesData
        .filter(d => {
            if (!isFinite(d.year)) return true;
            return d.year >= yearMin && d.year <= yearMax;
        })
        .filter(d => {
            // Filtrer par année (selectedYears)
            if (selectedYears.size > 0) {
                if (!selectedYears.has(String(d.year || ''))) return false;
            }
            
            // Exclure les années exclues
            if (excludedYears.size > 0) {
                if (excludedYears.has(String(d.year || ''))) return false;
            }
            
            // Filtrer par note (selectedNotes)
            if (selectedNotes.size > 0) {
                const noteStr = d.vote_average ? d.vote_average.toFixed(1) : '';
                if (!selectedNotes.has(noteStr)) return false;
            }
            
            // Exclure les notes exclues
            if (excludedNotes.size > 0) {
                const noteStr = d.vote_average ? d.vote_average.toFixed(1) : '';
                if (excludedNotes.has(noteStr)) return false;
            }
            
            // Filtrer par titre si des titres sont sélectionnés
            if (selectedTitles.size > 0) {
                if (!selectedTitles.has(d.title)) return false;
            }
            // Exclure les titres exclus
            if (excludedTitles.size > 0 && excludedTitles.has(d.title)) return false;
            
            const gs = parseArrayField(d.genres);
            const ps = parseArrayField(d.production_companies);

            // Exclure les genres exclus
            if (excludedGenres.size > 0) {
                if (gs.some(x => excludedGenres.has(x))) return false;
            }
            
            // Exclure les productions exclues
            if (excludedCompanies.size > 0) {
                if (ps.some(x => excludedCompanies.has(x))) return false;
            }

            if (selectedGenres.size) {
                if (strictGenre) {
                    if (!gs.length) return false;
                    // Tous les genres sélectionnés doivent être présents dans le film (ET logique)
                    const requireAllSelected = Array.from(selectedGenres).every(x => gs.includes(x));
                    if (!requireAllSelected) return false;
                } else {
                    // Au moins un des genres sélectionnés est présent (OU logique)
                    if (!gs.some(x => selectedGenres.has(x))) return false;
                }
            }
            if (selectedCompanies.size) {
                if (strictProd) {
                    if (!ps.length) return false;
                    // Toutes les sociétés sélectionnées doivent être présentes dans le film (ET logique)
                    const requireAllSelectedP = Array.from(selectedCompanies).every(x => ps.includes(x));
                    if (!requireAllSelectedP) return false;
                } else {
                    // Au moins une des sociétés sélectionnées est présente (OU logique)
                    if (!ps.some(x => selectedCompanies.has(x))) return false;
                }
            }

            // Appliquer aussi les filtres numériques de l'overlay table au graphe
            if (numericTableFilters.popularity) {
                const f = numericTableFilters.popularity;
                const v = d.popularity;
                if (!isFinite(v)) return false;
                if (f.op === 'gte' && !(v >= f.v1)) return false;
                if (f.op === 'lte' && !(v <= f.v1)) return false;
                if (f.op === 'between' && !(v >= f.v1 && v <= f.v2)) return false;
            }
            if (numericTableFilters.budget) {
                const f = numericTableFilters.budget;
                const v = d.budget;
                if (!isFinite(v)) return false;
                if (f.op === 'gte' && !(v >= f.v1)) return false;
                if (f.op === 'lte' && !(v <= f.v1)) return false;
                if (f.op === 'between' && !(v >= f.v1 && v <= f.v2)) return false;
            }
            if (numericTableFilters.revenue) {
                const f = numericTableFilters.revenue;
                const v = d.revenue;
                if (!isFinite(v)) return false;
                if (f.op === 'gte' && !(v >= f.v1)) return false;
                if (f.op === 'lte' && !(v <= f.v1)) return false;
                if (f.op === 'between' && !(v >= f.v1 && v <= f.v2)) return false;
            }
            return true;
        });
    
    // Note: Le filtre Top 10/Top 100 est maintenant appliqué par groupe dans buildHierarchy
    // On ne filtre plus globalement ici
    
    // Synchroniser les filtres de tableau avec les sélections principales
    tableFilters.title = new Set(selectedTitles);
    tableFilters.year = selectedYears;
    tableFilters.note = selectedNotes;
    tableFilters.genres = new Set(selectedGenres);
    tableFilters.productions = new Set(selectedCompanies);
    
    // Mettre à jour les KPI
    updateFilterKPI();
}

// Populate filters from data
function populateFilters() {
    // Initialisation des listes de filtres
    const genreList = document.getElementById('genreList');
    const prodList = document.getElementById('prodList');
    
    
    
    if (!genreList || !prodList) return;

    const genreFreq = new Map();
    const prodFreq = new Map();

    for (const d of moviesData) {
        for (const g of parseArrayField(d.genres)) {
            genreFreq.set(g, (genreFreq.get(g) || 0) + 1);
        }
        for (const p of parseArrayField(d.production_companies)) {
            prodFreq.set(p, (prodFreq.get(p) || 0) + 1);
        }
        // Collect titles (simple frequency not needed for now)
    }

    genreOptions = Array.from(genreFreq, ([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .map(o => o.name);
    
    // Stocker TOUTES les productions pour la recherche
    allProdOptions = Array.from(prodFreq, ([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .map(o => o.name);
    
    // Pour l'affichage initial, prioriser celles qui sont disponibles dans les données filtrées
    const availableProds = getAvailableItems('prod');
    const allProdsWithFreq = Array.from(prodFreq, ([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);
    
    // Séparer en disponibles et non disponibles
    const availableProdsWithFreq = allProdsWithFreq.filter(p => availableProds.has(p.name));
    const unavailableProdsWithFreq = allProdsWithFreq.filter(p => !availableProds.has(p.name));
    
    // Combiner: disponibles d'abord, puis les autres, limiter à 200 pour l'affichage initial
    prodOptions = [...availableProdsWithFreq, ...unavailableProdsWithFreq]
        .slice(0, 200)
        .map(o => o.name);

    renderMultiList('genreList', genreOptions, selectedGenres, 'genre');
    renderMultiList('prodList', prodOptions, selectedCompanies, 'prod', allProdOptions);
    // Film options: initialisés pour overlay uniquement
    if (filmOptions.length === 0) {
        filmOptions = moviesData.map(d => d.title).filter(t => !!t).sort((a,b)=>a.localeCompare(b,'fr'));
    }
    
    // Year options: toutes les années disponibles triées par ordre décroissant
    const yearSet = new Set();
    moviesData.forEach(d => {
        if (d.year) yearSet.add(String(d.year));
    });
    yearOptions = Array.from(yearSet).sort((a, b) => parseFloat(b) - parseFloat(a));
    // Années chargées
    
    // Note options: toutes les notes disponibles triées par ordre décroissant
    const noteSet = new Set();
    moviesData.forEach(d => {
        if (d.vote_average) noteSet.add(d.vote_average.toFixed(1));
    });
    noteOptions = Array.from(noteSet).sort((a, b) => parseFloat(b) - parseFloat(a));
    // Notes chargées
    
    // Setup search listeners
    setupSearchListeners();
}

// Setup dynamic search for filters
function setupSearchListeners() {
    const genreSearch = document.getElementById('genreSearch');
    const prodSearch = document.getElementById('prodSearch');
    const filmSearch = document.getElementById('filmSearch');
    const genreSearchClear = document.getElementById('genreSearchClear');
    const prodSearchClear = document.getElementById('prodSearchClear');
    const filmSearchClear = document.getElementById('filmSearchClear');

    if (genreSearch) {
        genreSearch.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase().trim();
            filterListItems('genreList', query);
            // Show/hide clear button
            if (genreSearchClear) {
                genreSearchClear.classList.toggle('visible', e.target.value.length > 0);
            }
        });
    }

    if (prodSearch) {
        prodSearch.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase().trim();
            filterListItems('prodList', query);
            // Show/hide clear button
            if (prodSearchClear) {
                prodSearchClear.classList.toggle('visible', e.target.value.length > 0);
            }
        });
    }

    if (filmSearch) {
        filmSearch.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase().trim();
            filterListItems('filmList', query);
            if (filmSearchClear) {
                filmSearchClear.classList.toggle('visible', e.target.value.length > 0);
            }
        });
    }

    if (genreSearchClear) {
        genreSearchClear.addEventListener('click', () => {
            if (genreSearch) {
                genreSearch.value = '';
                filterListItems('genreList', '');
                genreSearchClear.classList.remove('visible');
                genreSearch.focus();
            }
        });
    }

    if (prodSearchClear) {
        prodSearchClear.addEventListener('click', () => {
            if (prodSearch) {
                prodSearch.value = '';
                filterListItems('prodList', '');
                prodSearchClear.classList.remove('visible');
                prodSearch.focus();
            }
        });
    }

    if (filmSearchClear) {
        filmSearchClear.addEventListener('click', () => {
            if (filmSearch) {
                filmSearch.value = '';
                filterListItems('filmList', '');
                filmSearchClear.classList.remove('visible');
                filmSearch.focus();
            }
        });
    }
    
    // Year search
    const yearSearch = document.getElementById('yearSearch');
    const yearSearchClear = document.getElementById('yearSearchClear');
    if (yearSearch) {
        yearSearch.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase().trim();
            filterListItems('yearList', query);
            if (yearSearchClear) {
                yearSearchClear.classList.toggle('visible', e.target.value.length > 0);
            }
        });
    }
    if (yearSearchClear) {
        yearSearchClear.addEventListener('click', () => {
            if (yearSearch) {
                yearSearch.value = '';
                filterListItems('yearList', '');
                yearSearchClear.classList.remove('visible');
                yearSearch.focus();
            }
        });
    }
    
    // Note search
    const noteSearch = document.getElementById('noteSearch');
    const noteSearchClear = document.getElementById('noteSearchClear');
    if (noteSearch) {
        noteSearch.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase().trim();
            filterListItems('noteList', query);
            if (noteSearchClear) {
                noteSearchClear.classList.toggle('visible', e.target.value.length > 0);
            }
        });
    }
    if (noteSearchClear) {
        noteSearchClear.addEventListener('click', () => {
            if (noteSearch) {
                noteSearch.value = '';
                filterListItems('noteList', '');
                noteSearchClear.classList.remove('visible');
                noteSearch.focus();
            }
        });
    }
}

// Filter list items based on search query
function filterListItems(containerId, query) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Si une recherche est active et qu'on a une liste complète stockée, recréer la liste
    if (query && container.dataset.allItems) {
        try {
            const allItems = JSON.parse(container.dataset.allItems);
            const filteredItems = allItems.filter(item => 
                item.toLowerCase().includes(query.toLowerCase())
            );
            
            // Identifier le type de liste pour appeler renderMultiList avec les bons paramètres
            let kind = '';
            let selectedSet = null;
            let displayItems = filteredItems;
            let searchableItems = allItems;
            
            if (containerId === 'genreList') {
                kind = 'genre';
                selectedSet = selectedGenres;
                displayItems = filteredItems;
            } else if (containerId === 'prodList') {
                kind = 'prod';
                selectedSet = selectedCompanies;
                displayItems = filteredItems;
                searchableItems = allProdOptions;
            } else if (containerId === 'filmList') {
                kind = 'film';
                selectedSet = selectedTitles;
                displayItems = filteredItems;
            } else if (containerId === 'yearList') {
                kind = 'year';
                selectedSet = selectedYears;
                displayItems = filteredItems;
            } else if (containerId === 'noteList') {
                kind = 'note';
                selectedSet = selectedNotes;
                displayItems = filteredItems;
            }
            
            if (kind && selectedSet) {
                renderMultiList(containerId, displayItems, selectedSet, kind, searchableItems);
                return;
            }
        } catch (e) {
            console.error('Error parsing allItems:', e);
        }
    }
    
    // Sinon, comportement par défaut : filtrer les éléments visibles
    const items = container.querySelectorAll('.multi-item');
    let visibleCount = 0;

    items.forEach(item => {
        const text = item.textContent.toLowerCase();
        if (!query || text.includes(query)) {
            item.style.display = '';
            visibleCount++;
        } else {
            item.style.display = 'none';
        }
    });

    // If no results, show a message
    const noResults = container.querySelector('.no-results');
    if (visibleCount === 0 && !noResults) {
        const msg = document.createElement('div');
        msg.className = 'no-results';
        msg.textContent = 'Aucun résultat';
        msg.style.cssText = 'padding: 12px; text-align: center; color: #999; font-style: italic;';
        container.appendChild(msg);
    } else if (visibleCount > 0 && noResults) {
        noResults.remove();
    }
}

// Render bubble size legend based on quantiles
function renderSizeLegend() {
    const container = document.getElementById('sizeLegend');
    if (!container) return;
    container.innerHTML = '';

    const vals = [];
    for (const d of filteredData) {
        const v = currentSizeMode === 'budget' ? +d.budget : +d.popularity;
        if (isFinite(v) && v > 0) vals.push(v);
    }
    if (!vals.length) { container.textContent = 'Aucune donnée'; return; }
    vals.sort((a, b) => a - b);
    const q = p => vals[Math.max(0, Math.min(vals.length - 1, Math.floor(p * (vals.length - 1))))];
    const vSmall = q(0.2), vMid = q(0.5), vLarge = q(0.9);

    const width = 260, height = 70;
    const svg = d3.select(container).append('svg')
        .attr('width', width)
        .attr('height', height);

    const values = [vSmall, vMid, vLarge];
    const labels = values.map(v => currentSizeMode === 'budget' ? `$${(v / 1e6).toFixed(0)}M` : Math.round(v));
    const r = d3.scaleSqrt().domain([values[0], values[2]]).range([8, 22]);
    const x = d3.scalePoint().domain([0,1,2]).range([40, width - 40]);

    svg.selectAll('circle')
        .data(values)
        .enter()
        .append('circle')
        .attr('cx', (_, i) => x(i))
        .attr('cy', height/2)
        .attr('r', d => r(d))
        .attr('fill', '#e9e9ff')
        .attr('stroke', '#bdbdff');

    svg.selectAll('text')
        .data(labels)
        .enter()
        .append('text')
        .attr('x', (_, i) => x(i))
        .attr('y', height/2 + 28)
        .attr('text-anchor', 'middle')
        .attr('fill', '#555')
        .style('font-size', '12px')
        .text(d => d);
}