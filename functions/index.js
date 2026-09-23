/* =========================================================================
   Cloud Functions — InmoPermutas × Mercado Pago (Suscripciones)

   Flujo:
     1) planes.html carga el Brick de tarjeta de Mercado Pago (Public Key,
        NO es secreto) y obtiene un card_token_id sin que la tarjeta pase
        nunca por nuestro servidor.
     2) Con ese token, el frontend llama a crearSuscripcion({ plan, cardTokenId }).
        Esta función crea la suscripción en Mercado Pago (API preapproval) con
        30 días de prueba gratis y la deja "authorized": no se cobra nada
        hasta que termine la prueba.
     3) Guardamos el estado en users/{uid}. Mercado Pago avisa TODO lo que
        pasa después (fin de la prueba, cobro aprobado, rechazado, etc.) al
        webhook. La función NO se fía del aviso: vuelve a consultar el
        recurso real a la API de Mercado Pago con el token y recién ahí
        actualiza Firestore.
     4) El usuario puede cancelar en cualquier momento con cancelarSuscripcion().

   El Access Token de Mercado Pago NUNCA va en el sitio web: vive como
   secreto de Firebase (ver los pasos de instalación al final del archivo).
   ========================================================================= */

const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");

admin.initializeApp();
const db = admin.firestore();

/* ------------------------------ AJUSTAR ---------------------------------- */

// Dominio real del sitio (con https). Mercado Pago vuelve acá después del pago.
const SITIO = "https://inmopermutas.com";

// Cada plan vive en el panel de Mercado Pago (Suscripciones → Planes): ahí
// están el precio, la moneda y los 30 días de prueba. Acá solo guardamos a
// qué plan de Mercado Pago corresponde cada uno de los nuestros.
// "max" = tope de propiedades activas que permite el plan (null = ilimitadas).
const PLANES = {
  pro:     { nombre: "Pro",     planId: "fbe0b9d9838841599ee83e33b71e9f59", max: 5 },
  premium: { nombre: "Premium", planId: "aea36678569b4082bc192f5ca4761c04", max: null },
};

// Única cuenta que puede convertirse en administrador (ver hacerseAdmin más
// abajo). Poné acá tu UID de Firebase (Authentication → Users → User UID).
const UID_ADMIN = "aU9gRjuTvWcDQ5NKu0yFnVg5vwe2";

const REGION = "us-central1";

/* ------------------------------------------------------------------------- */

const conSecreto = functions.runWith({ secrets: ["MP_ACCESS_TOKEN"] });

