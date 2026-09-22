/* =========================================================================
   Cloud Functions — InmoPermutas × Mercado Pago (Checkout Pro)

   Flujo:
     1) planes.html llama a crearPreferencia({ plan }) → esta función crea el
        pago en Mercado Pago y devuelve el link.
     2) La persona paga en Mercado Pago.
     3) Mercado Pago avisa a webhookMercadoPago. La función NO se fía del aviso:
        vuelve a consultar el pago a la API de Mercado Pago con tu token, y solo
        si está "approved" y el monto coincide escribe suscripciones/{uid}.
     4) El navegador escucha ese documento y desbloquea "Publicar" al instante.

   El Access Token de Mercado Pago NUNCA va en el sitio web: vive como secreto
   de Firebase (ver los pasos de instalación).
   ========================================================================= */

const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");

admin.initializeApp();
const db = admin.firestore();

/* ------------------------------ AJUSTAR ---------------------------------- */

// Dominio real del sitio (con https). Mercado Pago vuelve acá después del pago.
const SITIO = "https://inmopermutas.com";

// Precios en PESOS ARGENTINOS (Mercado Pago Argentina cobra en ARS).
// Los de abajo son de ejemplo: poné los tuyos.
const PLANES = {
  pro:     { nombre: "Pro",     precio: 12000, max: 5 },     // max = propiedades activas
  premium: { nombre: "Premium", precio: 25000, max: null },  // null = ilimitadas
};

const DIAS_POR_PAGO = 30;

// MODO PRUEBA: cuentas que pueden activarse un plan SIN pagar, para probar el
// sitio. Poné acá tu UID (Firebase → Authentication → Usuarios) o tu email
// (el email solo cuenta si está verificado, p. ej. ingresando con Google).
// Cualquier otra persona que llame a activarPlanPrueba es rechazada.
// En producción dejá las dos listas vacías.
const UIDS_PRUEBA = ["aU9gRjuTvWcDQ5NKu0yFnVg5vwe2"];
const EMAILS_PRUEBA = ["aliolmos19@gmail.com"];
const REGION = "us-central1";

/* ------------------------------------------------------------------------- */

const conSecreto = functions.runWith({ secrets: ["MP_ACCESS_TOKEN"] });

// 1) Crea el pago y devuelve el link de Mercado Pago
exports.crearPreferencia = conSecreto.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Iniciá sesión para contratar un plan.");
  }
  const planId = data && data.plan;
  const plan = PLANES[planId];
  if (!plan) {
    throw new functions.https.HttpsError("invalid-argument", "Plan inválido.");
  }

  const preferencia = {
    items: [{
      id: planId,
      title: `InmoPermutas — Plan ${plan.nombre} (${DIAS_POR_PAGO} días)`,
      quantity: 1,
      unit_price: plan.precio,
      currency_id: "ARS",
    }],
    payer: context.auth.token.email ? { email: context.auth.token.email } : undefined,
    // Así sabemos de quién es el pago cuando llega el aviso.
    external_reference: `${context.auth.uid}|${planId}`,
    back_urls: {
      success: `${SITIO}/publicar.html?pago=ok`,
      pending: `${SITIO}/publicar.html?pago=pendiente`,
      failure: `${SITIO}/planes.html?pago=error`,
    },
    auto_return: "approved",
    notification_url: `https://${REGION}-${process.env.GCLOUD_PROJECT}.cloudfunctions.net/webhookMercadoPago`,
  };

  const resp = await fetch("https://api.mercadopago.com/checkout/preferences", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(preferencia),
  });
  const json = await resp.json();
  if (!resp.ok || !json.init_point) {
    console.error("Mercado Pago rechazó la preferencia:", resp.status, json);
    throw new functions.https.HttpsError("internal", "No se pudo iniciar el pago. Probá de nuevo.");
  }
  return { url: json.init_point };
});

