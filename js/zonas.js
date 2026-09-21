// Departamentos de la provincia de Córdoba y sus localidades.
// Fuente: INDEC / Georef (datos abiertos del Estado argentino).
// Se usa en publicar.html para que la zona se elija de una lista en vez de escribirla.
const ZONAS_CORDOBA = {
    "Calamuchita": ["Amboy", "Arroyo San Antonio", "Calmayo", "Cañada del Sauce", "Capilla Vieja", "El Corcovado - El Torreón", "El Durazno", "Embalse", "La Cruz", "La Cumbrecita", "Las Bajadas", "Las Caleras", "Los Cóndores", "Los Molinos", "Los Reartes", "Lutti", "Parque Calmayo", "Río de los Sauces", "San Agustín", "San Ignacio", "San Ignacio (Loteo San Javier)", "Santa Rosa de Calamuchita", "Segunda Usina", "Solar de los Molinos", "Villa Alpina", "Villa Amancay", "Villa Berna", "Villa Ciudad Parque los Reartes", "Villa Ciudad Parque Los Reartes (1a. Sección)", "Villa del Dique", "Villa El Tala", "Villa General Belgrano", "Villa La Rivera", "Villa Quillinzo", "Villa Rumipal", "Villa Yacanto"],
    "Capital": ["Córdoba"],
    "Colón": ["Agua de Oro", "Ascochinga", "Barrio Nuevo Río Ceballos", "Canteras El Sauce", "Casa Bamba", "Colonia Caroya", "Colonia Tirolesa", "Colonia Vicente Agüero", "Corral Quemado", "Country San Isidro - Country Chacras de la Villa", "El Manzano", "Estación Colonia Tirolesa", "Estación General Paz", "Estación Juárez Celman", "General Paz", "Jesús María", "La Calera", "La Granja", "La Morada", "La Puerta", "Las Corzuelas", "Los Molles", "Malvinas Argentinas", "Mendiolaza", "Mi Granja", "Pajas Blancas", "Parque Norte - Ciudad de los Niños - Villa Pastora - Almirante Brown - Guiñazú N", "Río Ceballos", "Saldán", "Salsipuedes", "Santa Elena", "Tinoco", "Unquillo", "Villa Allende", "Villa Cerro Azul", "Villa Corazón de María", "Villa Los Llanos - Juárez Celman"],
    "Cruz del Eje": ["Alto de los Quebrachos", "Bañado de Soto", "Canteras Quilpo", "Cruz de Caña", "Cruz del Eje", "El Brete", "El Rincón", "Guanaco Muerto", "La Banda", "La Batea", "La Higuera", "Las Cañadas", "Las Playas", "Los Chañaritos", "Media Naranja", "Paso Viejo", "San Marcos Sierra", "San Marcos Sierras", "Serrezuela", "Tuclame", "Villa de Soto"],
    "General Roca": ["Buchardo", "Del Campillo", "Estación Lecueder", "Hipólito Bouchard", "Huinca Renancó", "Italó", "Jovita", "Mattaldi", "Nicolás Bruzzone", "Onagoity", "Pincén", "Ranqueles", "Santa Magdalena", "Villa Huidobro", "Villa Sarmiento", "Villa Valeria"],
    "General San Martín": ["Arroyo Algodón", "Arroyo Cabral", "Ausonia", "Chazón", "Etruria", "La Laguna", "La Palestina", "La Playosa", "Las Mojarras", "Luca", "Pasco", "Sanabria", "Silvio Pellico", "Ticino", "Tío Pujio", "Villa Albertina", "Villa María", "Villa Nueva", "Villa Oeste"],
    "Ischilín": ["Avellaneda", "Cañada de Río Pinto", "Chuña", "Copacabana", "Deán Funes", "Esquina del Alambre", "Los Pozos", "Olivares de San Nicolás", "Quilino", "San Pedro de Toyos", "Villa Gutiérrez", "Villa Quilino"],
    "Juárez Celman": ["Alejandro Roca", "Assunta", "Bengolea", "Carnerillo", "Charras", "El Rastreador", "General Cabrera", "General Deheza", "Huanchilla", "Huanchillas", "La Carlota", "Los Cisnes", "Olaeta", "Pacheco de Melo", "Paso del Durazno", "Reducción", "Santa Eufemia", "Ucacha", "Villa Reducción"],
    "Marcos Juárez": ["Alejo Ledesma", "Arias", "Camilo Aldao", "Capitán General B. O'Higgins", "Capitán General Bernardo O'Higgins", "Cavanagh", "Colonia Barge", "Colonia Italiana", "Colonia Veinticinco", "Corral de Bustos", "Cruz Alta", "General Baldissera", "General Roca", "Guatimozín", "Inriville", "Isla Verde", "Leones", "Los Surgentes", "Marcos Juárez", "Monte Buey", "Saira", "Saladillo", "Villa Elisa"],
    "Minas": ["Ciénaga del Coro", "El Chacho", "Estancia de Guadalupe", "Guasapampa", "La Playa", "San Carlos Minas", "Talaini", "Tosno"],
    "Pocho": ["Chancani", "Las Palmas", "Los Talares", "Salsacate", "San Gerónimo", "Tala Cañada", "Taninga", "Villa de Pocho"],
    "Presidente Roque Sáenz Peña": ["General Levalle", "La Cesira", "Laboulaye", "Leguizamón", "Melo", "Río Bamba", "Rosales", "San Joaquín", "Serrano", "Villa Rossi"],
    "Punilla": ["Barrio Santa Isabel", "Bialet Massé", "Cabalango", "Capilla del Monte", "Casa Grande", "Charbonier", "Cosquín", "Cuesta Blanca", "Estancia Vieja", "Huerta Grande", "La Cumbre", "La Falda", "Las Jarillas", "Los Cocos", "Mallín", "Mayu Sumaj", "Quebrada de Luna", "San Antonio de Arredondo", "San Esteban", "San Roque", "Santa María de Punilla", "Tala Huasi", "Tanti", "Valle Hermoso", "Villa Carlos Paz", "Villa Flor Serrana", "Villa Giardino", "Villa Lago Azul", "Villa Parque Siquimán", "Villa Río Icho Cruz", "Villa San José", "Villa Santa Cruz del Lago"],
    "Río Cuarto": ["Achiras", "Adelia María", "Alcira", "Alcira Gigena", "Alpa Corral", "Berrotarán", "Bulnes", "Chaján", "Chucul", "Coronel Baigorria", "Coronel Moldes", "Elena", "La Carolina", "La Cautiva", "La Gilda", "Las Acequias", "Las Albahacas", "Las Higueras", "Las Peñas", "Las Peñas Sud", "Las Vertientes", "Malena", "Monte de los Gauchos", "Paso del Durazno", "Río Cuarto", "Sampacho", "San Basilio", "Santa Catalina", "Santa Catalina Holmberg", "Suco", "Tosquita", "Tosquitas", "Vicuña Mackenna", "Villa El Chacay", "Villa Santa Eugenia", "Washington"],
    "Río Primero": ["Atahona", "Cañada de Machado", "Capilla de los Remedios", "Chalacea", "Colonia Las Cuatro Esquinas", "Comechingones", "Diego de Rojas", "El Alcalde", "El Crispín", "Esquina", "Kilómetro 658", "La Para", "La Posta", "La Puerta", "La Quinta", "Las Gramillas", "Las Saladas", "Maquinista Gallini", "Monte Cristo", "Monte del Rosario", "Montecristo", "Obispo Trejo", "Piquillín", "Plaza de Mercedes", "Pueblo Comechingones", "Río Primero", "Sagrada Familia", "Santa Rosa de Río Primero", "Villa Fontana"],
    "Río Seco": ["Cerro Colorado", "Chañar Viejo", "Eufrasio Loza", "Gütemberg", "La Rinconada", "Los Hoyos", "Puesto de Castro", "Rayo Cortado", "San Pedro de Gütemberg", "Santa Elena", "Sebastián Elcano", "Villa Candelaria", "Villa Candelaria Norte", "Villa de María"],
    "Río Segundo": ["Calchín", "Calchín Oeste", "Capilla del Carmen", "Carrilobo", "Colazo", "Colonia Videla", "Costasacate", "Impira", "Laguna Larga", "Las Junturas", "Los Chañaritos", "Luque", "Manfredi", "Matorrales", "Oncativo", "Pilar", "Pozo del Molle", "Rincón", "Río Segundo", "Santiago Temple", "Villa del Rosario"],
    "San Alberto": ["Ambul", "Arroyo Los Patos", "El Huayco", "La Cortadera", "Las Calles", "Las Oscuras", "Las Rabonas", "Los Callejones", "Mina Clavero", "Mussi", "Nono", "Panaholma", "San Huberto", "San Lorenzo", "San Martín", "San Pedro", "San Vicente", "Sauce Arriba", "Tasna", "Villa Cura Brochero", "Villa Sarmiento"],
    "San Javier": ["Conlara", "Cruz Caña", "Dos Arroyos", "El Pantanillo", "La Paz", "La Población", "La Ramada", "La Travesía", "Las Chacras", "Las Tapias", "Loma Bola", "Los Cerrillos", "Los Hornillos", "Los Molles", "Luyaba", "Quebracho Ladeado", "Quebrada de los Pozos", "San Javier y Yacanto", "San José", "Villa de las Rosas", "Villa Dolores", "Villa La Viña"],
    "San Justo": ["Alicia", "Altos de Chipión", "Arroyito", "Balnearia", "Brinkmann", "Colonia 10 de Julio", "Colonia Anita", "Colonia Iturraspe", "Colonia Las Pichanas", "Colonia Marina", "Colonia Prosperidad", "Colonia San Bartolomé", "Colonia San Pedro", "Colonia Santa María", "Colonia Valtelina", "Colonia Vignaud", "Devoto", "El Arañado", "El Fortín", "El Fuertecito", "El Tío", "Estación Luxardo", "Freyre", "La Francia", "La Paquita", "La Tordilla", "Las Varas", "Las Varillas", "Marull", "Miramar", "Morteros", "Plaza Luxardo", "Plaza San Francisco", "Porteña", "Quebracho Herrado", "Sacanta", "San Francisco", "Saturnino María Laspiur", "Seeber", "Toro Pujio", "Tránsito", "Villa Concepción del Tío", "Villa del Tránsito", "Villa San Esteban"],
    "Santa María": ["Alta Gracia", "Anisacate", "Barrio Gilbert (1º de Mayo) - Tejas Tres", "Bouwer", "Campos del Virrey", "Caseros Centro", "Causana", "Costa Azul", "Despeñaderos", "Dique Chico", "El Potrerillo", "Falda del Cañete", "Falda del Carmen", "José de la Quintana", "La Boca del Río", "La Carbonada", "La Paisanita", "La Perla", "La Rancherita y Las Cascadas", "La Serranita", "Los Cedros", "Lozada", "Malagueño", "Milenica", "Monte Ralo", "Potrero de Garay", "Rafael García", "San Clemente", "San Nicolás - Tierra Alta", "Socavones", "Toledo", "Valle Alegre", "Valle de Anisacate", "Villa Ciudad de América", "Villa del Prado", "Villa La Bolsa", "Villa Los Aromos", "Villa Parque Santa Ana", "Villa San Isidro", "Villa Sierras De Oro", "Yocsina"],
    "Sobremonte": ["Caminiaga", "Chuña Huasi", "Pozo Nuevo", "San Francisco del Chañar"],
    "Tercero Arriba": ["Almafuerte", "Colonia Almada", "Corralito", "Dalmacio Vélez", "General Fotheringham", "Hernando", "James Craik", "Las Isletillas", "Las Perdices", "Los Zorros", "Oliva", "Pampayasta Norte", "Pampayasta Sud", "Punta del Agua", "Río Tercero", "Tancacha", "Villa Ascasubi"],
    "Totoral": ["Cañada de Luque", "Candelaria Sud", "Candelaria Sur", "Capilla de Sitón", "Capilla del Sitón", "La Pampa", "Las Peñas", "Los Mistoles", "Santa Catalina", "Sarmiento", "Simbolar", "Sinsacate", "Villa del Totoral"],
    "Tulumba": ["Churqui Cañada", "El Rodeo", "El Tuscal", "Las Arrias", "Lucio V. Mansilla", "Rosario del Saladillo", "San José de la Dormida", "San José de las Salinas", "San Pedro Norte", "Villa Tulumba"],
    "Unión": ["Aldea Santa María", "Alto Alegre", "Ana Zumarán", "Ballesteros", "Ballesteros Sud", "Bell Ville", "Benjamín Gould", "Canals", "Chilibroste", "Cintra", "Colonia Bismarck", "Colonia Bremen", "Idiazabal", "Justiniano Posse", "Laborde", "Monte Leña", "Monte Maíz", "Morrison", "Noetinger", "Ordoñez", "Pascanas", "Pueblo Italiano", "Ramón J. Cárcano", "San Antonio de Litín", "San Marcos", "San Marcos Sud", "San Severo", "Viamonte", "Villa Los Patos", "Wenceslao Escalante"],
};

