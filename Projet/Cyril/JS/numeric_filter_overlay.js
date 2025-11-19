// CODE À REMPLACER DANS script.js

// 1. Ligne ~1005 - Modifier headerData pour ajouter filterKey à popularité, budget, revenus:
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

// 2. Ligne ~1180 - Remplacer toute la section de filtres numériques par ce code:

                // Get unique values for this column
                const uniqueValues = getUniqueValuesForColumn(d.filterKey);
                
                // Pour les filtres numériques, afficher interface avec opérateurs
                const isNumericFilter = ['year', 'note', 'budget', 'revenue', 'popularity'].includes(d.filterKey);
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
                    
                    if (hasExactOption) {
                        operators.push({ value: 'exact', label: '= Exacte', symbol: '=' });
                    }
                    
                    // Conteneur pour les champs de saisie (caché initialement)
                    const inputContainer = filterPanel.append('div')
                        .style('display', 'none')
                        .style('max-height', '200px')
                        .style('overflow-y', 'auto')
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
                                inputContainer.style('display', 'block');
                                inputContainer.html('');
                                
                                const minVal = Math.min(...uniqueValues.map(v => parseFloat(v)));
                                const maxVal = Math.max(...uniqueValues.map(v => parseFloat(v)));
                                
                                // Déterminer le step en fonction du type
                                let step = 1;
                                if (d.filterKey === 'note') {
                                    step = 0.1;
                                } else if (d.filterKey === 'budget' || d.filterKey === 'revenue') {
                                    step = 1000000; // 1M
                                } else if (d.filterKey === 'popularity') {
                                    step = 1;
                                }
                                
                                if (op.value === 'exact') {
                                    // Un champ pour valeur exacte
                                    const input = inputContainer.append('input')
                                        .attr('type', 'number')
                                        .attr('placeholder', 'Valeur exacte')
                                        .attr('min', minVal)
                                        .attr('max', maxVal)
                                        .attr('step', step)
                                        .style('width', '100%')
                                        .style('padding', '6px 10px')
                                        .style('border', '1px solid #ddd')
                                        .style('border-radius', '4px')
                                        .style('font-size', '13px')
                                        .style('box-sizing', 'border-box');
                                    
                                    const applyBtn = inputContainer.append('button')
                                        .attr('type', 'button')
                                        .text('Appliquer')
                                        .style('width', '100%')
                                        .style('margin-top', '8px')
                                        .style('padding', '8px')
                                        .style('background', '#28a745')
                                        .style('color', 'white')
                                        .style('border', 'none')
                                        .style('border-radius', '4px')
                                        .style('cursor', 'pointer')
                                        .style('font-weight', 'bold')
                                        .on('click', function() {
                                            const val = parseFloat(input.node().value);
                                            if (!isNaN(val)) {
                                                pushFiltersHistory();
                                                
                                                const selectedSet = d.filterKey === 'year' ? selectedYears : selectedNotes;
                                                const tableFilterSet = tableFilters[d.filterKey];
                                                
                                                selectedSet.clear();
                                                tableFilterSet.clear();
                                                
                                                // Trouver la valeur exacte dans uniqueValues
                                                uniqueValues.forEach(v => {
                                                    const numVal = parseFloat(v);
                                                    if (Math.abs(numVal - val) < 0.01) {
                                                        selectedSet.add(v);
                                                        tableFilterSet.add(v);
                                                    }
                                                });
                                                
                                                updateFilteredData();
                                                activeTableFilters.delete(d.filterKey);
                                                renderTable();
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
                                        .attr('placeholder', 'Min')
                                        .attr('min', minVal)
                                        .attr('max', maxVal)
                                        .attr('step', step)
                                        .style('flex', '1')
                                        .style('padding', '6px 10px')
                                        .style('border', '1px solid #ddd')
                                        .style('border-radius', '4px')
                                        .style('font-size', '13px')
                                        .style('box-sizing', 'border-box');
                                    
                                    inputGroup.append('span').text('à').style('color', '#666');
                                    
                                    const input2 = inputGroup.append('input')
                                        .attr('type', 'number')
                                        .attr('placeholder', 'Max')
                                        .attr('min', minVal)
                                        .attr('max', maxVal)
                                        .attr('step', step)
                                        .style('flex', '1')
                                        .style('padding', '6px 10px')
                                        .style('border', '1px solid #ddd')
                                        .style('border-radius', '4px')
                                        .style('font-size', '13px')
                                        .style('box-sizing', 'border-box');
                                    
                                    const applyBtn = inputContainer.append('button')
                                        .attr('type', 'button')
                                        .text('Appliquer')
                                        .style('width', '100%')
                                        .style('margin-top', '8px')
                                        .style('padding', '8px')
                                        .style('background', '#28a745')
                                        .style('color', 'white')
                                        .style('border', 'none')
                                        .style('border-radius', '4px')
                                        .style('cursor', 'pointer')
                                        .style('font-weight', 'bold')
                                        .on('click', function() {
                                            const val1 = parseFloat(input1.node().value);
                                            const val2 = parseFloat(input2.node().value);
                                            if (!isNaN(val1) && !isNaN(val2)) {
                                                pushFiltersHistory();
                                                
                                                // Filtrer les valeurs dans la plage
                                                if (d.filterKey === 'year' || d.filterKey === 'note') {
                                                    const selectedSet = d.filterKey === 'year' ? selectedYears : selectedNotes;
                                                    const tableFilterSet = tableFilters[d.filterKey];
                                                    
                                                    selectedSet.clear();
                                                    tableFilterSet.clear();
                                                    
                                                    uniqueValues.forEach(v => {
                                                        const numVal = parseFloat(v);
                                                        if (numVal >= Math.min(val1, val2) && numVal <= Math.max(val1, val2)) {
                                                            selectedSet.add(v);
                                                            tableFilterSet.add(v);
                                                        }
                                                    });
                                                } else {
                                                    // Pour budget, revenue, popularity - filtrer directement les données
                                                    currentTableData = baseTableData.filter(film => {
                                                        let filmValue;
                                                        if (d.filterKey === 'budget') filmValue = film.budget;
                                                        else if (d.filterKey === 'revenue') filmValue = film.revenue;
                                                        else if (d.filterKey === 'popularity') filmValue = film.popularity;
                                                        
                                                        if (filmValue === undefined || filmValue === null) return false;
                                                        return filmValue >= Math.min(val1, val2) && filmValue <= Math.max(val1, val2);
                                                    });
                                                }
                                                
                                                updateFilteredData();
                                                activeTableFilters.delete(d.filterKey);
                                                renderTable();
                                            }
                                        });
                                } else {
                                    // Un seul champ pour >= ou <=
                                    const input = inputContainer.append('input')
                                        .attr('type', 'number')
                                        .attr('placeholder', 'Valeur')
                                        .attr('min', minVal)
                                        .attr('max', maxVal)
                                        .attr('step', step)
                                        .style('width', '100%')
                                        .style('padding', '6px 10px')
                                        .style('border', '1px solid #ddd')
                                        .style('border-radius', '4px')
                                        .style('font-size', '13px')
                                        .style('box-sizing', 'border-box');
                                    
                                    const applyBtn = inputContainer.append('button')
                                        .attr('type', 'button')
                                        .text('Appliquer')
                                        .style('width', '100%')
                                        .style('margin-top', '8px')
                                        .style('padding', '8px')
                                        .style('background', '#28a745')
                                        .style('color', 'white')
                                        .style('border', 'none')
                                        .style('border-radius', '4px')
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
                                                        if (op.value === 'gte' && numVal >= val) {
                                                            selectedSet.add(v);
                                                            tableFilterSet.add(v);
                                                        } else if (op.value === 'lte' && numVal <= val) {
                                                            selectedSet.add(v);
                                                            tableFilterSet.add(v);
                                                        }
                                                    });
                                                } else {
                                                    // Pour budget, revenue, popularity - filtrer directement les données
                                                    currentTableData = baseTableData.filter(film => {
                                                        let filmValue;
                                                        if (d.filterKey === 'budget') filmValue = film.budget;
                                                        else if (d.filterKey === 'revenue') filmValue = film.revenue;
                                                        else if (d.filterKey === 'popularity') filmValue = film.popularity;
                                                        
                                                        if (filmValue === undefined || filmValue === null) return false;
                                                        if (op.value === 'gte') return filmValue >= val;
                                                        if (op.value === 'lte') return filmValue <= val;
                                                        return false;
                                                    });
                                                }
                                                
                                                updateFilteredData();
                                                activeTableFilters.delete(d.filterKey);
                                                renderTable();
                                            }
                                        });
                                }
                            });
                    });
                    
                    return; // Ne pas afficher la liste de valeurs pour les filtres numériques
                }
