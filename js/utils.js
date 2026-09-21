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
    if (typeof renderDetalle === 'function') renderDetalle();
    if (typeof renderMisPropiedades === 'function') renderMisPropiedades();
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
//
// Dentro de "Zona", si quien busca eligió un barrio, coincidir también en el
// barrio pesa: mismo barrio 20, ciudad sin dato de barrio 17, otro barrio de la
// misma ciudad 12, otra ciudad del departamento 10.
// Dentro de "Superficie" (15 pts) se promedian los criterios que quien busca
// haya cargado: superficie mínima (como siempre), superficie cubierta
// mínima/máxima y superficie de terreno mínima/máxima. Los que dejó vacíos
// no cuentan, así que las publicaciones existentes puntúan igual que antes.
//
// Cada apartado admite hasta 2 opciones (types con 2 tipos, zones con 2 zonas,
// y minBedrooms2 / minArea2 / maxPrice2 como segunda opción). Se toma la que
// mejor le queda a la propiedad comparada: si no encaja en una, puede encajar
// en la otra.
// Los campos numéricos son opcionales (propiedades viejas de data.js no los
// tienen): si no están cargados, ese tramo se otorga completo
// (dormitorios/superficie) o se calcula contra el precio propio (precio),
// para no penalizar publicaciones sin esos datos.