// Llena un <select> con los departamentos de Córdoba.
function zonaLlenarDepartamentos(sel, textoVacio) {
    sel.innerHTML = `<option value="">${textoVacio}</option>` +
        Object.keys(ZONAS_CORDOBA).map(d => `<option>${d}</option>`).join('');
}

// Llena el <select> de ciudades con las del departamento elegido (paso opcional).
function zonaLlenarCiudades(sel, dep) {
    sel.innerHTML = `<option value="">${dep ? 'Todo el departamento' : 'Elegí un departamento primero'}</option>` +
        (ZONAS_CORDOBA[dep] || []).map(c => `<option>${c}</option>`).join('');
    sel.disabled = !dep;
}

// Barrios de una ciudad (vienen de barrios.js). Devuelve [] si no hay cargados.
function zonaBarriosDe(ciudad) {
    const lista = (typeof BARRIOS_CORDOBA !== 'undefined' && BARRIOS_CORDOBA[ciudad]) || [];
    return [...lista].sort((a, b) => a.localeCompare(b, 'es'));
}

// Llena el <select> de barrios con los de la ciudad elegida. Si la ciudad no
// tiene barrios cargados (o no se eligió ciudad), el selector se oculta junto
// con su contenedor (el elemento con data-zona-barrio, si existe).
function zonaLlenarBarrios(sel, ciudad) {
    const lista = zonaBarriosDe(ciudad);
    const cont = sel.closest('[data-zona-barrio]') || sel;
    sel.innerHTML = '<option value="">Todos los barrios</option>' +
        lista.map(b => `<option>${b}</option>`).join('');
    sel.value = '';
    cont.style.display = lista.length ? '' : 'none';
}