function authMP() {
  return { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` };
}

// Traduce el status de Mercado Pago a algo legible para mostrar en el sitio.
const ESTADO_MP = {
  authorized: "activa",
  pending: "pendiente",
  paused: "pausada",
  cancelled: "cancelada",
};

/* --------------------------- 1) Crear suscripción -------------------------- */

exports.crearSuscripcion = conSecreto.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Iniciá sesión para contratar un plan.");
  }
  const planId = data && data.plan;
  const plan = PLANES[planId];
  if (!plan) {
    throw new functions.https.HttpsError("invalid-argument", "Plan inválido.");
  }
  // cardTokenId es OPCIONAL:
  //  - si lo mandás (por ejemplo desde test-e2e.js), la suscripción queda
  //    autorizada al toque, sin que el usuario tenga que ir a ningún lado.
  //  - si NO lo mandás (caso normal del sitio), Mercado Pago devuelve un
  //    "init_point": un link personalizado (con el uid ya adentro) para que
  //    el usuario cargue la tarjeta en la página hospedada de MP.
  const cardTokenId = data && data.cardTokenId;

  const uid = context.auth.uid;
  const email = context.auth.token.email || "";

  // Si ya tiene una suscripción activa/en prueba, no dejamos crear otra.
  const actual = await db.collection("users").doc(uid).get();
  const estadoActual = actual.exists ? actual.data().subscriptionStatus : null;
  if (estadoActual === "prueba" || estadoActual === "activa") {
    throw new functions.https.HttpsError("failed-precondition", "Ya tenés una suscripción vigente.");
  }

  // Para pruebas en el emulador: permite apuntar a OTRO plan de MP (uno de
  // sandbox sin prueba gratis, por ejemplo) sin tocar la config real.
  // process.env.FUNCTIONS_EMULATOR lo pone Firebase automáticamente al correr
  // "firebase emulators:start" — en un deploy real esta variable no existe,
  // así que este atajo es imposible de activar por accidente en el sitio real.
  const enEmulador = process.env.FUNCTIONS_EMULATOR === "true";
  const preapprovalPlanId = (enEmulador && data.testPlanId) ? data.testPlanId : plan.planId;

  const cuerpo = {
    preapproval_plan_id: preapprovalPlanId,
    external_reference: uid,
    payer_email: email,
    back_url: `${SITIO}/mi-cuenta.html?sub=ok`,
    ...(cardTokenId ? { card_token_id: cardTokenId } : {}),
  };

  const resp = await fetch("https://api.mercadopago.com/preapproval", {
    method: "POST",
    headers: { ...authMP(), "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
  const json = await resp.json();
  if (!resp.ok || !json.id) {
    console.error("Mercado Pago rechazó la suscripción:", resp.status, json);
    throw new functions.https.HttpsError("internal", "No se pudo crear la suscripción.");
  }

  // Todas las fechas salen de la respuesta de Mercado Pago, no las calculamos
  // nosotros: si el plan tiene prueba gratis, next_payment_date YA es el día
  // que termina la prueba y se hace el primer cobro.
  const ahora = admin.firestore.Timestamp.now();
  const hayPrueba = !!(json.auto_recurring && json.auto_recurring.free_trial);
  const proximaFecha = json.next_payment_date
    ? admin.firestore.Timestamp.fromDate(new Date(json.next_payment_date))
    : null;

  await db.collection("users").doc(uid).set({
    email,
    subscriptionId: json.id,
    subscriptionStatus: json.status !== "authorized" ? "pendiente" : (hayPrueba ? "prueba" : "activa"),
    plan: planId,
    nombrePlan: plan.nombre,
    maxPropiedades: plan.max,
    trialStart: hayPrueba ? ahora : null,
    trialEnd: hayPrueba ? proximaFecha : null,
    currentPeriodStart: ahora,
    currentPeriodEnd: proximaFecha,
    nextPaymentDate: proximaFecha,
    lastPaymentDate: null,
    lastPaymentStatus: null,
    cancelAtPeriodEnd: false,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return { ok: true, status: json.status, initPoint: json.init_point || null };
});

/* --------------------------- 2) Cancelar suscripción ------------------------ */

exports.cancelarSuscripcion = conSecreto.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Iniciá sesión.");
  }
  const uid = context.auth.uid;
  const doc = await db.collection("users").doc(uid).get();
  const subscriptionId = doc.exists && doc.data().subscriptionId;
  if (!subscriptionId) {
    throw new functions.https.HttpsError("failed-precondition", "No tenés una suscripción para cancelar.");
  }

  const resp = await fetch(`https://api.mercadopago.com/preapproval/${encodeURIComponent(subscriptionId)}`, {
    method: "PUT",
    headers: { ...authMP(), "Content-Type": "application/json" },
    body: JSON.stringify({ status: "cancelled" }),
  });
  if (!resp.ok) {
    const json = await resp.json().catch(() => ({}));
    console.error("No se pudo cancelar la suscripción:", subscriptionId, resp.status, json);
    throw new functions.https.HttpsError("internal", "No se pudo cancelar. Probá de nuevo.");
  }

  // No esperamos al webhook para que la persona vea el cambio al instante;
  // el webhook igual va a confirmar el mismo estado apenas Mercado Pago avise.
  await db.collection("users").doc(uid).set({
    subscriptionStatus: "cancelada",
    cancelAtPeriodEnd: true,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return { ok: true };
});

/* --------------------------- 3) Webhook de Mercado Pago --------------------- */

exports.webhookSuscripcion = conSecreto.https.onRequest(async (req, res) => {
  try {
    const tipo = req.query.type || req.query.topic || (req.body && req.body.type);
    const recursoId =
      req.query["data.id"] ||
      (req.body && req.body.data && req.body.data.id);

    if (!recursoId) return res.status(200).send("ignorado");

    if (tipo === "subscription_preapproval") {
      await procesarPreapproval(recursoId);
      return res.status(200).send("ok");
    }

    if (tipo === "subscription_authorized_payment") {
      await procesarPago(recursoId);
      return res.status(200).send("ok");
    }

    // Otros avisos (merchant_order, etc.) se ignoran.
    return res.status(200).send("ignorado");
  } catch (e) {
    console.error("Error en webhookSuscripcion:", e);
    return res.status(500).send("error"); // Mercado Pago reintenta el aviso
  }
});

