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
let currentFocus = null;   // focus du zoom (node group)
let currentTableData = []; // données actuelles du tableau
let baseTableData = []; // données de base avant filtres de table
let tableFilters = {
    title: new Set(),
    year: new Set(),
    note: new Set(),
    genres: new Set(),
    productions: new Set()
};
let activeTableFilters = new Set(); // colonnes avec filtre actif visible
let tableSortColumn = 'year'; // colonne de tri actuelle (tri par défaut sur l'année)
let tableSortOrder = 'desc'; // 'asc' ou 'desc' (années récentes en premier)
let currentPage = 1;       // page actuelle de la pagination
let selectedGenres = new Set();
let selectedCompanies = new Set();
let selectedTitles = new Set(); // Titres sélectionnés depuis le tableau
let excludedGenres = new Set(); // Genres exclus (clic droit)
let excludedCompanies = new Set(); // Productions exclues (clic droit)
let excludedTitles = new Set(); // Films exclus (clic droit dans le filtre films)
let genreOptions = [];
let prodOptions = [];
let filmOptions = []; // Liste des titres pour le filtre films
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
                    console.log('✅ D3.js chargé après attente, version:', d3.version);
                    init();
                } else {
                    showError('Erreur: Bibliothèque D3.js non chargée');
                }
            }, 500);
            return;
        }
        console.log('✅ D3.js version:', d3.version);
        
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
      // Multiplier par 100 pour donner plus de poids aux notes (0-10 -> 0-1000)
      sizeValue = (+d.vote_average) * 100;
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
    let groups = Array.from(groupMap, ([name, films]) => ({
        name,
        films: films
            .filter(f => isFinite(f.value) && f.value > 0)
            .sort((a, b) => b.value - a.value)
            .slice(0, config.maxFilmsPerGroup)
    }));

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

    if (yearFilterMin) {
        yearFilterMin.addEventListener('input', (e) => {
            updateRangeFill();
            applySelectionsToUI(); // Update filter states in real-time
        });
        yearFilterMin.addEventListener('change', () => {
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
        updateVisualization();
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
                strictGenre,
                strictProd
            });
            const prev = filterHistory.pop();
            selectedGenres = new Set(prev.genres);
            selectedCompanies = new Set(prev.companies);
            selectedTitles = new Set(prev.titles || []);
            strictGenre = !!prev.strictGenre;
            strictProd = !!prev.strictProd;
            if (strictGenreCheckbox) strictGenreCheckbox.checked = strictGenre;
            if (strictProdCheckbox) strictProdCheckbox.checked = strictProd;
            applySelectionsToUI();
            updateFilteredData();
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
                strictGenre,
                strictProd
            });
            const next = redoHistory.pop();
            selectedGenres = new Set(next.genres);
            selectedCompanies = new Set(next.companies);
            selectedTitles = new Set(next.titles || []);
            strictGenre = !!next.strictGenre;
            strictProd = !!next.strictProd;
            if (strictGenreCheckbox) strictGenreCheckbox.checked = strictGenre;
            if (strictProdCheckbox) strictProdCheckbox.checked = strictProd;
            applySelectionsToUI();
            updateFilteredData();
            updateVisualization();
        });
    }
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            pushFiltersHistory();
            selectedGenres.clear();
            selectedCompanies.clear();
            selectedTitles.clear();
            excludedGenres.clear();
            excludedCompanies.clear();
            excludedTitles.clear();
            strictGenre = false;
            strictProd = false;
            if (strictGenreCheckbox) strictGenreCheckbox.checked = false;
            if (strictProdCheckbox) strictProdCheckbox.checked = false;
            applySelectionsToUI();
            updateFilteredData();
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
        year: new Set(),
        note: new Set(),
        genres: new Set(),
        productions: new Set()
    };
    applyTableFilters();
}

