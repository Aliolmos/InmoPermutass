function getProperties() {
    return JSON.parse(localStorage.getItem('properties')) || [];
}

function saveProperties(props) {
    localStorage.setItem('properties', JSON.stringify(props));
}

// --- Algoritmo de compatibilidad de permuta -------------------------------
// Calcula qué tan bien le sirve la propiedad "target" al dueño de "owner",
// según lo que owner.wants indica que acepta recibir.
// Devuelve un puntaje de 0 a 100 en una sola dirección (owner -> target).
function matchUnidireccional(owner, target) {
    let score = 0;

    // Tipo de inmueble deseado (35 pts)
    if (owner.wants.types.includes(target.type)) score += 35;

    // Zona deseada (30 pts)
    const wantsZone = owner.wants.locations.some(
        loc => loc.toLowerCase() === target.location.toLowerCase()
    );
    if (wantsZone) score += 30;

    // Diferencia de valor entre las dos propiedades (hasta 35 pts)
    const priceDiff = Math.abs(owner.price - target.price) / owner.price;
    if (priceDiff <= 0.15) score += 35;
    else if (priceDiff <= 0.30) score += 20;
    else if (priceDiff <= 0.50) score += 8;
    // más de 50% de diferencia: 0 pts, la permuta ya no es realista

    return score;
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

// Texto legible de lo que una propiedad acepta recibir a cambio, para
// mostrar en la ficha de detalle sin tener que escribirlo a mano por cada
// propiedad.
function describirWants(wants) {
    const tipos = wants.types.join(' o ');
    const zonas = wants.locations.join(', ');
    return `Busca ${tipos} en ${zonas}.`;
}
// ---------------------------------------------------------------------------

// --- Favoritos -------------------------------------------------------------
// Guardados como un array simple de ids en localStorage. No hace falta nada
// más sofisticado: es el mismo patrón que ya usa "properties".
function getFavorites() {
    return JSON.parse(localStorage.getItem('favorites')) || [];
}

function isFavorite(id) {
    return getFavorites().includes(id);
}

function toggleFavorite(id) {
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
// tenga el ícono con id="fav-icon-btn". Se llama al cargar cada página y
// cada vez que se togglea un favorito.
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

// Handler del botón de corazón sobre cada tarjeta. Evita que el click
// dispare cualquier link contenedor y re-pinta el ícono al toque, sin
// esperar a un refresco completo de la grilla.
function handleFavoriteClick(event, id) {
    event.preventDefault();
    event.stopPropagation();
    const nowFav = toggleFavorite(id);
    const btn = event.currentTarget;
    btn.classList.toggle('is-fav', nowFav);
    btn.innerHTML = nowFav ? '<i class="fa-solid fa-heart"></i>' : '<i class="fa-regular fa-heart"></i>';

    // Si estamos en la página de favoritos, sacar la tarjeta de la vista
    // directamente en vez de esperar a que el usuario recargue.
    if (!nowFav && document.body.dataset.page === 'favoritos') {
        const card = btn.closest('.card');
        if (card) card.remove();
        if (getFavorites().length === 0 && typeof renderFavorites === 'function') {
            renderFavorites();
        }
    }
}
// ---------------------------------------------------------------------------

// Tarjeta de propiedad reutilizable. Se usa en el home, el catálogo, favoritos
// y las "opciones similares" de la ficha de detalle, para no tener el mismo
// HTML copiado y pegado en varios archivos (y desincronizado, como pasaba antes).
// matchPercent es opcional: solo tiene sentido mostrarlo cuando se está
// comparando contra una propiedad puntual (ver "opciones similares" en
// propiedad.html). En listados genéricos (home, catálogo) no hay nada
// específico con qué comparar, así que no se muestra ningún % ahí.
function renderPropertyCard(p, matchPercent) {
    const fav = isFavorite(p.id);
    return `
        <div class="card">
            <div class="card-img" style="background-image: url('${p.image}')" role="img" aria-label="${p.title}">
                <button class="fav-btn ${fav ? 'is-fav' : ''}" onclick="handleFavoriteClick(event, ${p.id})" aria-label="Guardar en favoritos" title="Guardar en favoritos">
                    <i class="fa-${fav ? 'solid' : 'regular'} fa-heart"></i>
                </button>
                ${matchPercent !== undefined ? `
                <div class="match-badge">
                    <span class="match-percent">${matchPercent}%</span>
                    <span class="match-text">de coincidencia</span>
                </div>` : ''}
            </div>
            <div class="card-body">
                <div class="card-price">${p.currency} ${p.price.toLocaleString()}</div>
                <h3 class="card-title">${p.title}</h3>
                <p class="card-location"><i class="fa-solid fa-location-dot"></i>${p.location}, ${p.city}</p>
                <div class="card-footer">
                    <span><i class="fa-solid fa-bed"></i> ${p.bedrooms} dorm. · ${p.area} m²</span>
                    <a href="propiedad.html?id=${p.id}" class="btn btn-primary btn-sm">Ver detalle</a>
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