// Cambios de estado de la suscripción en sí (autorizada, pausada, cancelada...).
async function procesarPreapproval(preapprovalId) {
  const r = await fetch(`https://api.mercadopago.com/preapproval/${encodeURIComponent(preapprovalId)}`, {
    headers: authMP(),
  });
  if (!r.ok) { console.error("No se pudo consultar la suscripción", preapprovalId, r.status); return; }
  const sub = await r.json();
  const uid = sub.external_reference;
  if (!uid) { console.error("Suscripción sin external_reference:", preapprovalId); return; }

  const datos = { subscriptionStatus: ESTADO_MP[sub.status] || sub.status, updatedAt: admin.firestore.FieldValue.serverTimestamp() };
  if (sub.next_payment_date) {
    datos.nextPaymentDate = admin.firestore.Timestamp.fromDate(new Date(sub.next_payment_date));
  }
  await db.collection("users").doc(uid).set(datos, { merge: true });
}

// Cada cobro individual (el de fin de prueba y cada renovación mensual).
async function procesarPago(pagoId) {
  const r = await fetch(`https://api.mercadopago.com/authorized_payments/${encodeURIComponent(pagoId)}`, {
    headers: authMP(),
  });
  if (!r.ok) { console.error("No se pudo consultar el pago", pagoId, r.status); return; }
  const pago = await r.json();
  const preapprovalId = pago.preapproval_id;
  if (!preapprovalId) { console.error("Pago sin preapproval_id:", pagoId); return; }

  // El pago no trae el uid directo: lo sacamos de la suscripción asociada.
  const rSub = await fetch(`https://api.mercadopago.com/preapproval/${encodeURIComponent(preapprovalId)}`, {
    headers: authMP(),
  });
  const sub = rSub.ok ? await rSub.json() : null;
  const uid = sub && sub.external_reference;
  if (!uid) { console.error("No se pudo identificar al usuario del pago:", pagoId); return; }

  const ESTADO_PAGO = { approved: "activa", pending: "pago_pendiente", rejected: "pago_rechazado" };

  await db.runTransaction(async (tx) => {
    const pagoRef = db.collection("users").doc(uid).collection("pagos").doc(String(pagoId));
    const yaExiste = await tx.get(pagoRef);
    if (yaExiste.exists) return; // aviso repetido: ya lo procesamos

    tx.set(pagoRef, {
      monto: Number(pago.transaction_amount) || 0,
      estado: pago.status,
      fecha: admin.firestore.FieldValue.serverTimestamp(),
    });

    const userRef = db.collection("users").doc(uid);
    const datos = {
      lastPaymentStatus: pago.status,
      lastPaymentDate: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (ESTADO_PAGO[pago.status]) datos.subscriptionStatus = ESTADO_PAGO[pago.status];
    if (pago.status === "approved" && sub.next_payment_date) {
      datos.currentPeriodStart = admin.firestore.FieldValue.serverTimestamp();
      datos.currentPeriodEnd = admin.firestore.Timestamp.fromDate(new Date(sub.next_payment_date));
      datos.nextPaymentDate = admin.firestore.Timestamp.fromDate(new Date(sub.next_payment_date));
    }
    tx.set(userRef, datos, { merge: true });
  });
}

/* --------------------------- 4) Administrador ------------------------------- */

// La corrés vos una sola vez (llamándola logueado con tu cuenta) para
// convertirte en admin. Nadie más puede usarla: solo funciona sobre UID_ADMIN.
exports.hacerseAdmin = functions.https.onCall(async (data, context) => {
  if (!context.auth || context.auth.uid !== UID_ADMIN) {
    throw new functions.https.HttpsError("permission-denied", "Esta cuenta no puede ser administradora.");
  }
  await admin.auth().setCustomUserClaims(UID_ADMIN, { admin: true });
  return { ok: true };
});

// Acciones manuales del panel /admin (cambiar estado, dar/quitar acceso, etc.).
// Queda todo registrado en logsAdmin para poder auditar cambios.
exports.accionAdmin = functions.https.onCall(async (data, context) => {
  if (!context.auth || context.auth.token.admin !== true) {
    throw new functions.https.HttpsError("permission-denied", "No sos administrador.");
  }
  const { uid, cambios } = data || {};
  if (!uid || !cambios || typeof cambios !== "object") {
    throw new functions.https.HttpsError("invalid-argument", "Faltan datos.");
  }
  // Lista blanca: el admin solo puede tocar estos campos a mano.
  const PERMITIDOS = ["subscriptionStatus", "cancelAtPeriodEnd", "plan", "maxPropiedades"];
  const cambiosLimpios = {};
  for (const k of PERMITIDOS) if (k in cambios) cambiosLimpios[k] = cambios[k];
  if (!Object.keys(cambiosLimpios).length) {
    throw new functions.https.HttpsError("invalid-argument", "Ningún campo permitido para modificar.");
  }

  await db.collection("users").doc(uid).set({
    ...cambiosLimpios,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  await db.collection("logsAdmin").add({
    adminUid: context.auth.uid,
    uidAfectado: uid,
    cambios: cambiosLimpios,
    fecha: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { ok: true };
});

/* =========================================================================
   Avisos por email de nuevos matches (a partir del 75%)

   Flujo:
     1) Cada vez que alguien publica o edita una propiedad, estas funciones
        la comparan contra TODAS las demás propiedades activas, usando el
        mismo algoritmo de compatibilidad que el sitio (js/utils.js).
     2) Si algún par llega al 75% o más, se manda un mail a los DOS
        propietarios avisando el nuevo match (uno por cada lado).
     3) Cada par se avisa una sola vez: se guarda en la colección
        "matchesAvisados" para no volver a mandar el mismo aviso si la
        propiedad se vuelve a editar sin que cambie el resultado.

   Para que mande los mails hace falta configurar el remitente como secreto
   de Firebase (igual que el token de Mercado Pago):
       firebase functions:secrets:set EMAIL_USER
       firebase functions:secrets:set EMAIL_PASS
   Con Gmail, EMAIL_USER es la cuenta completa (tunombre@gmail.com) y
   EMAIL_PASS tiene que ser una "contraseña de aplicación" (no la contraseña
   normal de la cuenta): https://myaccount.google.com/apppasswords
   Si preferís otro proveedor (SendGrid, etc.), cambiá crearTransportador().
   ========================================================================= */

// AJUSTAR si querés avisar antes o después del 75%.
const PORCENTAJE_MINIMO_AVISO = 75;

const COLECCION_PROPIEDADES = "propiedades";       // misma colección que usa js/backend.js
const COLECCION_MATCHES_AVISADOS = "matchesAvisados";

const conSecretoMail = functions.runWith({ secrets: ["EMAIL_USER", "EMAIL_PASS"] });

function crearTransportador() {
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });
}

/* ---- Algoritmo de compatibilidad --------------------------------------
   Copia fiel del que usa el sitio en js/utils.js (calcularCompatibilidad y
   sus funciones auxiliares), sin nada de DOM, para poder correrlo acá.
   Si alguna vez cambiás el algoritmo del sitio, actualizá también esta copia. */

function _norm(s) {
  return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function _opciones(...valores) {
  return valores.map(Number).filter((n) => n > 0);
}

function _cumpleMinimo(valor, ...mins) {
  const m = _opciones(...mins);
  if (!m.length) return 1;
  return Math.max(...m.map((x) => Math.min(1, (valor || 0) / x)));
}

function _puntosPrecio(precio, max) {
  if (precio <= max) return 25;
  const exceso = (precio - max) / max;
  return exceso <= 0.15 ? 15 : exceso <= 0.30 ? 8 : 0;
}

function _puntosZona(wants, target) {
  const dep = _norm(target.departamento), loc = _norm(target.localidad), barrio = _norm(target.barrio);
  const nombres = [target.location, target.city, target.departamento, target.localidad].map(_norm);
  let pts = 0;

  (wants.zones || []).forEach((z) => {
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

  if (!(wants.zones || []).length && (wants.locations || []).some((l) => nombres.includes(_norm(l)))) pts = 20;
  return pts;
}

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

function _puntosSuperficie(wants, target) {
  const partes = [];
  const cub = _fraccionRango(target.superficieCubierta || target.area, wants.minCubierta, wants.maxCubierta);
  const ter = _fraccionRango(target.superficieTerreno, wants.minTerreno, wants.maxTerreno);
  if (cub !== null) partes.push(cub);
  if (ter !== null) partes.push(ter);

  if (!partes.length) return 15;
  return (15 * partes.reduce((a, b) => a + b, 0)) / partes.length;
}

function matchUnidireccional(owner, target) {
  const wants = owner.wants || { types: [], locations: [] };
  let score = 0;

  if ((wants.types || []).includes(target.type)) score += 25;
  score += _puntosZona(wants, target);
  score += 15 * _cumpleMinimo(target.bedrooms, wants.minBedrooms, wants.minBedrooms2);
  score += _puntosSuperficie(wants, target);

  const maximos = _opciones(wants.maxPrice, wants.maxPrice2);
  if (maximos.length) {
    score += Math.max(...maximos.map((m) => _puntosPrecio(target.price, m)));
  } else {
    const priceDiff = owner.price ? Math.abs(owner.price - target.price) / owner.price : 1;
    if (priceDiff <= 0.15) score += 25;
    else if (priceDiff <= 0.30) score += 14;
    else if (priceDiff <= 0.50) score += 6;
  }

  return Math.round(score);
}

function calcularCompatibilidad(a, b) {
  const aQuiereB = matchUnidireccional(a, b);
  const bQuiereA = matchUnidireccional(b, a);
  const final = 0.5 * Math.min(aQuiereB, bQuiereA) + 0.5 * ((aQuiereB + bQuiereA) / 2);
  return Math.max(5, Math.min(Math.round(final), 98));
}
/* ------------------------------------------------------------------------ */

// Manda el mail de aviso a los dos propietarios de un match nuevo (una sola
// vez por par: queda registrado en COLECCION_MATCHES_AVISADOS).
async function avisarMatchSiCorresponde(idA, propA, idB, propB) {
  if (!propA.ownerEmail && !propB.ownerEmail) return;

  const parId = [idA, idB].sort().join("_");
  const parRef = db.collection(COLECCION_MATCHES_AVISADOS).doc(parId);
  const parDoc = await parRef.get();
  if (parDoc.exists) return; // este par ya se avisó

  const pct = calcularCompatibilidad(propA, propB);
  if (pct < PORCENTAJE_MINIMO_AVISO) return;

  await parRef.set({
    porcentaje: pct,
    propiedades: [idA, idB],
    creado: admin.firestore.FieldValue.serverTimestamp(),
  });

  const destinatarios = [
    { email: propA.ownerEmail, propia: propA, otra: propB, otraId: idB },
    { email: propB.ownerEmail, propia: propB, otra: propA, otraId: idA },
  ].filter((d) => d.email);
  if (!destinatarios.length) return;

  const transportador = crearTransportador();
  await Promise.all(destinatarios.map((d) => transportador.sendMail({
    from: `InmoPermutas <${process.env.EMAIL_USER}>`,
    to: d.email,
    subject: `¡Nuevo match del ${pct}%! — InmoPermutas`,
    html: `
      <p>¡Buenas noticias! Encontramos un nuevo match del <strong>${pct}%</strong> para tu propiedad
      "<strong>${d.propia.title}</strong>".</p>
      <p>La propiedad "<strong>${d.otra.title}</strong>" podría ser una buena opción para tu permuta.</p>
      <p><a href="${SITIO}/propiedad.html?id=${encodeURIComponent(d.otraId)}">Ver la propiedad</a></p>
      <p style="color:#888; font-size:0.85em; margin-top:1.5em;">Te llega este correo porque tenés una propiedad publicada en InmoPermutas.</p>
    `,
  })));
}

// Compara una propiedad (recién publicada o recién editada) contra todas las
// demás propiedades activas y avisa los matches que lleguen al mínimo.
async function revisarMatchesDe(id, datos) {
  if (!datos || !datos.ownerEmail) return; // sin email de contacto no hay a quién avisarle a ESTA propiedad
  const snap = await db.collection(COLECCION_PROPIEDADES).get();
  const tareas = [];
  snap.forEach((doc) => {
    if (doc.id === id) return;
    const otra = doc.data();
    if (otra.ownerUid && datos.ownerUid && otra.ownerUid === datos.ownerUid) return; // no comparar contra uno mismo
    tareas.push(
      avisarMatchSiCorresponde(id, datos, doc.id, otra).catch((e) =>
        console.error("Error avisando match", id, doc.id, e)
      )
    );
  });
  await Promise.all(tareas);
}

// Se dispara al publicar una propiedad nueva.
exports.notificarMatchAlPublicar = conSecretoMail.firestore
  .document(`${COLECCION_PROPIEDADES}/{id}`)
  .onCreate(async (snap, context) => {
    try {
      await revisarMatchesDe(context.params.id, snap.data());
    } catch (e) {
      console.error("Error en notificarMatchAlPublicar:", e);
    }
  });

// Se dispara al editar una propiedad (puede generar matches nuevos si
// cambiaron los criterios de "qué buscás").
exports.notificarMatchAlEditar = conSecretoMail.firestore
  .document(`${COLECCION_PROPIEDADES}/{id}`)
  .onUpdate(async (change, context) => {
    try {
      await revisarMatchesDe(context.params.id, change.after.data());
    } catch (e) {
      console.error("Error en notificarMatchAlEditar:", e);
    }
  });
