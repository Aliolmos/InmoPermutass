/* =========================================================================
   ASISTENTE IA — InmoPermutas
   -------------------------------------------------------------------------
   Widget flotante (burbuja abajo a la derecha) con un mini chat donde el
   usuario escribe en lenguaje natural lo que busca y el asistente le devuelve
   las mejores propiedades del catálogo, ordenadas por afinidad.

   Es autocontenido: inyecta su propio CSS y su propio HTML. Para activarlo en
   una página alcanza con agregar, después de data.js y utils.js:

       <script src="js/asistente.js"></script>

   Entiende dos tipos de pedido:
     1) BÚSQUEDA      "busco un depto de 2 dormitorios en Palermo hasta 200 mil"
     2) PERMUTA       "tengo una casa en Nordelta de 300 mil y quiero un depto
                       en Palermo"  -> usa calcularCompatibilidad() de utils.js
                       para puntuar la permuta en las dos direcciones.

   Funciona 100% en el navegador, sin servidor ni API key. Si más adelante
   querés enchufarle un modelo de lenguaje real, mirá IA_CONFIG abajo.
   ========================================================================= */

const IA_CONFIG = {
    // Dejalo vacío para usar el motor local (recomendado mientras el sitio sea
    // estático). Si algún día tenés un backend propio que hable con un modelo,
    // poné acá la URL: debe recibir { mensaje, propiedades } por POST y
    // devolver { texto, ids: [1, 5, 8] }. Si falla, cae solo al motor local.
    endpoint: "",
    nombre: "Asistente de permutas",
    saludoTitulo: "Soy una IA que te ayuda a encontrar tu permuta",
    saludoTexto: "Escribime a tu manera qué buscás o pedime ayuda cuando quieras."
};

/* ----------------------- Diccionario de interpretación ------------------- */

const IA_TIPOS = {
    "Casa": ["casa", "casas", "chalet", "ph", "quinta", "casita", "vivienda"],
    "Departamento": ["departamento", "departamentos", "depto", "deptos", "dpto", "depa", "monoambiente", "piso", "semipiso"],
    "Terreno": ["terreno", "terrenos", "lote", "lotes", "parcela", "fraccion"],
    "Negocio": ["negocio", "local", "locales", "comercial", "comercio", "fondo de comercio"],
    "Galpon": ["galpon", "galpones", "deposito", "depositos", "nave", "industrial"],
    "Garaje": ["garaje", "garage", "cochera", "cocheras", "estacionamiento"]
};

