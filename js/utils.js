// Devuelve todas las propiedades visibles: primero las que publicó la gente
// (vienen de la base de datos, vía backend.js) y después las de ejemplo que
// están escritas a mano en data.js.
//
// Cuando quieras sacar las de ejemplo y dejar solo las reales, vaciá el array
// propertiesData de data.js. No hace falta tocar nada más.
//
// Todos los ids se manejan como texto, porque los que genera la base de datos
// son códigos alfanuméricos, no números.
function getProperties() {
    let remotas = [];
    try {
        remotas = JSON.parse(localStorage.getItem('ip_props_cache')) || [];
    } catch (e) {
        remotas = [];
    }
    const demo = (typeof propertiesData !== 'undefined' ? propertiesData : [])
        .map(p => ({ ...p, id: String(p.id), esDemo: true }));

    return [...remotas.map(p => ({ ...p, id: String(p.id) })), ...demo];
}

// Vuelve a pintar la página actual con los datos más frescos. backend.js la
// llama sola cada vez que la base de datos cambia, así que si alguien publica
// una propiedad aparece en el catálogo sin recargar.
function refrescarVista() {
    if (typeof applyCatalogFilters === 'function') applyCatalogFilters();
    if (typeof renderFavorites === 'function') renderFavorites();
    if (typeof renderSellers === 'function') renderSellers();
    if (typeof renderDetalle === 'function') renderDetalle();
    renderFeaturedProperties();
    updateFavCount();
}

// --- Algoritmo de compatibilidad de permuta -------------------------------
// Calcula qué tan bien le sirve la propiedad "target" al dueño de "owner",
// según lo que owner.wants indica que acepta recibir. Devuelve un puntaje de
// 0 a 100 en una sola dirección (owner -> target), repartido así:
//   Tipo de inmueble ......... 25 pts
//   Zona ...................... 20 pts
//   Dormitorios mínimos ....... 15 pts
//   Superficie mínima ......... 15 pts
//   Precio máximo ............. 25 pts
// Los campos minBedrooms / minArea / maxPrice son opcionales (propiedades
// viejas de data.js no los tienen): si no están cargados, ese tramo se
// otorga completo (dormitorios/superficie) o se calcula contra el precio
// propio como antes (precio), para no penalizar publicaciones sin esos datos.
function matchUnidireccional(owner, target) {
    let score = 0;
    const wants = owner.wants || { types: [], locations: [] };

    // Tipo de inmueble deseado (25 pts)
    if ((wants.types || []).includes(target.type)) score += 25;

    // Zona deseada (20 pts)
    const wantsZone = (wants.locations || []).some(
        loc => loc.toLowerCase() === (target.location || '').toLowerCase()
    );
    if (wantsZone) score += 20;

    // Dormitorios mínimos que acepta recibir (15 pts)
    const minBedrooms = Number(wants.minBedrooms) || 0;
    if (minBedrooms <= 0) {
        score += 15; // sin preferencia cargada: no resta
    } else if ((target.bedrooms || 0) >= minBedrooms) {
        score += 15;
    } else {
        score += Math.max(0, (target.bedrooms || 0) / minBedrooms) * 15;
    }

    // Superficie mínima que acepta recibir (15 pts)
    const minArea = Number(wants.minArea) || 0;
    if (minArea <= 0) {
        score += 15;
    } else if ((target.area || 0) >= minArea) {
        score += 15;
    } else {
        score += Math.max(0, (target.area || 0) / minArea) * 15;
    }

    // Precio máximo que está dispuesto a recibir (25 pts)
    const maxPrice = Number(wants.maxPrice) || 0;
    if (maxPrice > 0) {
        if (target.price <= maxPrice) {
            score += 25;
        } else {
            const excesoSobrePrecio = (target.price - maxPrice) / maxPrice;
            if (excesoSobrePrecio <= 0.15) score += 15;
            else if (excesoSobrePrecio <= 0.30) score += 8;
            // más de 30% por encima del máximo aceptado: 0 pts
        }
    } else {
        // Sin precio máximo cargado: comparamos contra el valor de "owner",
        // igual que hacía la versión anterior del algoritmo.
        const priceDiff = owner.price ? Math.abs(owner.price - target.price) / owner.price : 1;
        if (priceDiff <= 0.15) score += 25;
        else if (priceDiff <= 0.30) score += 14;
        else if (priceDiff <= 0.50) score += 6;
    }

    return Math.round(score);
}

// Compatibilidad real de una permuta: hace falta que LAS DOS partes estén
// conformes, no alcanza con que le convenga a una sola. Por eso se calcula
// en ambas direcciones y se le da más peso al lado más débil (el cuello de
// botella de la negociación) que al lado más entusiasta.
function calcularCompatibilidad(a, b) {
    const aQuiereB = matchUnidireccional(a, b);
    const bQuiereA = matchUnidireccional(b, a);
    const min = Math.min(aQuiereB, bQuiereA);
    const max = Math.max(aQuiereB, bQuiereA);
    const final = min * 0.6 + max * 0.4;
    return Math.max(5, Math.min(Math.round(final), 98));
}