// Sin tildes ni mayúsculas, para comparar nombres de zonas.
function _norm(s) {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

// Se queda solo con las opciones cargadas (números > 0).
function _opciones(...valores) {
    return valores.map(Number).filter(n => n > 0);
}

// De 0 a 1: cuánto cumple "valor" el mínimo pedido. Con 2 opciones vale la que
// mejor le queda. Sin ningún mínimo cargado, cumple del todo.
function _cumpleMinimo(valor, ...mins) {
    const m = _opciones(...mins);
    if (!m.length) return 1;
    return Math.max(...m.map(x => Math.min(1, (valor || 0) / x)));
}

// Puntos (0 a 25) del precio contra un máximo aceptado.
function _puntosPrecio(precio, max) {
    if (precio <= max) return 25;
    const exceso = (precio - max) / max;
    return exceso <= 0.15 ? 15 : exceso <= 0.30 ? 8 : 0;
}

// Puntos (0 a 20) de zona. wants.zones = [{ dep, city?, barrio? }, ...] (hasta 2).
//   - Coincide la ciudad, o pidió solo el departamento y coincide: 20.
//   - Pidió un barrio dentro de esa ciudad: mismo barrio 20; la propiedad no
//     tiene barrio cargado 17 (no sabemos, no se penaliza fuerte); otro barrio 12.
//   - Pidió una ciudad y la propiedad está en otra del mismo departamento: 10.
// Las publicaciones viejas no tienen departamento cargado: se comparan por nombre.
function _puntosZona(wants, target) {
    const dep = _norm(target.departamento), loc = _norm(target.localidad), barrio = _norm(target.barrio);
    const nombres = [target.location, target.city, target.departamento, target.localidad].map(_norm);
    let pts = 0;

    (wants.zones || []).forEach(z => {
        if (dep) {
            if (_norm(z.dep) !== dep) return;
            if (z.city && _norm(z.city) !== loc) { pts = Math.max(pts, 10); return; }
            let p = 20;
            if (z.city && z.barrio) {
                if (!barrio) p = 17;
                else if (_norm(z.barrio) !== barrio) p = 12;
            }
            pts = Math.max(pts, p);
        } else if (nombres.includes(_norm(z.city || z.dep))) {
            pts = 20;
        }
    });

    // Publicaciones viejas: zonas escritas a mano en wants.locations
    if (!(wants.zones || []).length && (wants.locations || []).some(l => nombres.includes(_norm(l)))) pts = 20;
    return pts;
}

// De 0 a 1: cuánto entra "valor" en el rango pedido [min, max]. Devuelve null
// si no se cargó ni mínimo ni máximo (ese criterio no cuenta). Si la propiedad
// no tiene el dato cargado vale 0.5: ni se premia ni se descarta del todo.
function _fraccionRango(valor, min, max) {
    min = Number(min) || 0;
    max = Number(max) || 0;
    if (!min && !max) return null;
    valor = Number(valor) || 0;
    if (valor <= 0) return 0.5;
    if (min && valor < min) return valor / min;
    if (max && valor > max) return max / valor;
    return 1;
}

// Puntos (0 a 15) de superficie: promedio de los criterios que quien busca cargó.
// Sin ninguno cargado se otorga completo, igual que antes.
function _puntosSuperficie(wants, target) {
    const partes = [];
    if (_opciones(wants.minArea, wants.minArea2).length) {
        partes.push(_cumpleMinimo(target.area, wants.minArea, wants.minArea2));
    }
    // Si la propiedad no cargó superficie cubierta, se usa su superficie general.
    const cub = _fraccionRango(target.superficieCubierta || target.area, wants.minCubierta, wants.maxCubierta);
    const ter = _fraccionRango(target.superficieTerreno, wants.minTerreno, wants.maxTerreno);
    if (cub !== null) partes.push(cub);
    if (ter !== null) partes.push(ter);

    if (!partes.length) return 15;
    return 15 * partes.reduce((a, b) => a + b, 0) / partes.length;
}

function matchUnidireccional(owner, target) {
    const wants = owner.wants || { types: [], locations: [] };
    let score = 0;

    // Tipo de inmueble deseado (25 pts): sirve cualquiera de las opciones
    if ((wants.types || []).includes(target.type)) score += 25;

    // Zona deseada (20 pts)
    score += _puntosZona(wants, target);

    // Dormitorios mínimos que acepta recibir (15 pts)
    score += 15 * _cumpleMinimo(target.bedrooms, wants.minBedrooms, wants.minBedrooms2);

    // Superficie: mínima, cubierta y terreno (15 pts en total)
    score += _puntosSuperficie(wants, target);

    // Precio máximo que está dispuesto a recibir (25 pts)
    const maximos = _opciones(wants.maxPrice, wants.maxPrice2);
    if (maximos.length) {
        score += Math.max(...maximos.map(m => _puntosPrecio(target.price, m)));
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
function nombreZona(z) {
    if (z.city && z.barrio) return `Barrio ${z.barrio}, ${z.city} (${z.dep})`;
    return z.city ? `${z.city} (${z.dep})` : `Dpto. ${z.dep}`;
}

// "80–150 m² cubiertos", "desde 80 m² cubiertos", "hasta 150 m² cubiertos".
function _textoRango(min, max, sufijo) {
    min = Number(min) || 0;
    max = Number(max) || 0;
    if (!min && !max) return '';
    const f = n => n.toLocaleString('es-AR');
    if (min && max) return `${f(min)}–${f(max)} m² ${sufijo}`;
    return min ? `desde ${f(min)} m² ${sufijo}` : `hasta ${f(max)} m² ${sufijo}`;
}

function describirWants(wants) {
    if (!wants || !(wants.types || []).length) return 'El propietario evalúa distintas propuestas.';
    const tipos = wants.types.join(' o ');
    const zonas = (wants.zones || []).length ? wants.zones.map(nombreZona) : (wants.locations || []);
    let texto = zonas.length ? `Busca ${tipos} en ${zonas.join(' o ')}.` : `Busca ${tipos}.`;

    const dorm = _opciones(wants.minBedrooms, wants.minBedrooms2);
    const area = _opciones(wants.minArea, wants.minArea2);
    const precio = _opciones(wants.maxPrice, wants.maxPrice2);
    const extras = [];
    if (dorm.length) extras.push(`${dorm.map(n => n + '+').join(' o ')} dormitorios`);
    if (area.length) extras.push(`${area.map(n => n + '+').join(' o ')} m²`);
    const cubierta = _textoRango(wants.minCubierta, wants.maxCubierta, 'cubiertos');
    const terreno = _textoRango(wants.minTerreno, wants.maxTerreno, 'de terreno');
    if (cubierta) extras.push(cubierta);
    if (terreno) extras.push(terreno);
    if (precio.length) extras.push(`hasta ${precio.map(n => 'US$ ' + n.toLocaleString()).join(' o ')}`);
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

// Pie de página: año actual y envío del formulario de contacto.
// Por ahora el formulario no manda el mensaje a ningún lado real (no hay
// backend de correo conectado): solo valida los campos y muestra un aviso
// de que se recibió, para no dejar al usuario sin respuesta visual.
function initFooterContactForm() {
    const yearEl = document.getElementById('footer-year');
    if (yearEl) yearEl.textContent = new Date().getFullYear();

    const form = document.getElementById('contact-form');
    if (!form) return;

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const msgEl = document.getElementById('contact-form-msg');
        if (msgEl) {
            msgEl.textContent = '¡Gracias! Recibimos tu mensaje y te vamos a contactar a la brevedad.';
            msgEl.classList.add('show');
        }
        form.reset();
    });
}

document.addEventListener('DOMContentLoaded', () => {
    renderFeaturedProperties();
    updateFavCount();
    initFooterContactForm();
});