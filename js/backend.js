/* =========================================================================
   BACKEND — InmoPermutas (Firebase: Auth + Firestore)
   -------------------------------------------------------------------------
   Reemplaza el guardado en localStorage por una base de datos real:
   lo que publica una persona lo ve TODO el mundo, desde cualquier dispositivo.

   Incluye también las cuentas de usuario:
     - Ingresar con Google (cuenta de Gmail).
     - Ingresar / registrarse con email y contraseña.
     - La sesión queda guardada aunque cierres el navegador (persistencia LOCAL).
       Solo se cierra si la persona toca "Salir".

   Es autocontenido: carga solo el SDK de Firebase e inyecta su propio CSS.
   Para activarlo en una página alcanza con agregar, DESPUÉS de utils.js:

       <script src="js/backend.js"></script>

   >>> ANTES DE USARLO: completá IP_FIREBASE_CONFIG con los datos de tu
   >>> proyecto (Firebase → Configuración del proyecto → Tus apps → Web).
   ========================================================================= */

const IP_FIREBASE_CONFIG = {
    apiKey: "AIzaSyCouPwxUkbijunv5dOOhKjwnj5OXfB4XM4",
    authDomain: "inmopermutas-com.firebaseapp.com",
    projectId: "inmopermutas-com",
    storageBucket: "inmopermutas-com.firebasestorage.app",
    messagingSenderId: "879330514386",
    appId: "1:879330514386:web:ec2490725111c11187e40b"
};

// Colección de Firestore donde viven las propiedades publicadas.
const IP_COLECCION = "propiedades";

// Copia local de lo que hay en la base. Sirve para que el catálogo se pinte
// al instante al cambiar de página, sin esperar a la red. La fuente de verdad
// siempre es Firestore: apenas responde, se refresca la vista.
const IP_CACHE_KEY = "ip_props_cache";

const IP_SDK = "https://www.gstatic.com/firebasejs/10.12.2/";

// PAGOS (modo simple con links de Mercado Pago):
//   1) El usuario toca "Elegir plan" → se guarda el pedido en suscripciones/{uid}
//      (campo "pedido") y se lo manda al link de suscripción de Mercado Pago.
//   2) Vos ves el pago en Mercado Pago y activás el plan desde admin.html.
// El usuario NO puede activarse el plan solo: lo impiden las reglas de Firestore
// (archivo firestore.rules).

// Links de suscripción de cada plan (Mercado Pago → Suscripciones → Planes → Compartir link).
const IP_LINKS_MP = {
    pro:     "https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=fbe0b9d9838841599ee83e33b71e9f59",
    premium: "https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=aea36678569b4082bc192f5ca4761c04"
};

const IP_PLANES = {
    pro:     { nombre: "Pro",     max: 5 },
    premium: { nombre: "Premium", max: null }   // null = ilimitadas
};

// UIDs de Firebase que pueden entrar a admin.html (Authentication → Users → User UID).
// Si agregás uno, agregalo también en firestore.rules.
const IP_ADMINS = ["aU9gRjuTvWcDQ5NKu0yFnVg5vwe2"];

window.IP = { user: null, listo: false, error: null, propsCargadas: false };

// Se resuelve cuando Firebase termina de averiguar si hay una sesión guardada
// (o cuando el backend no está disponible). Evita confundir "todavía no sé si
// está logueado" con "no está logueado".
IP.authListo = new Promise(resolve => { IP._resolverAuth = resolve; });

function ipCargarScript(src) {
    return new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = src;
        s.onload = resolve;
        s.onerror = () => reject(new Error("No se pudo cargar " + src));
        document.head.appendChild(s);
    });
}

/* ----------------------------- Arranque ---------------------------------- */

