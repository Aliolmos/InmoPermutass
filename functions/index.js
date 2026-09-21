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