function applyTableFilters() {
    // Ne plus synchroniser les titres avec le graphique
    
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
        return true;
    });
    currentPage = 1;
    
    // Ne plus mettre à jour le graphique depuis les filtres du tableau
    
    if (!currentTableData.length) {
        const container = d3.select('#dataTable');
        container.html('<p class="loading">Aucune donnée à afficher</p>');
        return;
    }

    renderTable(); // Don't preserve scroll, just re-render normally
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
        { label: 'Popularité', filterKey: null, sortKey: 'popularity' },
        { label: 'Note', filterKey: 'note', sortKey: 'note' },
        { label: 'Budget', filterKey: null, sortKey: 'budget' },
        { label: 'Revenus', filterKey: null, sortKey: 'revenue' },
        { label: 'Année', filterKey: 'year', sortKey: 'year' },
        { label: 'Genres', filterKey: 'genres', sortKey: 'genres' },
        { label: 'Productions', filterKey: 'productions', sortKey: 'productions' }
    ];
    
    headerRow.selectAll('th')
        .data(headerData)
        .enter()
        .append('th')
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
                const hasFilter = tableFilters[d.filterKey].size > 0;
                
                const filterIcon = iconsContainer.append('span')
                    .attr('class', hasFilter ? 'filter-icon has-filter' : 'filter-icon')
                    .attr('title', 'Filtrer')
                    .on('click', function(event) {
                        event.stopPropagation();
                        activeTableFilters.clear(); // Fermer les autres overlays
                        activeTableFilters.add(d.filterKey);
                        renderTable();
                    });
                
                filterIcon.append('span').text('🔍');
                
                if (hasFilter) {
                    filterIcon.append('span')
                        .attr('class', 'filter-badge')
                        .text(tableFilters[d.filterKey].size);
                }
            }
            
            if (d.filterKey && isFilterActive) {
                // Déterminer si l'overlay doit s'ouvrir vers le haut (1 ligne) ou vers le bas
                const shouldOpenUpward = currentTableData.length <= config.itemsPerPage && currentTableData.length <= 1;
                
                // Show filter panel overlay
                const filterPanel = th.append('div')
                    .attr('class', 'filter-panel-overlay')
                    .style('position', 'absolute')
                    .style(shouldOpenUpward ? 'bottom' : 'top', '100%')
                    .style('left', '0')
                    .style('min-width', '250px')
                    .style('max-width', '400px')
                    .style('background', 'white')
                    .style('border', '2px solid #667eea')
                    .style('border-radius', '8px')
                    .style('box-shadow', '0 4px 12px rgba(0,0,0,0.15)')
                    .style('z-index', '1000')
                    .style(shouldOpenUpward ? 'margin-bottom' : 'margin-top', '4px')
                    .style('padding', '12px')
                    .on('click', function(event) {
                        event.stopPropagation(); // Empêcher la fermeture au clic dans l'overlay
                    });
                
                // Header with close button
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
                
                // Close button
                panelHeader.append('span')
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
                
                // Search input
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
                    }
                    
                    // Séparer par état: sélectionné, exclu, disponible, indisponible
                    const selected = filtered.filter(v => selectedSet.has(v));
                    const excluded = filtered.filter(v => !selectedSet.has(v) && excludedSet.has(v));
                    const available = filtered.filter(v => !selectedSet.has(v) && !excludedSet.has(v) && (availableItems.size === 0 || availableItems.has(v)));
                    const unavailable = filtered.filter(v => !selectedSet.has(v) && !excludedSet.has(v) && availableItems.size > 0 && !availableItems.has(v));
                    
                    // Ordonner: sélectionné, disponible, indisponible, exclu
                    const ordered = [...selected, ...available, ...unavailable, ...excluded];
                    
                    ordered.slice(0, 100).forEach(value => {
                        const isSelected = selectedSet.has(value);
                        const isExcluded = excludedSet.has(value);
                        const isUnavailable = !isSelected && !isExcluded && availableItems.size > 0 && !availableItems.has(value);
                        let bgColor = 'white';
                        let textColor = '#333';
                        let opacity = 1;
                        
                        if (isSelected) {
                            bgColor = '#d4edda';
                            textColor = '#155724';
                        } else if (isExcluded) {
                            bgColor = '#f8d7da';
                            textColor = '#721c24';
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
                                if (tableFilters[d.filterKey].has(value)) {
                                    tableFilters[d.filterKey].delete(value);
                                } else {
                                    tableFilters[d.filterKey].add(value);
                                }
                                // Synchroniser avec les filtres principaux
                                if (d.filterKey === 'genres') {
                                    if (tableFilters.genres.has(value)) selectedGenres.add(value); else selectedGenres.delete(value);
                                } else if (d.filterKey === 'productions') {
                                    if (tableFilters.productions.has(value)) selectedCompanies.add(value); else selectedCompanies.delete(value);
                                } else if (d.filterKey === 'title') {
                                    if (tableFilters.title.has(value)) selectedTitles.add(value); else selectedTitles.delete(value);
                                }
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
                                
                                // Update the filter badge in the header
                                const currentHeader = d3.select(`#dataTable thead th:nth-child(${headerData.findIndex(h => h.filterKey === d.filterKey) + 1})`);
                                const filterIcon = currentHeader.select('.filter-icon');
                                
                                // Update has-filter class
                                const hasFilter = tableFilters[d.filterKey].size > 0;
                                filterIcon.classed('has-filter', hasFilter);
                                
                                // Update or remove badge
                                filterIcon.select('.filter-badge').remove();
                                if (hasFilter) {
                                    filterIcon.append('span')
                                        .attr('class', 'filter-badge')
                                        .text(tableFilters[d.filterKey].size);
                                }
                                
                                // Update table body without full re-render to preserve overlay
                                updateTableBody();
                                // Mettre à jour la visualisation si genres/productions/titres changent
                                if (d.filterKey === 'genres' || d.filterKey === 'productions' || d.filterKey === 'title') {
                                    updateFilteredData();
                                    updateVisualization();
                                    applySelectionsToUI();
                                }
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
        strictGenre,
        strictProd
    });
    // Clear redo history when a new action is performed
    redoHistory = [];
}