// Texto legible de lo que una propiedad acepta recibir a cambio.
function describirWants(wants) {
    if (!wants || !(wants.types || []).length) return 'El propietario evalúa distintas propuestas.';
    const tipos = wants.types.join(' o ');
    const zonas = (wants.locations || []).join(', ');
    let texto = zonas ? `Busca ${tipos} en ${zonas}.` : `Busca ${tipos}.`;

    const extras = [];
    if (Number(wants.minBedrooms) > 0) extras.push(`${wants.minBedrooms}+ dormitorios`);
    if (Number(wants.minArea) > 0) extras.push(`${wants.minArea}+ m²`);
    if (Number(wants.maxPrice) > 0) extras.push(`hasta US$ ${Number(wants.maxPrice).toLocaleString()}`);
    if (extras.length) texto += ` Condiciones: ${extras.join(', ')}.`;

    return texto;
}
// ---------------------------------------------------------------------------

// --- Favoritos -------------------------------------------------------------
// Siguen siendo de cada navegador: son una lista personal, no información
// que tenga sentido compartir con el resto del sitio.
function getFavorites() {
    let favs = [];
    try {
        favs = JSON.parse(localStorage.getItem('favorites')) || [];
    } catch (e) {
        favs = [];
    }
    return favs.map(String);
}

function isFavorite(id) {
    return getFavorites().includes(String(id));
}

function toggleFavorite(id) {
    id = String(id);
    let favs = getFavorites();
    if (favs.includes(id)) {
        favs = favs.filter(f => f !== id);
    } else {
        favs.push(id);
    }
    localStorage.setItem('favorites', JSON.stringify(favs));
    updateFavCount();
    return favs.includes(id);
}

// Actualiza el contador del corazón en el header, en cualquier página que
// tenga el ícono con id="fav-icon-btn".
function updateFavCount() {
    const count = getFavorites().length;
    const badge = document.getElementById('fav-count');
    const btn = document.getElementById('fav-icon-btn');
    if (badge) {
        badge.innerText = count;
        badge.classList.toggle('show', count > 0);
    }
    if (btn) {
        btn.classList.toggle('has-favs', count > 0);
    }
}

// Handler del botón de corazón sobre cada tarjeta.
function handleFavoriteClick(event, id) {
    event.preventDefault();
    event.stopPropagation();
    const nowFav = toggleFavorite(id);
    const btn = event.currentTarget;
    btn.classList.toggle('is-fav', nowFav);
    btn.innerHTML = nowFav ? '<i class="fa-solid fa-heart"></i>' : '<i class="fa-regular fa-heart"></i>';

    if (!nowFav && document.body.dataset.page === 'favoritos') {
        const card = btn.closest('.card');
        if (card) card.remove();
        if (getFavorites().length === 0 && typeof renderFavorites === 'function') {
            renderFavorites();
        }
    }
}
// ---------------------------------------------------------------------------

// Tarjeta de propiedad reutilizable (home, catálogo, favoritos y "opciones
// similares" de la ficha de detalle).
// matchPercent es opcional: solo tiene sentido mostrarlo cuando se está
// comparando contra una propiedad puntual.
function renderPropertyCard(p, matchPercent) {
    const fav = isFavorite(p.id);
    const id = String(p.id).replace(/'/g, "\\'");
    const tieneVideo = Array.isArray(p.media) && p.media.some(m => m.type === 'video');
    return `
        <div class="card">
            <div class="card-img" style="background-image: url('${p.image}')" role="img" aria-label="${p.title}">
                ${tieneVideo ? `<span class="card-video-badge"><i class="fa-solid fa-circle-play"></i> Video</span>` : ''}
                <button class="fav-btn ${fav ? 'is-fav' : ''}" onclick="handleFavoriteClick(event, '${id}')" aria-label="Guardar en favoritos" title="Guardar en favoritos">
                    <i class="fa-${fav ? 'solid' : 'regular'} fa-heart"></i>
                </button>
                ${matchPercent !== undefined ? `
                <div class="match-badge">
                    <span class="match-percent">${matchPercent}%</span>
                    <span class="match-text">de coincidencia</span>
                </div>` : ''}
            </div>
            <div class="card-body">
                <div class="card-price">${p.currency} ${Number(p.price).toLocaleString()}</div>
                <h3 class="card-title">${p.title}</h3>
                <p class="card-location"><i class="fa-solid fa-location-dot"></i>${p.location}, ${p.city}</p>
                <div class="card-footer">
                    <span><i class="fa-solid fa-bed"></i> ${p.bedrooms} dorm. · ${p.area} m²</span>
                    <a href="propiedad.html?id=${encodeURIComponent(p.id)}" class="btn btn-primary btn-sm">Ver detalle</a>
                </div>
            </div>
        </div>
    `;
}

function renderFeaturedProperties() {
    const container = document.getElementById('featured-grid');
    if (!container) return;
    const props = getProperties();
    const featured = props.slice(0, 6);
    container.innerHTML = featured.map(p => renderPropertyCard(p)).join('');

    const countText = document.getElementById('active-count-text');
    if (countText) {
        countText.innerText = `Encontrá la próxima oportunidad entre ${props.length} propiedades activas.`;
    }
}

// Menú mobile: alterna la clase que muestra/oculta la navegación en pantallas chicas.
function toggleMobileNav() {
    const nav = document.getElementById('nav-menu');
    if (nav) nav.classList.toggle('nav-open');
}

document.addEventListener('DOMContentLoaded', () => {
    renderFeaturedProperties();
    updateFavCount();
});