// 1b) Solo para pruebas: activa el plan al instante, sin pagar, a las cuentas
// de UIDS_PRUEBA / EMAILS_PRUEBA. Escribe el mismo documento que el webhook.
exports.activarPlanPrueba = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Iniciá sesión.");
  }
  const email = String(context.auth.token.email || "").toLowerCase();
  const autorizado =
    UIDS_PRUEBA.includes(context.auth.uid) ||
    (context.auth.token.email_verified === true &&
      EMAILS_PRUEBA.map((e) => e.toLowerCase()).includes(email));
  if (!autorizado) {
    throw new functions.https.HttpsError("permission-denied", "Esta cuenta no es de prueba.");
  }
  const planId = data && data.plan;
  const plan = PLANES[planId];
  if (!plan) {
    throw new functions.https.HttpsError("invalid-argument", "Plan inválido.");
  }
  await db.collection("suscripciones").doc(context.auth.uid).set({
    plan: planId,
    nombrePlan: plan.nombre,
    maxPropiedades: plan.max,
    vence: admin.firestore.Timestamp.fromMillis(Date.now() + DIAS_POR_PAGO * 86400000),
    actualizado: admin.firestore.FieldValue.serverTimestamp(),
    prueba: true,
  });
  return { ok: true };
});

// 2) Aviso de pago de Mercado Pago → activa el plan
exports.webhookMercadoPago = conSecreto.https.onRequest(async (req, res) => {
  try {
    const tipo = req.query.type || req.query.topic || (req.body && req.body.type);
    const pagoId =
      req.query["data.id"] ||
      (req.body && req.body.data && req.body.data.id) ||
      (tipo === "payment" ? req.query.id : null);

    // Mercado Pago manda otros avisos (merchant_order, etc.): se ignoran.
    if (tipo !== "payment" || !pagoId) return res.status(200).send("ignorado");

    // No confiamos en lo que dice el aviso: consultamos el pago real.
    const r = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(pagoId)}`, {
      headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` },
    });
    if (!r.ok) {
      console.error("No se pudo consultar el pago", pagoId, r.status);
      return res.status(500).send("reintentar"); // Mercado Pago vuelve a avisar
    }
    const pago = await r.json();
    if (pago.status !== "approved") return res.status(200).send("todavía no aprobado");

    const [uid, planId] = String(pago.external_reference || "").split("|");
    const plan = PLANES[planId];
    if (!uid || !plan) {
      console.error("Pago con referencia inválida:", pagoId, pago.external_reference);
      return res.status(200).send("referencia inválida");
    }
    if (Number(pago.transaction_amount) < plan.precio) {
      console.error("El monto pagado no coincide con el plan:", pagoId, pago.transaction_amount, plan.precio);
      return res.status(200).send("monto no coincide");
    }

    await db.runTransaction(async (tx) => {
      const pagoRef = db.collection("pagos").doc(String(pagoId));
      const subRef = db.collection("suscripciones").doc(uid);
      const [pagoDoc, subDoc] = await Promise.all([tx.get(pagoRef), tx.get(subRef)]);
      if (pagoDoc.exists) return; // aviso repetido: ya lo procesamos

      // Si renueva el mismo plan antes de que venza, se suman los días.
      const ahora = Date.now();
      const actual = subDoc.exists && subDoc.data().plan === planId && subDoc.data().vence
        ? subDoc.data().vence.toMillis() : 0;
      const vence = admin.firestore.Timestamp.fromMillis(Math.max(ahora, actual) + DIAS_POR_PAGO * 86400000);

      tx.set(subRef, {
        plan: planId,
        nombrePlan: plan.nombre,
        maxPropiedades: plan.max,
        vence,
        actualizado: admin.firestore.FieldValue.serverTimestamp(),
      });
      tx.set(pagoRef, {
        uid,
        plan: planId,
        monto: Number(pago.transaction_amount),
        fecha: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    return res.status(200).send("ok");
  } catch (e) {
    console.error("Error en webhookMercadoPago:", e);
    return res.status(500).send("error");
  }
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