function applySelectionsToUI() {
    renderMultiList('genreList', genreOptions, selectedGenres, 'genre');
    renderMultiList('prodList', prodOptions, selectedCompanies, 'prod');
    if (filmOptions && filmOptions.length) {
        renderMultiList('filmList', filmOptions, selectedTitles, 'film');
    }
    // Re-apply search filters after rendering
    reapplySearchFilters();
}

// Re-apply active search filters
function reapplySearchFilters() {
    const genreSearch = document.getElementById('genreSearch');
    const prodSearch = document.getElementById('prodSearch');
    const filmSearch = document.getElementById('filmSearch');
    
    if (genreSearch && genreSearch.value) {
        filterListItems('genreList', genreSearch.value.toLowerCase().trim());
    }
    if (prodSearch && prodSearch.value) {
        filterListItems('prodList', prodSearch.value.toLowerCase().trim());
    }
    if (filmSearch && filmSearch.value) {
        filterListItems('filmList', filmSearch.value.toLowerCase().trim());
    }
}

// Render a custom multi-select list with left click add, right click remove
function renderMultiList(containerId, allItems, selectedSet, kind) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';

    // Déterminer quel Set d'exclusion utiliser
    let excludedSet;
    if (kind === 'genre') excludedSet = excludedGenres;
    else if (kind === 'prod') excludedSet = excludedCompanies;
    else if (kind === 'film') excludedSet = excludedTitles;
    else excludedSet = new Set();

    // Calculate available items based on current filters
    const availableItems = getAvailableItems(kind);

    // Separate items into four categories
    const selected = allItems.filter(x => selectedSet.has(x)).sort((a,b) => a.localeCompare(b, 'fr'));
    const excluded = allItems.filter(x => excludedSet.has(x)).sort((a,b) => a.localeCompare(b, 'fr'));
    const available = allItems.filter(x => !selectedSet.has(x) && !excludedSet.has(x) && availableItems.has(x)).sort((a,b) => a.localeCompare(b, 'fr'));
    const unavailable = allItems.filter(x => !selectedSet.has(x) && !excludedSet.has(x) && !availableItems.has(x)).sort((a,b) => a.localeCompare(b, 'fr'));
    
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
        const isSelected = selectedSet.has(name);
        const isExcluded = excludedSet.has(name);
        const isUnavailable = !isSelected && !isExcluded && !availableItems.has(name);
        
        div.className = 'multi-item';
        if (isSelected) {
            div.className += ' selected';
        } else if (isExcluded) {
            div.className += ' excluded';
        } else if (isUnavailable) {
            div.className += ' unavailable';
        }
        
        div.textContent = name;
        
        // Prevent text selection during drag
        div.addEventListener('selectstart', (e) => e.preventDefault());
        
        // Mouse down: prepare for drag or click
        div.addEventListener('mousedown', (e) => {
            if (e.button === 0) { // Left click
                e.preventDefault();
                isDragging = true;
                dragStartItem = name;
                hasMoved = false;
                
                // Determine mode and apply to start item immediately
                if (isExcluded) {
                    // Si exclu, on l'inclut (devient sélectionné)
                    dragMode = 'add';
                    pushFiltersHistory();
                    excludedSet.delete(name);
                    selectedSet.add(name);
                    hasChanges = true;
                    applySelectionsToUI();
                } else if (!isUnavailable && !selectedSet.has(name)) {
                    // Si normal et disponible, on le sélectionne
                    dragMode = 'add';
                    pushFiltersHistory();
                    selectedSet.add(name);
                    excludedSet.delete(name);
                    hasChanges = true;
                    applySelectionsToUI();
                } else if (selectedSet.has(name)) {
                    // Si déjà sélectionné, on le désélectionne
                    dragMode = 'remove';
                    pushFiltersHistory();
                    selectedSet.delete(name);
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
                if (!availableItems.has(name) || selectedSet.has(name) || excludedSet.has(name)) return;
                selectedSet.add(name);
                excludedSet.delete(name);
                hasChanges = true;
                applySelectionsToUI();
            } else if (dragMode === 'remove') {
                if (!selectedSet.has(name)) return;
                selectedSet.delete(name);
                hasChanges = true;
                applySelectionsToUI();
            }
        });

        // Right click: exclure/inclure (maintenant aussi pour films)
        div.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            pushFiltersHistory();
            if (excludedSet.has(name)) {
                excludedSet.delete(name);
            } else {
                excludedSet.add(name);
                selectedSet.delete(name);
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
        } else { // productions
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
            return true;
        });
    // Synchroniser les filtres de tableau avec les sélections principales
    tableFilters.title = new Set(selectedTitles);
    tableFilters.genres = new Set(selectedGenres);
    tableFilters.productions = new Set(selectedCompanies);
}

// Populate filters from data
function populateFilters() {
    const genreList = document.getElementById('genreList');
    const prodList = document.getElementById('prodList');
    const filmList = document.getElementById('filmList');
    if (!genreList || !prodList || !filmList) return;

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
    prodOptions = Array.from(prodFreq, ([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 200)
        .map(o => o.name);

    renderMultiList('genreList', genreOptions, selectedGenres, 'genre');
    renderMultiList('prodList', prodOptions, selectedCompanies, 'prod');
    // Film options: tous les titres triés (peut être lourd, optimisation future possible)
    if (filmOptions.length === 0) {
        filmOptions = moviesData.map(d => d.title).filter(t => !!t).sort((a,b)=>a.localeCompare(b,'fr'));
    }
    renderMultiList('filmList', filmOptions, selectedTitles, 'film');

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
}

// Filter list items based on search query
function filterListItems(containerId, query) {
    const container = document.getElementById(containerId);
    if (!container) return;

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