// El dato real en data.js usa "Galpón" con tilde; normalizamos al comparar.
function iaNorm(str) {
    return (str || "")
        .toString()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

function iaTipoReal(tipoKey) {
    // Devuelve el tipo tal como está escrito en los datos.
    const props = typeof getProperties === "function" ? getProperties() : [];
    const real = props.find(p => iaNorm(p.type) === iaNorm(tipoKey));
    return real ? real.type : tipoKey;
}

/* ----------------------------- Parser de texto --------------------------- */

function iaDetectarTipo(texto) {
    for (const [tipo, palabras] of Object.entries(IA_TIPOS)) {
        if (palabras.some(p => new RegExp("\\b" + p + "\\b").test(texto))) {
            return iaTipoReal(tipo);
        }
    }
    return null;
}

// Busca zonas y ciudades contra las que existen realmente en el catálogo,
// así no hace falta mantener una lista a mano.
function iaDetectarZonas(texto) {
    const props = typeof getProperties === "function" ? getProperties() : [];
    const encontradas = [];
    const candidatos = new Set();
    props.forEach(p => { candidatos.add(p.location); candidatos.add(p.city); });

    candidatos.forEach(zona => {
        if (!zona) return;
        if (iaNorm(texto).includes(iaNorm(zona))) encontradas.push(zona);
    });

    // Evita quedarse con "Córdoba" cuando en realidad dijo "Nueva Córdoba".
    return encontradas.filter(z =>
        !encontradas.some(otra => otra !== z && iaNorm(otra).includes(iaNorm(z)))
    );
}

function iaDetectarPrecio(texto) {
    const t = iaNorm(texto);
    // 1) "200k" / "200 mil" / "1.5 millones"
    let m = t.match(/(\d+(?:[.,]\d+)?)\s*(k|mil|millon|millones|palos)/);
    if (m) {
        const base = parseFloat(m[1].replace(",", "."));
        const mult = /millon|millones|palos/.test(m[2]) ? 1000000 : 1000;
        return Math.round(base * mult);
    }
    // 2) Número largo suelto: 200000, 200.000, U$S 200,000
    const nums = t.match(/\d[\d.,]{4,}/g);
    if (nums) {
        const limpio = Number(nums[0].replace(/[.,]/g, ""));
        if (limpio >= 10000) return limpio;
    }
    return null;
}

function iaDetectarDormitorios(texto) {
    const m = iaNorm(texto).match(/(\d+)\s*(dorm|dormitorio|dormitorios|ambiente|ambientes|habitacion|habitaciones|cuarto|cuartos)/);
    return m ? Number(m[1]) : null;
}

function iaDetectarSuperficie(texto) {
    const m = iaNorm(texto).match(/(\d{2,4})\s*(m2|m²|mts|metros)/);
    return m ? Number(m[1]) : null;
}

// Separa "tengo X y busco Y" en las dos mitades. Si no hay oferta, devuelve
// null en "ofrece" y trata todo el texto como búsqueda.
function iaPartirPermuta(texto) {
    const t = iaNorm(texto);
    const tieneOferta = /\b(tengo|ofrezco|poseo|soy dueno|permuto|entrego|doy)\b/.test(t);
    if (!tieneOferta) return { ofrece: null, busca: texto };

    const corte = t.search(/\b(y busco|busco|quiero|me interesa|necesito|a cambio|por un|por una|cambio por)\b/);
    if (corte === -1) return { ofrece: texto, busca: "" };

    return { ofrece: texto.slice(0, corte), busca: texto.slice(corte) };
}

function iaInterpretar(mensaje) {
    const partes = iaPartirPermuta(mensaje);
    const busca = {
        tipo: iaDetectarTipo(iaNorm(partes.busca)),
        zonas: iaDetectarZonas(partes.busca),
        precio: iaDetectarPrecio(partes.busca),
        dormitorios: iaDetectarDormitorios(partes.busca),
        superficie: iaDetectarSuperficie(partes.busca)
    };
    const ofrece = partes.ofrece ? {
        tipo: iaDetectarTipo(iaNorm(partes.ofrece)),
        zonas: iaDetectarZonas(partes.ofrece),
        precio: iaDetectarPrecio(partes.ofrece)
    } : null;

    return { ofrece, busca, textoOriginal: mensaje };
}

/* --------------------------- Motor de resultados ------------------------- */

// Puntaje de búsqueda simple (no permuta): cuánto se acerca la propiedad a lo
// que el usuario pidió. Se normaliza sobre los puntos que realmente pidió,
// para que "busco una casa" no baje de puntaje por no haber dicho precio.
function iaPuntajeBusqueda(p, c) {
    let obtenido = 0, posible = 0;

    if (c.tipo) {
        posible += 35;
        if (iaNorm(p.type) === iaNorm(c.tipo)) obtenido += 35;
    }
    if (c.zonas.length) {
        posible += 30;
        const hit = c.zonas.some(z =>
            iaNorm(p.location) === iaNorm(z) || iaNorm(p.city) === iaNorm(z)
        );
        const casi = c.zonas.some(z => iaNorm(p.city).includes(iaNorm(z)) || iaNorm(z).includes(iaNorm(p.city)));
        if (hit) obtenido += 30;
        else if (casi) obtenido += 15;
    }
    if (c.precio) {
        posible += 25;
        if (p.price <= c.precio) obtenido += 25;
        else if (p.price <= c.precio * 1.15) obtenido += 12;
        else if (p.price <= c.precio * 1.35) obtenido += 5;
    }
    if (c.dormitorios) {
        posible += 10;
        if (p.bedrooms >= c.dormitorios) obtenido += 10;
        else if (p.bedrooms === c.dormitorios - 1) obtenido += 5;
    }
    if (c.superficie) {
        posible += 10;
        if (p.area >= c.superficie) obtenido += 10;
        else if (p.area >= c.superficie * 0.8) obtenido += 5;
    }

    if (posible === 0) return 50; // no pidió nada concreto
    return Math.round((obtenido / posible) * 100);
}

// Cuando el usuario cuenta qué tiene para dar, armamos una propiedad "virtual"
// con sus datos y la puntuamos con el mismo algoritmo de permuta del sitio.
function iaPuntajePermuta(p, intencion) {
    const propiaPrecio = intencion.ofrece.precio || p.price;
    const propia = {
        type: intencion.ofrece.tipo || p.type,
        location: intencion.ofrece.zonas[0] || "",
        city: intencion.ofrece.zonas[0] || "",
        price: propiaPrecio,
        wants: {
            types: intencion.busca.tipo ? [intencion.busca.tipo] : Object.keys(IA_TIPOS).map(iaTipoReal),
            locations: intencion.busca.zonas.length ? intencion.busca.zonas : [p.location]
        }
    };

    if (typeof calcularCompatibilidad === "function") {
        return calcularCompatibilidad(propia, p);
    }
    return iaPuntajeBusqueda(p, intencion.busca);
}

function iaBuscar(intencion) {
    const props = typeof getProperties === "function" ? getProperties() : [];
    const esPermuta = !!intencion.ofrece;

    return props
        .map(p => ({
            prop: p,
            score: esPermuta ? iaPuntajePermuta(p, intencion) : iaPuntajeBusqueda(p, intencion.busca)
        }))
        .sort((a, b) => b.score - a.score)
        // En búsqueda simple pedimos más afinidad que en permuta: si dijo
        // "terreno" no tiene sentido ofrecerle una cochera con 28%.
        .filter(r => r.score >= (esPermuta ? 30 : 50))
        .slice(0, 3);
}

/* ------------------------- Redacción de la respuesta --------------------- */

function iaResumenCriterios(c) {
    const partes = [];
    if (c.tipo) partes.push(c.tipo.toLowerCase());
    if (c.dormitorios) partes.push(c.dormitorios + " dorm.");
    if (c.superficie) partes.push("desde " + c.superficie + " m²");
    if (c.zonas.length) partes.push("en " + c.zonas.join(" o "));
    if (c.precio) partes.push("hasta U$S " + c.precio.toLocaleString("es-AR"));
    return partes.join(", ");
}

function iaLinkCatalogo(c) {
    const params = new URLSearchParams();
    if (c.tipo) params.set("type", c.tipo);
    if (c.zonas.length) params.set("location", c.zonas[0]);
    const q = params.toString();
    return "catalogo.html" + (q ? "?" + q : "");
}

function iaTarjetaResultado(r) {
    const p = r.prop;
    return `
        <a class="ia-res" href="propiedad.html?id=${p.id}">
            <span class="ia-res-img" style="background-image:url('${p.image}')"></span>
            <span class="ia-res-info">
                <span class="ia-res-title">${p.title}</span>
                <span class="ia-res-meta">${p.location}, ${p.city} · ${p.bedrooms} dorm. · ${p.area} m²</span>
                <span class="ia-res-price">${p.currency} ${p.price.toLocaleString("es-AR")}</span>
            </span>
            <span class="ia-res-score">${r.score}%<small>afinidad</small></span>
        </a>`;
}

// Respuestas a preguntas que no son búsquedas (ayuda, cómo funciona, etc.)
function iaRespuestaGenerica(mensaje) {
    const t = iaNorm(mensaje);
    if (/^(hola|buenas|buen dia|buenas tardes|buenas noches|hey|que tal)/.test(t))
        return "¡Hola! Contame qué propiedad estás buscando (tipo, zona y presupuesto) o qué tenés para permutar, y te armo las mejores opciones.";
    if (/(como funciona|que es una permuta|permuta que es|no entiendo)/.test(t))
        return "Una permuta es intercambiar tu propiedad por otra, ajustando la diferencia en efectivo si hace falta. Publicás la tuya, decís qué te gustaría recibir y el algoritmo cruza tipo, zona y valor para darte un % de compatibilidad. Podés ver el detalle en <a href='funcionamiento.html'>Cómo funciona</a>.";
    if (/(publicar|publico|subir mi|cargar mi)/.test(t))
        return "Podés cargar tu propiedad desde <a href='publicar.html'>Publicar propiedad</a>. Cuando indiques qué aceptás recibir a cambio, el sitio empieza a calcular tus matches automáticamente.";
    if (/(favorito|guardad)/.test(t))
        return "Las propiedades que marcás con el corazón quedan en <a href='favoritos.html'>Favoritos</a> para comparar después.";
    if (/(gracias|genial|buenisimo|perfecto)/.test(t))
        return "¡De nada! Si querés, probá con otra zona o con otro presupuesto y te busco más opciones.";
    return null;
}

function iaResponder(mensaje) {
    const generica = iaRespuestaGenerica(mensaje);
    const intencion = iaInterpretar(mensaje);
    const pidioAlgo = intencion.busca.tipo || intencion.busca.zonas.length ||
                      intencion.busca.precio || intencion.busca.dormitorios ||
                      intencion.busca.superficie || intencion.ofrece;

    if (generica && !pidioAlgo) return { texto: generica, resultados: [] };

    if (!pidioAlgo) {
        return {
            texto: "No me quedó claro qué estás buscando. Probá diciéndome el tipo de inmueble, la zona y hasta cuánto querés gastar. Por ejemplo: <em>“departamento de 2 dormitorios en Palermo hasta 200 mil”</em>. También podés filtrar a mano desde el <a href='catalogo.html'>catálogo</a>.",
            resultados: []
        };
    }

    const resultados = iaBuscar(intencion);
    const resumen = iaResumenCriterios(intencion.busca);

    if (resultados.length === 0) {
        return {
            texto: `No encontré nada que encaje bien con ${resumen || "ese pedido"}. Probá ampliando la zona o subiendo un poco el presupuesto, o mirá todo el listado en el <a href='${iaLinkCatalogo(intencion.busca)}'>catálogo</a>.`,
            resultados: []
        };
    }

    let intro;
    if (intencion.ofrece) {
        const suyo = [intencion.ofrece.tipo, intencion.ofrece.zonas[0]].filter(Boolean).join(" en ");
        intro = `Tomando tu ${suyo || "propiedad"} como base, estas son las permutas con mejor compatibilidad en las dos direcciones:`;
    } else {
        const n = resultados.length;
        intro = `Encontré ${n} ${n === 1 ? "opción" : "opciones"} para ${resumen}:`;
    }

    return { texto: intro, resultados, link: iaLinkCatalogo(intencion.busca) };
}

/* ------------------------------ Interfaz --------------------------------- */

const IA_ESTILOS = `
.ia-fab-wrap {
    position: fixed; right: 22px; bottom: 22px; z-index: 900;
    display: flex; align-items: center; gap: 12px;
}

/* Cartel al costado del logo: acá va la explicación de las dos formas de buscar */
.ia-callout {
    position: relative;
    background: var(--ink, #0a0f1e);
    border: 1px solid rgba(255,255,255,.14);
    color: #fff;
    width: 268px;
    padding: .85rem 1rem .9rem;
    border-radius: 16px;
    box-shadow: 0 18px 38px -16px rgba(10,15,30,.6);
    transition: opacity .25s ease, transform .25s ease;
}
.ia-callout.hide { opacity: 0; transform: translateX(10px); pointer-events: none; }
.ia-callout strong { display: block; font-size: .92rem; font-weight: 800; line-height: 1.3; margin-bottom: .25rem; }
.ia-callout strong em { font-style: normal; color: var(--green, #a6ff3e); }
.ia-callout p { font-size: .76rem; line-height: 1.45; color: var(--fog, #aab3c8); margin: 0; }
.ia-callout p a { color: #fff; text-decoration: underline; text-underline-offset: 2px; }
.ia-callout::after {
    content: ''; position: absolute; right: -6px; top: 50%;
    width: 12px; height: 12px; background: var(--ink, #0a0f1e);
    border-right: 1px solid rgba(255,255,255,.14); border-top: 1px solid rgba(255,255,255,.14);
    transform: translateY(-50%) rotate(45deg);
}
.ia-callout-x {
    position: absolute; top: 6px; right: 8px;
    background: none; border: none; color: var(--stone-light, #8a94a6);
    font-size: .8rem; cursor: pointer; padding: 2px;
}
.ia-callout-x:hover { color: #fff; }

.ia-fab {
    position: relative; width: 108px; height: 108px; border-radius: 50%;
    border: none; background: transparent; cursor: pointer; padding: 0;
    display: flex; align-items: center; justify-content: center;
    filter: drop-shadow(0 12px 26px rgba(10,15,30,.45));
    transition: transform .18s ease;
}
.ia-fab:hover { transform: scale(1.06); }
.ia-fab svg { width: 100%; height: 100%; display: block; }
.ia-fab .ia-fab-rot { transform-origin: 60px 60px; animation: ia-spin 9s linear infinite; }
@keyframes ia-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .ia-fab .ia-fab-rot { animation: none; } }

.ia-fab-badge {
    position: absolute; bottom: -2px; left: 50%; transform: translateX(-50%);
    background: var(--ink, #0a0f1e); color: var(--green, #a6ff3e);
    font-size: 0.92rem; font-weight: 900; letter-spacing: .06em;
    padding: 2px 12px; border-radius: 12px;
    border: 2px solid rgba(255,255,255,.9);
    line-height: 1.25;
}
.ia-fab-close { display: none; color: #fff; font-size: 1.5rem; }
.ia-fab.open svg, .ia-fab.open .ia-fab-badge { display: none; }
.ia-fab.open { background: var(--ink, #0a0f1e); width: 72px; height: 72px; }
.ia-fab.open .ia-fab-close { display: block; }

.ia-panel {
    position: fixed; right: 22px; bottom: 144px; z-index: 901;
    width: 380px; max-width: calc(100vw - 32px); height: 560px; max-height: calc(100vh - 140px);
    background: #fff; border: 1px solid var(--line, #e4e8f0); border-radius: 20px;
    box-shadow: 0 30px 60px -20px rgba(10,15,30,.45);
    display: none; flex-direction: column; overflow: hidden;
}
.ia-panel.open { display: flex; animation: ia-in .2s ease; }
@keyframes ia-in { from { opacity:0; transform: translateY(12px) } to { opacity:1; transform:none } }

.ia-head { background: var(--ink, #0a0f1e); color:#fff; padding: 1rem 1.1rem; display:flex; align-items:center; gap:.7rem; }
.ia-head-mark { width:44px; height:44px; flex-shrink:0; display:block; }
.ia-head-mark svg { width:100%; height:100%; }
.ia-head-txt strong { display:block; font-size:.95rem; font-weight:800; }
.ia-head-txt span { font-size:.75rem; color: var(--fog,#aab3c8); display:flex; align-items:center; gap:.35rem; }
.ia-head-txt span::before { content:''; width:7px; height:7px; border-radius:50%; background: var(--green,#a6ff3e); }
.ia-close { margin-left:auto; background:transparent; border:none; color: var(--fog,#aab3c8); font-size:1.1rem; cursor:pointer; padding:.3rem; }
.ia-close:hover { color:#fff; }

.ia-body { flex:1; overflow-y:auto; padding: 1rem; background: #fbfcfd; }
.ia-body::-webkit-scrollbar { width:6px; }
.ia-body::-webkit-scrollbar-thumb { background: var(--line,#e4e8f0); border-radius:10px; }

.ia-msg { max-width: 88%; padding:.7rem .9rem; border-radius:14px; font-size:.87rem; line-height:1.5; margin-bottom:.7rem; }
.ia-msg a { color: var(--blue-dark,#1c5fd1); font-weight:600; text-decoration:underline; }
.ia-msg-bot { background:#fff; border:1px solid var(--line,#e4e8f0); border-bottom-left-radius:4px; color: var(--ink,#0a0f1e); }
.ia-msg-user { background: var(--ink,#0a0f1e); color:#fff; margin-left:auto; border-bottom-right-radius:4px; }

.ia-note { background:#eaf3ff; border:1px solid #cfe2fb; color:#1c4d8f; font-size:.8rem; line-height:1.5; padding:.75rem .85rem; border-radius:12px; margin-bottom:.8rem; }
.ia-note b { font-weight:700; }

.ia-chips { display:flex; flex-wrap:wrap; gap:.4rem; margin-bottom:.8rem; }
.ia-chip { background:#fff; border:1px solid var(--line,#e4e8f0); border-radius:20px; padding:.4rem .8rem; font-size:.78rem; cursor:pointer; color: var(--stone,#5b6779); font-family:inherit; text-align:left; }
.ia-chip:hover { border-color: var(--blue,#2f7ffa); color: var(--blue-dark,#1c5fd1); }

.ia-res { display:flex; gap:.7rem; align-items:center; background:#fff; border:1px solid var(--line,#e4e8f0); border-radius:14px; padding:.6rem; margin-bottom:.55rem; transition: border-color .15s ease, transform .15s ease; }
.ia-res:hover { border-color: var(--blue,#2f7ffa); transform: translateY(-2px); }
.ia-res-img { width:58px; height:58px; border-radius:10px; background-size:cover; background-position:center; flex-shrink:0; }
.ia-res-info { display:flex; flex-direction:column; min-width:0; flex:1; }
.ia-res-title { font-size:.83rem; font-weight:700; color: var(--ink,#0a0f1e); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ia-res-meta { font-size:.72rem; color: var(--stone,#5b6779); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ia-res-price { font-size:.8rem; font-weight:800; color: var(--ink,#0a0f1e); }
.ia-res-score { flex-shrink:0; text-align:center; font-size:.9rem; font-weight:800; color: var(--green-text,#4f8a1a); line-height:1.1; }
.ia-res-score small { display:block; font-size:.55rem; text-transform:uppercase; letter-spacing:.03em; color: var(--stone-light,#8a94a6); font-weight:700; }

.ia-cta { display:inline-flex; align-items:center; gap:.4rem; font-size:.8rem; font-weight:700; color: var(--blue-dark,#1c5fd1); margin: .1rem 0 .9rem; }

.ia-typing { display:flex; gap:4px; padding:.8rem .9rem; }
.ia-typing span { width:6px; height:6px; border-radius:50%; background: var(--stone-light,#8a94a6); animation: ia-dot 1.1s infinite; }
.ia-typing span:nth-child(2) { animation-delay:.15s }
.ia-typing span:nth-child(3) { animation-delay:.3s }
@keyframes ia-dot { 0%,60%,100% { opacity:.25; transform:translateY(0) } 30% { opacity:1; transform:translateY(-3px) } }

.ia-foot { border-top:1px solid var(--line,#e4e8f0); background:#fff; padding:.7rem; }
.ia-form { display:flex; gap:.5rem; align-items:center; }
.ia-input { flex:1; border:1px solid var(--line,#e4e8f0); border-radius:22px; padding:.65rem .9rem; font-size:.86rem; font-family:inherit; outline:none; background:#fbfcfd; }
.ia-input:focus { border-color: var(--blue,#2f7ffa); background:#fff; }
.ia-send { width:40px; height:40px; border-radius:50%; border:none; cursor:pointer; background: var(--green,#a6ff3e); color: var(--ink,#0a0f1e); font-size:.9rem; flex-shrink:0; }
.ia-send:hover { background: var(--green-dark,#74c71e); }
.ia-foot-hint { font-size:.68rem; color: var(--stone-light,#8a94a6); text-align:center; margin-top:.45rem; }

@media (max-width: 640px) {
    .ia-panel { right:10px; left:10px; width:auto; bottom:118px; height: calc(100vh - 140px); }
    .ia-fab-wrap { right:14px; bottom:14px; }
    .ia-callout { width: 190px; padding: .7rem .8rem; }
    .ia-callout p { font-size: .7rem; }
    .ia-fab { width: 88px; height: 88px; }
}
`;

// Logo del asistente dibujado a mano en SVG: apretón de manos en blanco dentro
// del círculo degradado verde→azul. Es estático (sin animación) y lleva dos
// detalles propios del asistente: un destello arriba a la derecha (IA) y una
// burbuja con "%" abajo a la izquierda (match), en vez de las flechas de
// permuta que usa el ícono del hero.
const IA_LOGO_SVG = `
<svg viewBox="-14 -14 148 148" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="iaGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#3ef07a"/>
      <stop offset="55%" stop-color="#17b8a6"/>
      <stop offset="100%" stop-color="#2f7ffa"/>
    </linearGradient>
  </defs>
  <circle cx="60" cy="60" r="38" fill="url(#iaGrad)" stroke="#fff" stroke-width="4"/>
  <g transform="translate(60,60) scale(2.4) translate(-12,-12)" fill="none" stroke="#fff"
     stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
    <path d="m11 17 2 2a1 1 0 1 0 3-3"/>
    <path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4"/>
    <path d="m21 3 1 11h-2"/>
    <path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3"/>
    <path d="M3 4h8"/>
  </g>
  <!-- Destello de IA -->
  <g transform="translate(90,4) scale(1.25)" fill="#3ef07a" stroke="#0d1424" stroke-width="0.8">
    <path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96l6.14-1.58A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0L14.06 8.5a2 2 0 0 0 1.44 1.44l6.14 1.58a.5.5 0 0 1 0 .96l-6.14 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z"/>
  </g>
  <!-- Burbuja de match con % -->
  <g transform="translate(-2,88)">
    <circle cx="16" cy="16" r="17" fill="#0d1424" stroke="#fff" stroke-width="3"/>
    <text x="16" y="21" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="14" font-weight="800" fill="#3ef07a">%</text>
  </g>
</svg>`;

const IA_HTML = `
<div class="ia-fab-wrap">
    <div class="ia-callout" id="ia-callout">
        <button class="ia-callout-x" id="ia-callout-x" aria-label="Cerrar aviso"><i class="fa-solid fa-xmark"></i></button>
        <strong>${IA_CONFIG.saludoTitulo}</strong>
        <p>${IA_CONFIG.saludoTexto}</p>
    </div>
    <button class="ia-fab" id="ia-fab" aria-label="Abrir asistente virtual con IA" title="Asistente virtual con IA">
        ${IA_LOGO_SVG}
        <span class="ia-fab-badge">IA</span>
        <span class="ia-fab-close"><i class="fa-solid fa-chevron-down"></i></span>
    </button>
</div>

<div class="ia-panel" id="ia-panel" role="dialog" aria-label="Asistente virtual de InmoPermutas">
    <div class="ia-head">
        <span class="ia-head-mark">${IA_LOGO_SVG}</span>
        <div class="ia-head-txt">
            <strong>Buscá tu oportunidad</strong>
            <span>${IA_CONFIG.nombre}</span>
        </div>
        <button class="ia-close" id="ia-close" aria-label="Cerrar asistente"><i class="fa-solid fa-xmark"></i></button>
    </div>

    <div class="ia-body" id="ia-body"></div>

    <div class="ia-foot">
        <form class="ia-form" id="ia-form">
            <input class="ia-input" id="ia-input" type="text" autocomplete="off"
                   placeholder="Escribilo a tu manera: casa en Córdoba hasta 300 mil">
            <button class="ia-send" type="submit" aria-label="Enviar"><i class="fa-solid fa-paper-plane"></i></button>
        </form>
        <p class="ia-foot-hint">También podés <a href="catalogo.html" style="color:inherit;text-decoration:underline;">buscar a mano en el catálogo</a>.</p>
    </div>
</div>
`;

const IA_SUGERENCIAS = [
    "Casa en Córdoba hasta 300 mil",
    "Departamento 2 dormitorios en Palermo",
    "Tengo una casa en Nordelta y quiero un depto en Palermo",
    "¿Cómo funciona una permuta?"
];

function iaMontar() {
    if (document.getElementById("ia-panel")) return;

    const estilo = document.createElement("style");
    estilo.textContent = IA_ESTILOS;
    document.head.appendChild(estilo);

    const cont = document.createElement("div");
    cont.innerHTML = IA_HTML;
    document.body.appendChild(cont);

    const panel = document.getElementById("ia-panel");
    const body = document.getElementById("ia-body");
    const fab = document.getElementById("ia-fab");
    const callout = document.getElementById("ia-callout");

    // Mensaje de bienvenida: deja claro que se puede buscar manual o con la IA.
    body.innerHTML = `
        <div class="ia-msg ia-msg-bot">¡Hola! Soy el asistente de InmoPermutas. Escribime <b>a tu manera</b> qué propiedad buscás o qué tenés para permutar, y te muestro las mejores coincidencias del catálogo.</div>
        <div class="ia-note"><b>Dos formas de buscar:</b> podés filtrar vos mismo por tipo, zona y precio en el <a href="catalogo.html">catálogo</a>, o contármelo acá en lenguaje común y yo te ordeno las opciones por afinidad.</div>
        <div class="ia-chips">${IA_SUGERENCIAS.map(s => `<button type="button" class="ia-chip">${s}</button>`).join("")}</div>
    `;

    function ocultarCallout() {
        callout.classList.add("hide");
        sessionStorage.setItem("iaCalloutCerrado", "1");
    }

    function abrir(estado) {
        panel.classList.toggle("open", estado);
        fab.classList.toggle("open", estado);
        if (estado) ocultarCallout();
        if (estado) setTimeout(() => document.getElementById("ia-input").focus(), 120);
    }

    fab.addEventListener("click", () => abrir(!panel.classList.contains("open")));
    document.getElementById("ia-close").addEventListener("click", () => abrir(false));
    document.getElementById("ia-callout-x").addEventListener("click", ocultarCallout);

    // Si ya lo cerró en esta sesión, no se lo volvemos a mostrar.
    if (sessionStorage.getItem("iaCalloutCerrado")) callout.classList.add("hide");

    // Chips de ejemplo
    body.addEventListener("click", e => {
        const chip = e.target.closest(".ia-chip");
        if (chip) iaEnviar(chip.innerText);
    });

    document.getElementById("ia-form").addEventListener("submit", e => {
        e.preventDefault();
        const input = document.getElementById("ia-input");
        const texto = input.value.trim();
        if (!texto) return;
        input.value = "";
        iaEnviar(texto);
    });
}

function iaAgregar(clase, html) {
    const body = document.getElementById("ia-body");
    const div = document.createElement("div");
    div.className = clase;
    div.innerHTML = html;
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
    return div;
}

async function iaEnviar(texto) {
    iaAgregar("ia-msg ia-msg-user", texto.replace(/</g, "&lt;"));

    const cargando = iaAgregar("ia-msg ia-msg-bot", '<div class="ia-typing"><span></span><span></span><span></span></div>');

    let respuesta = null;
    if (IA_CONFIG.endpoint) {
        respuesta = await iaConsultarEndpoint(texto);
    }
    if (!respuesta) {
        await new Promise(r => setTimeout(r, 450)); // pausa breve, se siente natural
        respuesta = iaResponder(texto);
    }

    cargando.remove();
    iaAgregar("ia-msg ia-msg-bot", respuesta.texto);

    if (respuesta.resultados && respuesta.resultados.length) {
        const body = document.getElementById("ia-body");
        const wrap = document.createElement("div");
        wrap.innerHTML = respuesta.resultados.map(iaTarjetaResultado).join("") +
            `<a class="ia-cta" href="${respuesta.link || "catalogo.html"}">Ver más opciones en el catálogo <i class="fa-solid fa-arrow-right"></i></a>`;
        body.appendChild(wrap);
        body.scrollTop = body.scrollHeight;
    }
}

// Hook opcional para un modelo real detrás de tu propio backend.
async function iaConsultarEndpoint(mensaje) {
    try {
        const props = getProperties();
        const res = await fetch(IA_CONFIG.endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mensaje, propiedades: props })
        });
        if (!res.ok) return null;
        const data = await res.json();
        const resultados = (data.ids || [])
            .map(id => props.find(p => p.id === id))
            .filter(Boolean)
            .map(p => ({ prop: p, score: 90 }));
        return { texto: data.texto || "", resultados };
    } catch (e) {
        return null; // si el backend falla, seguimos con el motor local
    }
}

document.addEventListener("DOMContentLoaded", iaMontar);