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

window.IP = { user: null, listo: false, error: null };

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
            ipCargarScript(IP_SDK + "firebase-storage-compat.js")
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
            ipPintarSesion();
            document.dispatchEvent(new CustomEvent("ip-auth", { detail: user }));
        });

        ipEscucharPropiedades();
        IP.listo = true;
    } catch (e) {
        // Si la base no está disponible el sitio no se rompe: sigue mostrando
        // las propiedades de ejemplo de data.js, pero no se puede publicar.
        console.warn("[InmoPermutas] Backend no disponible:", e.message);
        IP.error = e;
        document.dispatchEvent(new CustomEvent("ip-auth", { detail: null }));
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
                    price: Number(d.price) || 0,
                    currency: d.currency || "US$",
                    bedrooms: Number(d.bedrooms) || 0,
                    area: Number(d.area) || 0,
                    image: d.image,
                    // Fotos y videos subidos por el usuario: [{ type: 'image'|'video', url, name }]
                    media: Array.isArray(d.media) ? d.media : [],
                    seller: d.seller || { name: "Propietario", avatar: "", phone: "" },
                    wants: d.wants || { types: [], locations: [] },
                    ownerUid: d.ownerUid
                };
            });
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
        if (!IP.user) {
            if (chip) chip.remove();
            return;
        }
        if (!chip) {
            chip = document.createElement("div");
            chip.className = "ip-user-chip";
            cont.appendChild(chip);
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
`;

(function ipInyectarCSS() {
    const st = document.createElement("style");
    st.textContent = IP_CSS;
    document.head.appendChild(st);
})();

// Logo de Google, para el botón. Se usa desde publicar.html.
const IP_GOOGLE_SVG = `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
<path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.9 2.4 30.4 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.2 17.7 9.5 24 9.5z"/>
<path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9.1h12.4c-.5 2.9-2.1 5.3-4.6 6.9l7.2 5.6c4.2-3.9 6.6-9.6 6.6-17z"/>
<path fill="#FBBC05" d="M10.5 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C1 16.3 0 20 0 24s1 7.7 2.6 10.8l7.9-6.1z"/>
<path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.2-5.6c-2 1.4-4.6 2.2-8.7 2.2-6.3 0-11.6-3.7-13.5-9.1l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/>
</svg>`;