IP.ready = (async function ipInit() {
    try {
        if (IP_FIREBASE_CONFIG.apiKey.startsWith("PEGA_ACA")) {
            throw new Error("Falta completar IP_FIREBASE_CONFIG en js/backend.js");
        }

        await ipCargarScript(IP_SDK + "firebase-app-compat.js");
        await Promise.all([
            ipCargarScript(IP_SDK + "firebase-auth-compat.js"),
            ipCargarScript(IP_SDK + "firebase-firestore-compat.js"),
            ipCargarScript(IP_SDK + "firebase-storage-compat.js"),
            ipCargarScript(IP_SDK + "firebase-functions-compat.js")
        ]);

        firebase.initializeApp(IP_FIREBASE_CONFIG);
        IP.auth = firebase.auth();
        IP.db = firebase.firestore();
        IP.storage = firebase.storage();
        // Si Storage no responde, fallar en 30 s con un error claro en vez de
        // reintentar en silencio durante 10 minutos (el valor por defecto).
        IP.storage.setMaxUploadRetryTime(30000);
        IP.storage.setMaxOperationRetryTime(30000);

        // La sesión sobrevive a cerrar la pestaña y el navegador.
        await IP.auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);

        IP.auth.onAuthStateChanged(user => {
            IP.user = user;
            ipRegistrarUsuario(user);
            ipEscucharPlan(user);
            ipPintarSesion();
            document.dispatchEvent(new CustomEvent("ip-auth", { detail: user }));
            IP._resolverAuth();
        });

        ipEscucharPropiedades();
        IP.listo = true;
    } catch (e) {
        // Si la base no está disponible el sitio no se rompe: sigue mostrando
        // las propiedades de ejemplo de data.js, pero no se puede publicar.
        console.warn("[InmoPermutas] Backend no disponible:", e.message);
        IP.error = e;
        document.dispatchEvent(new CustomEvent("ip-auth", { detail: null }));
        IP._resolverAuth();
    }
    ipPintarSesion();
})();

/* --------------------------- Propiedades --------------------------------- */

// Escucha en vivo: si otra persona publica algo, aparece sin recargar.
function ipEscucharPropiedades() {
    IP.db.collection(IP_COLECCION)
        .orderBy("createdAt", "desc")
        .onSnapshot(snap => {
            const props = snap.docs.map(doc => {
                const d = doc.data();
                return {
                    id: doc.id,
                    title: d.title,
                    type: d.type,
                    location: d.location,
                    city: d.city,
                    departamento: d.departamento || "",
                    localidad: d.localidad || "",
                    barrio: d.barrio || "",
                    price: Number(d.price) || 0,
                    currency: d.currency || "U$S",
                    bedrooms: Number(d.bedrooms) || 0,
                    area: Number(d.area) || 0,
                    // Opcionales: 0 = no cargada (no se muestra en la ficha)
                    superficieCubierta: Number(d.superficieCubierta) || 0,
                    superficieTerreno: Number(d.superficieTerreno) || 0,
                    image: d.image,
                    // Fotos y videos subidos por el usuario: [{ type: 'image'|'video', url, name }]
                    media: Array.isArray(d.media) ? d.media : [],
                    seller: d.seller || { name: "Propietario", avatar: "", phone: "" },
                    wants: d.wants || { types: [], locations: [] },
                    ownerUid: d.ownerUid
                };
            });
            IP.propsCargadas = true;
            try {
                localStorage.setItem(IP_CACHE_KEY, JSON.stringify(props));
            } catch (e) { /* si no hay espacio, seguimos igual */ }
            if (typeof refrescarVista === "function") refrescarVista();
        }, err => console.warn("[InmoPermutas] Error leyendo propiedades:", err));
}

