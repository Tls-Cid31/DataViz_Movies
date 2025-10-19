// Charger le CSV avec D3
d3.csv("movie_dataset_transform.csv").then(function(data) {

    // Convertir les valeurs numériques et les listes
    data.forEach(d => {
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
    });
  
    // Afficher un aperçu dans la console
    console.log("Données importées :", data);
  
    // Exemple d’affichage sur la page
    d3.select("#chart")
      .append("p")
      .text(`Nombre de films importés : ${data.length}`);
  
  });
  