// Conecta departamento + ciudad (+ barrio, opcional): al cambiar el departamento
// se recargan las ciudades y al cambiar la ciudad se recargan los barrios.
function zonaConectar(depId, ciudadId, textoDep, barrioId) {
    const dep = document.getElementById(depId), ciudad = document.getElementById(ciudadId);
    const barrio = barrioId ? document.getElementById(barrioId) : null;
    zonaLlenarDepartamentos(dep, textoDep);
    zonaLlenarCiudades(ciudad, '');
    if (barrio) zonaLlenarBarrios(barrio, '');
    dep.addEventListener('change', () => {
        zonaLlenarCiudades(ciudad, dep.value);
        if (barrio) zonaLlenarBarrios(barrio, '');
    });
    if (barrio) ciudad.addEventListener('change', () => zonaLlenarBarrios(barrio, ciudad.value));
}

// Lee un grupo ya conectado. Devuelve { dep, city?, barrio? } o null si no eligió departamento.
// El barrio solo cuenta si hay una ciudad elegida.
function zonaLeer(depId, ciudadId, barrioId) {
    const dep = document.getElementById(depId).value;
    const city = document.getElementById(ciudadId).value;
    const barrio = barrioId ? document.getElementById(barrioId).value : '';
    if (!dep) return null;
    const zona = { dep };
    if (city) zona.city = city;
    if (city && barrio) zona.barrio = barrio;
    return zona;
}

// Carga una zona guardada en un grupo conectado (modo edición).
function zonaEscribir(depId, ciudadId, zona, barrioId) {
    if (!zona || !zona.dep) return;
    document.getElementById(depId).value = zona.dep;
    const ciudad = document.getElementById(ciudadId);
    zonaLlenarCiudades(ciudad, zona.dep);
    ciudad.value = zona.city || '';
    if (barrioId) {
        const barrio = document.getElementById(barrioId);
        zonaLlenarBarrios(barrio, ciudad.value);
        barrio.value = zona.barrio || '';
    }
}