// Guarda una propiedad nueva. Devuelve el id del documento creado.
IP.publicarPropiedad = async function (datos) {
    if (!IP.user) throw new Error("Tenés que iniciar sesión para publicar.");
    const ref = await IP.db.collection(IP_COLECCION).add({
        ...datos,
        ownerUid: IP.user.uid,
        ownerEmail: IP.user.email || "",
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    return ref.id;
};

/* ------------------------ Plan del usuario -------------------------------- */

// El plan vive en Firestore → suscripciones/{uid}. Lo activa el admin.
//   IP.plan   = { plan, nombre, max, vence: Date }  |  null si no tiene plan
//   IP.pedido = { plan, nombre, fecha }            |  null si no pidió nada
IP.plan = null;
IP.pedido = null;
IP.planCargado = false;
let ipDesuscribirPlan = null;

IP.esAdmin = () => !!(IP.user && IP_ADMINS.includes(IP.user.uid));

// Deja registrado a cada usuario en "usuarios/{uid}" para que aparezca en el panel admin.
function ipRegistrarUsuario(user) {
    if (!user) return;
    const alta = user.metadata && user.metadata.creationTime ? new Date(user.metadata.creationTime) : new Date();
    IP.db.collection("usuarios").doc(user.uid).set({
        email: user.email || "",
        nombre: user.displayName || (user.email || "").split("@")[0],
        foto: user.photoURL || "",
        alta: firebase.firestore.Timestamp.fromDate(alta),
        ultimoIngreso: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true }).catch(e => console.warn("[InmoPermutas] No se pudo registrar el usuario:", e.code));
}

function ipAvisarPlan() {
    document.dispatchEvent(new CustomEvent("ip-plan"));
}

function ipEscucharPlan(user) {
    if (ipDesuscribirPlan) { ipDesuscribirPlan(); ipDesuscribirPlan = null; }
    IP.plan = null;
    IP.pedido = null;
    if (!user) {
        IP.planCargado = true;
        ipAvisarPlan();
        return;
    }
    IP.planCargado = false;
    ipDesuscribirPlan = IP.db.collection("suscripciones").doc(user.uid).onSnapshot(doc => {
        const d = doc.exists ? doc.data() : null;
        IP.plan = d && d.vence ? {
            plan: d.plan,
            nombre: d.nombrePlan || d.plan,
            max: d.maxPropiedades || null,   // null = ilimitadas
            vence: d.vence.toDate()
        } : null;
        IP.pedido = d && d.pedido && IP_PLANES[d.pedido] ? {
            plan: d.pedido,
            nombre: IP_PLANES[d.pedido].nombre,
            fecha: d.pedidoAt ? d.pedidoAt.toDate() : new Date()
        } : null;
        IP.planCargado = true;
        ipAvisarPlan();
    }, err => {
        console.warn("[InmoPermutas] Error leyendo el plan:", err);
        IP.plan = null;
        IP.planCargado = true;
        ipAvisarPlan();
    });
}

// Devuelve el plan si está vigente; si no tiene plan o ya venció, null.
IP.planActivo = function () {
    return IP.plan && IP.plan.vence > new Date() ? IP.plan : null;
};

// Guarda el pedido del plan y manda al usuario a pagar a Mercado Pago.
// El plan se activa cuando el admin confirma el pago desde admin.html.
IP.comprarPlan = async function (planId) {
    await IP.ready;
    await IP.authListo;
    if (IP.error) throw new Error("El sistema no está disponible en este momento.");
    if (!IP.user) throw new Error("Tenés que iniciar sesión para elegir un plan.");
    if (!IP_PLANES[planId] || !IP_LINKS_MP[planId]) throw new Error("Plan inválido.");

    await IP.db.collection("suscripciones").doc(IP.user.uid).set({
        pedido: planId,
        pedidoAt: firebase.firestore.FieldValue.serverTimestamp(),
        email: IP.user.email || "",
        nombre: IP.nombreUsuario()
    }, { merge: true });
    window.location.href = IP_LINKS_MP[planId];
    return { redirigiendo: true };
};

IP.linkPago = planId => IP_LINKS_MP[planId];

/* ---------------------------- Panel admin --------------------------------- */

const IP_DIA = 24 * 60 * 60 * 1000;

IP.admin = {
    // Junta usuarios, suscripciones y cantidad de propiedades en una sola lista.
    async listar() {
        if (!IP.esAdmin()) throw new Error("No sos administrador.");
        const [us, subs, props] = await Promise.all([
            IP.db.collection("usuarios").get(),
            IP.db.collection("suscripciones").get(),
            IP.db.collection(IP_COLECCION).get()
        ]);
        const mapa = {};
        const fila = uid => mapa[uid] || (mapa[uid] = { uid, email: "", nombre: "", props: 0 });

        us.forEach(d => {
            const u = d.data(), f = fila(d.id);
            f.email = u.email || f.email;
            f.nombre = u.nombre || f.nombre;
            f.foto = u.foto || "";
            f.alta = u.alta ? u.alta.toDate() : null;
            f.ultimoIngreso = u.ultimoIngreso ? u.ultimoIngreso.toDate() : null;
        });
        subs.forEach(d => {
            const s = d.data(), f = fila(d.id);
            f.plan = s.plan || null;
            f.vence = s.vence ? s.vence.toDate() : null;
            f.pedido = s.pedido || null;
            f.pedidoAt = s.pedidoAt ? s.pedidoAt.toDate() : null;
            f.email = f.email || s.email || "";
            f.nombre = f.nombre || s.nombre || "";
        });
        props.forEach(d => {
            const p = d.data();
            if (!p.ownerUid) return;
            const f = fila(p.ownerUid);
            f.props++;
            f.email = f.email || p.ownerEmail || "";
            f.nombre = f.nombre || (p.seller && p.seller.name) || "";
        });

        const ahora = new Date();
        return Object.values(mapa).map(f => {
            if (f.vence && f.vence > ahora) f.estado = "activo";
            else if (f.pedido || f.vence) f.estado = "debe";   // pidió y no está activo, o se le venció
            else f.estado = "inactivo";
            f.dias = f.vence ? Math.ceil((f.vence - ahora) / IP_DIA) : null;
            return f;
        });
    },

    // Activa (o renueva) un plan por X días. Si ya estaba activo, suma a partir del vencimiento.
    async activar(uid, planId, dias = 30) {
        const plan = IP_PLANES[planId];
        if (!plan) throw new Error("Plan inválido.");
        const ref = IP.db.collection("suscripciones").doc(uid);
        const doc = await ref.get();
        const actual = doc.exists && doc.data().vence ? doc.data().vence.toDate() : null;
        const desde = actual && actual > new Date() ? actual : new Date();
        await ref.set({
            plan: planId,
            nombrePlan: plan.nombre,
            maxPropiedades: plan.max,
            vence: firebase.firestore.Timestamp.fromDate(new Date(desde.getTime() + dias * IP_DIA)),
            pedido: firebase.firestore.FieldValue.delete(),
            pedidoAt: firebase.firestore.FieldValue.delete(),
            prueba: firebase.firestore.FieldValue.delete(),
            activadoAt: firebase.firestore.FieldValue.serverTimestamp(),
            activadoPor: IP.user.email || IP.user.uid
        }, { merge: true });
    },

    // Corta el plan ahora mismo (queda como "debe pagar").
    async desactivar(uid) {
        await IP.db.collection("suscripciones").doc(uid).set({
            vence: firebase.firestore.Timestamp.now(),
            pedido: firebase.firestore.FieldValue.delete(),
            pedidoAt: firebase.firestore.FieldValue.delete()
        }, { merge: true });
    },

    // Descarta un pedido (por ejemplo, si nunca pagó).
    async descartarPedido(uid) {
        await IP.db.collection("suscripciones").doc(uid).set({
            pedido: firebase.firestore.FieldValue.delete(),
            pedidoAt: firebase.firestore.FieldValue.delete()
        }, { merge: true });
    }
};

/* ------------------- Mis propiedades: leer, editar, borrar ---------------- */

// Trae una publicación directamente de la base (sirve para el link de edición).
IP.obtenerPropiedad = async function (id) {
    const doc = await IP.db.collection(IP_COLECCION).doc(String(id)).get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
};

IP.actualizarPropiedad = async function (id, datos) {
    if (!IP.user) throw new Error("Tenés que iniciar sesión para editar.");
    await IP.db.collection(IP_COLECCION).doc(String(id)).update({
        ...datos,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
};

// Borra archivos de Storage por su ruta. Si alguno ya no existe, se ignora.
IP.borrarArchivos = async function (paths) {
    await Promise.all((paths || []).filter(Boolean).map(ruta =>
        IP.storage.ref().child(ruta).delete().catch(e => console.warn("[InmoPermutas] No se pudo borrar", ruta, e.code))
    ));
};

IP.eliminarPropiedad = async function (id) {
    if (!IP.user) throw new Error("Tenés que iniciar sesión.");
    const ref = IP.db.collection(IP_COLECCION).doc(String(id));
    const doc = await ref.get();
    if (!doc.exists) return;
    const d = doc.data();
    if (d.ownerUid !== IP.user.uid) throw new Error("Solo podés eliminar tus propias publicaciones.");
    await ref.delete();
    await IP.borrarArchivos((d.media || []).map(m => m.path));
};

// Cuántas propiedades tiene publicadas el usuario (para el tope de su plan).
IP.contarMisPropiedades = async function () {
    if (!IP.user) return 0;
    const snap = await IP.db.collection(IP_COLECCION).where("ownerUid", "==", IP.user.uid).get();
    return snap.size;
};

/* -------------------------- Fotos y videos -------------------------------- */

// Sube una lista de archivos (File) a Firebase Storage, en una carpeta propia
// de cada usuario, y devuelve sus datos en el MISMO ORDEN en que se pasaron:
//   [{ type: 'image'|'video', url, name, path }, ...]
// Ese orden es el que usa publicar.html para saber cuál es la "foto principal".
IP.subirArchivos = async function (files, onProgress) {
    if (!IP.storage) throw new Error("Falta configurar Firebase Storage.");
    if (!IP.user) throw new Error("Tenés que iniciar sesión para subir fotos y videos.");

    const total = files.reduce((acc, f) => acc + f.size, 0) || 1;
    const enviados = files.map(() => 0);
    const avisar = () => {
        if (onProgress) onProgress(Math.min(100, Math.round(enviados.reduce((a, n) => a + n, 0) / total * 100)));
    };

    const subidas = await Promise.all(files.map((file, i) => new Promise((resolve, reject) => {
        const esVideo = file.type.startsWith("video");
        const nombreSeguro = `${Date.now()}_${i}_${file.name}`.replace(/[^\w.\-]/g, "_");
        const ruta = `propiedades/${IP.user.uid}/${nombreSeguro}`;
        const ref = IP.storage.ref().child(ruta);
        const task = ref.put(file, { cacheControl: "public,max-age=31536000" });

        task.on("state_changed",
            snap => { enviados[i] = snap.bytesTransferred; avisar(); },
            reject,
            async () => {
                try {
                    enviados[i] = file.size; avisar();
                    const url = await task.snapshot.ref.getDownloadURL();
                    resolve({ type: esVideo ? "video" : "image", url, name: file.name, path: ruta });
                } catch (e) { reject(e); }
            });
    })));

    return subidas;
};

/* ------------------------------- Cuentas --------------------------------- */

IP.loginGoogle = async function () {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    try {
        await IP.auth.signInWithPopup(provider);
    } catch (e) {
        // Si el navegador bloquea la ventana emergente, vamos por redirección.
        if (e.code === "auth/popup-blocked" || e.code === "auth/cancelled-popup-request") {
            await IP.auth.signInWithRedirect(provider);
            return;
        }
        throw e;
    }
};

IP.registrarMail = async function (nombre, email, password) {
    const cred = await IP.auth.createUserWithEmailAndPassword(email, password);
    if (nombre) await cred.user.updateProfile({ displayName: nombre });
    return cred.user;
};

IP.loginMail = function (email, password) {
    return IP.auth.signInWithEmailAndPassword(email, password);
};

IP.recuperarPassword = function (email) {
    return IP.auth.sendPasswordResetEmail(email);
};

IP.logout = function () {
    return IP.auth.signOut().then(() => window.location.reload());
};

IP.nombreUsuario = function () {
    if (!IP.user) return "";
    return IP.user.displayName || (IP.user.email || "").split("@")[0];
};

// Mensajes de error en castellano, en vez del código crudo de Firebase.
IP.mensajeError = function (e) {
    const m = {
        "auth/invalid-email": "El email no parece válido.",
        "auth/missing-password": "Escribí una contraseña.",
        "auth/weak-password": "La contraseña tiene que tener al menos 6 caracteres.",
        "auth/email-already-in-use": "Ya existe una cuenta con ese email. Probá ingresando.",
        "auth/invalid-credential": "Email o contraseña incorrectos.",
        "auth/wrong-password": "Email o contraseña incorrectos.",
        "auth/user-not-found": "No encontramos una cuenta con ese email.",
        "auth/too-many-requests": "Demasiados intentos. Esperá unos minutos.",
        "auth/popup-closed-by-user": "Cerraste la ventana de Google antes de terminar.",
        "auth/unauthorized-domain": "Este dominio no está habilitado en Firebase → Authentication → Settings."
    };
    return m[e && e.code] || (e && e.message) || "Algo salió mal. Probá de nuevo.";
};

/* ------------------- Chip de sesión en el header -------------------------- */

function ipPintarSesion() {
    document.querySelectorAll(".nav-actions").forEach(cont => {
        let chip = cont.querySelector(".ip-user-chip");
        let mis = cont.querySelector(".ip-mis-link");
        let adm = cont.querySelector(".ip-admin-link");
        if (!IP.user) {
            if (chip) chip.remove();
            if (mis) mis.remove();
            if (adm) adm.remove();
            return;
        }
        if (IP.esAdmin() && !adm) {
            adm = document.createElement("a");
            adm.className = "btn btn-outline btn-sm ip-admin-link";
            adm.href = "admin.html";
            adm.innerHTML = '<i class="fa-solid fa-user-shield"></i> Admin';
            cont.insertBefore(adm, cont.firstChild);
        }
        if (!chip) {
            chip = document.createElement("div");
            chip.className = "ip-user-chip";
            cont.appendChild(chip);
        }
        if (!mis) {
            mis = document.createElement("a");
            mis.className = "btn btn-outline btn-sm ip-mis-link";
            mis.href = "mis-propiedades.html";
            mis.innerHTML = '<i class="fa-solid fa-house-user"></i> Mis propiedades';
            cont.insertBefore(mis, chip);
        }
        const foto = IP.user.photoURL
            ? `<img src="${IP.user.photoURL}" alt="">`
            : `<span class="ip-user-ini">${IP.nombreUsuario().charAt(0).toUpperCase()}</span>`;
        chip.innerHTML = `
            ${foto}
            <span class="ip-user-name">${IP.nombreUsuario()}</span>
            <button type="button" class="ip-logout" title="Cerrar sesión" onclick="IP.logout()">
                <i class="fa-solid fa-right-from-bracket"></i>
            </button>`;
    });
}

/* ------------------------------ Estilos ---------------------------------- */

const IP_CSS = `
.ip-user-chip {
    display: inline-flex; align-items: center; gap: 0.5rem;
    padding: 0.3rem 0.45rem 0.3rem 0.35rem;
    border: 1px solid var(--ink-line, rgba(255,255,255,0.12));
    border-radius: 30px; background: rgba(255,255,255,0.04);
    font-size: 0.82rem; font-weight: 600; color: #fff; max-width: 210px;
}
.ip-user-chip img, .ip-user-ini {
    width: 28px; height: 28px; border-radius: 50%; object-fit: cover; flex-shrink: 0;
    display: inline-flex; align-items: center; justify-content: center;
    background: linear-gradient(135deg, #3ef07a, #2f7ffa); color: #0a0f1e; font-weight: 800;
}
.ip-user-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ip-logout {
    background: transparent; border: none; color: var(--stone, #aab3c8);
    cursor: pointer; padding: 0.2rem 0.3rem; font-size: 0.9rem;
}
.ip-logout:hover { color: #ff5470; }

.ip-auth-card {
    max-width: 440px; margin: 0 auto 3rem;
    background: #121b30; border: 1px solid var(--ink-line, rgba(255,255,255,0.12));
    border-radius: var(--radius-lg, 20px); padding: 2.25rem; text-align: center;
    box-shadow: var(--shadow, 0 4px 20px rgba(0,0,0,0.45));
}
.ip-auth-card h2 { font-size: 1.35rem; margin-bottom: 0.4rem; }
.ip-auth-card .ip-auth-sub { color: var(--stone, #aab3c8); font-size: 0.92rem; margin-bottom: 1.6rem; }

.ip-google-btn {
    width: 100%; display: inline-flex; align-items: center; justify-content: center; gap: 0.65rem;
    background: #ffffff; color: #1f1f1f; border: none; border-radius: 30px;
    padding: 0.75rem 1.2rem; font-size: 0.92rem; font-weight: 700; cursor: pointer;
    font-family: inherit; transition: opacity 0.15s ease;
}
.ip-google-btn:hover { opacity: 0.9; }
.ip-google-btn svg { width: 18px; height: 18px; flex-shrink: 0; }

.ip-sep {
    display: flex; align-items: center; gap: 0.75rem;
    color: var(--stone-light, #8a94a6); font-size: 0.75rem; text-transform: uppercase;
    letter-spacing: 0.08em; margin: 1.4rem 0;
}
.ip-sep::before, .ip-sep::after {
    content: ''; flex: 1; height: 1px; background: var(--ink-line, rgba(255,255,255,0.12));
}

.ip-tabs { display: flex; gap: 0.4rem; margin-bottom: 1.25rem; }
.ip-tab {
    flex: 1; padding: 0.55rem; border-radius: var(--radius-sm, 8px);
    background: transparent; border: 1px solid var(--ink-line, rgba(255,255,255,0.12));
    color: var(--stone, #aab3c8); font-weight: 700; font-size: 0.85rem;
    cursor: pointer; font-family: inherit;
}
.ip-tab.active { background: rgba(62,240,122,0.12); border-color: #3ef07a; color: #3ef07a; }

.ip-auth-card .form-field { text-align: left; margin-bottom: 0.9rem; }

.ip-auth-error {
    display: none; background: rgba(255,84,112,0.12); border: 1px solid #ff5470;
    color: #ff8fa3; border-radius: var(--radius-sm, 8px); padding: 0.7rem 0.9rem;
    font-size: 0.85rem; margin-bottom: 1rem; text-align: left;
}
.ip-auth-error.show { display: block; }
.ip-auth-link {
    background: none; border: none; color: var(--stone, #aab3c8); font-family: inherit;
    font-size: 0.8rem; text-decoration: underline; cursor: pointer; margin-top: 1rem;
}
.ip-auth-link:hover { color: #3ef07a; }

/* Publicar bloqueado hasta contratar un plan */
.ip-lock-wrap { position: relative; }
.ip-lock-wrap.locked .form-card { filter: blur(7px); opacity: 0.7; pointer-events: none; user-select: none; }
.ip-lock-overlay { display: none; position: absolute; inset: 0; z-index: 5; padding: 1rem; }
.ip-lock-wrap.locked .ip-lock-overlay { display: block; }
.ip-lock-box {
    position: sticky; top: 120px; max-width: 440px; margin: 3rem auto 0;
    background: #121b30; border: 1px solid rgba(62,240,122,0.45);
    border-radius: var(--radius-lg, 20px); padding: 2rem 1.75rem; text-align: center;
    box-shadow: 0 10px 40px rgba(0,0,0,0.6);
}
.ip-lock-icon {
    width: 54px; height: 54px; border-radius: 50%; margin: 0 auto 1rem;
    display: flex; align-items: center; justify-content: center; font-size: 1.3rem;
    color: #3ef07a; background: rgba(62,240,122,0.12); border: 1px solid rgba(62,240,122,0.5);
}
.ip-lock-box h2 { font-size: 1.3rem; margin-bottom: 0.6rem; color: #fff; }
.ip-lock-box p { color: var(--stone, #aab3c8); font-size: 0.92rem; line-height: 1.55; margin-bottom: 1.25rem; }

/* Barra con el estado del plan */
.ip-plan-bar {
    display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap;
    background: rgba(62,240,122,0.08); border: 1px solid rgba(62,240,122,0.35);
    border-radius: var(--radius-md, 14px); padding: 0.85rem 1.1rem; margin-bottom: 1.5rem;
    font-size: 0.9rem; color: #fff;
}
.ip-plan-bar i { color: #3ef07a; margin-right: 0.4rem; }
.ip-plan-bar--off { background: rgba(255,84,112,0.08); border-color: rgba(255,84,112,0.4); }
.ip-plan-bar--off i { color: #ff5470; }

/* Mis propiedades */
.ip-mis-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; padding: 0 1.25rem 1.25rem; }
.ip-mis-actions .btn { flex: 1; justify-content: center; text-align: center; }
.btn-danger-outline {
    background: transparent; border: 1px solid rgba(255,84,112,0.55); color: #ff8fa3;
    border-radius: var(--radius-sm, 8px); cursor: pointer; font-family: inherit; font-weight: 700;
}
.btn-danger-outline:hover { background: rgba(255,84,112,0.12); border-color: #ff5470; color: #ff5470; }
.btn-danger-outline:disabled { opacity: 0.5; cursor: wait; }

/* Ojo para mostrar/ocultar contraseñas */
.ip-pass-wrap { position: relative; display: block; width: 100%; }
.form-field .ip-pass-wrap input, .ip-pass-wrap input { padding-right: 2.9rem; }
.ip-pass-toggle {
    position: absolute; top: 0; right: 0; bottom: 0; width: 2.9rem;
    display: flex; align-items: center; justify-content: center;
    background: transparent; border: none; border-radius: 0 var(--radius-sm, 8px) var(--radius-sm, 8px) 0;
    color: var(--stone, #aab3c8); font-size: 1rem; cursor: pointer;
}
.ip-pass-toggle:hover { color: #fff; }
.ip-pass-toggle:focus-visible { outline: 2px solid #3ef07a; outline-offset: -2px; color: #3ef07a; }
.ip-pass-toggle[aria-pressed="true"] { color: #3ef07a; }
/* Edge/IE traen su propio ojo: lo ocultamos para que no aparezcan dos. */
input[type="password"]::-ms-reveal, input[type="password"]::-ms-clear { display: none; }
`;

(function ipInyectarCSS() {
    const st = document.createElement("style");
    st.textContent = IP_CSS;
    document.head.appendChild(st);
})();

/* ------------------- Ojo en los campos de contraseña ---------------------- */

// Envuelve cada <input type="password"> con un botón de ojo que alterna entre
// oculto (password) y visible (text). Se aplica solo a TODOS los campos de
// contraseña de la página (registro, ingreso y cualquier otro que se agregue),
// y se puede volver a llamar con IP.activarOjoPassword(contenedor) si se crea
// un formulario después de que cargó la página.
// Íconos propios (SVG) para no depender de que cargue Font Awesome.
const IP_OJO_ABIERTO = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const IP_OJO_TACHADO = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.9 17.9A10.9 10.9 0 0 1 12 19C5.6 19 2 12 2 12a18.7 18.7 0 0 1 5.1-5.9M9.9 5.2A10 10 0 0 1 12 5c6.4 0 10 7 10 7a18.8 18.8 0 0 1-2.2 3.2M14.1 14.1a3 3 0 1 1-4.2-4.2"/><path d="M2 2l20 20"/></svg>';

IP.activarOjoPassword = function (raiz) {
    (raiz || document).querySelectorAll('input[type="password"]:not([data-ip-ojo])').forEach(input => {
        input.setAttribute("data-ip-ojo", "1");

        const wrap = document.createElement("div");
        wrap.className = "ip-pass-wrap";
        input.parentNode.insertBefore(wrap, input);
        wrap.appendChild(input);

        const btn = document.createElement("button");
        btn.type = "button";               // que nunca envíe el formulario
        btn.className = "ip-pass-toggle";
        btn.setAttribute("aria-pressed", "false");
        btn.setAttribute("aria-label", "Mostrar contraseña");
        btn.title = "Mostrar contraseña";
        btn.innerHTML = IP_OJO_ABIERTO;
        wrap.appendChild(btn);

        // Evita que el toque en el ojo le saque el foco al campo (y cierre el teclado en el celular).
        btn.addEventListener("mousedown", e => e.preventDefault());
        btn.addEventListener("click", () => {
            const visible = input.type === "password";
            const teniaFoco = document.activeElement === input;
            const ini = input.selectionStart, fin = input.selectionEnd;
            input.type = visible ? "text" : "password";
            // Con la contraseña a la vista, el teclado no debe autocorregirla.
            input.setAttribute("autocapitalize", "off");
            input.setAttribute("autocorrect", "off");
            input.setAttribute("spellcheck", "false");
            btn.setAttribute("aria-pressed", String(visible));
            const texto = visible ? "Ocultar contraseña" : "Mostrar contraseña";
            btn.setAttribute("aria-label", texto);
            btn.title = texto;
            btn.innerHTML = visible ? IP_OJO_TACHADO : IP_OJO_ABIERTO;
            if (teniaFoco) {
                input.focus();
                try { input.setSelectionRange(ini, fin); } catch (e) { /* algunos navegadores no lo permiten */ }
            }
        });
    });
};

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => IP.activarOjoPassword());
} else {
    IP.activarOjoPassword();
}

// Logo de Google, para el botón. Se usa desde publicar.html.
const IP_GOOGLE_SVG = `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
<path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.9 2.4 30.4 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.2 17.7 9.5 24 9.5z"/>
<path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9.1h12.4c-.5 2.9-2.1 5.3-4.6 6.9l7.2 5.6c4.2-3.9 6.6-9.6 6.6-17z"/>
<path fill="#FBBC05" d="M10.5 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C1 16.3 0 20 0 24s1 7.7 2.6 10.8l7.9-6.1z"/>
<path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.2-5.6c-2 1.4-4.6 2.2-8.7 2.2-6.3 0-11.6-3.7-13.5-9.1l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/>
</svg>`;