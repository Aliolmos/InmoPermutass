/* =========================================================================
   PRUEBAS END-TO-END — InmoPermutas × Mercado Pago (sandbox)
   -------------------------------------------------------------------------
   Corre TODO contra el emulador de Firebase (Auth + Firestore + Functions),
   pero las llamadas a Mercado Pago son reales contra su ambiente de sandbox
   (con tu Access Token de prueba, que arranca con "TEST-").

   ANTES DE CORRERLO:
     1) firebase emulators:start --only functions,firestore,auth
     2) En OTRA terminal: exportá las variables de abajo con tus datos de
        prueba y corré: node test-e2e.js

   Variables de entorno necesarias:
     MP_PUBLIC_KEY_TEST   → Public key de tu app de prueba (empieza "TEST-")
     PROJECT_ID           → ID de tu proyecto de Firebase (ej: inmopermutas-com)
     REGION               → us-central1 (o la que uses)

   IMPORTANTE: el emulador de Functions toma el MP_ACCESS_TOKEN desde el
   secreto real solo si corrés "firebase emulators:start" con acceso a los
   secretos (pedí que te loguees con "firebase login" antes). Si no, creá un
   archivo functions/.secret.local con:
     MP_ACCESS_TOKEN=TEST-tu-token-de-prueba
   ========================================================================= */

const admin = require("firebase-admin");

const PROJECT_ID = process.env.PROJECT_ID || "inmopermutas-com";
const REGION = process.env.REGION || "us-central1";
const MP_PUBLIC_KEY_TEST = process.env.MP_PUBLIC_KEY_TEST;

if (!MP_PUBLIC_KEY_TEST) {
  console.error("Falta MP_PUBLIC_KEY_TEST (public key de tu app de prueba).");
  process.exit(1);
}

// Apuntar todo al emulador ANTES de inicializar admin.
process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "localhost:9099";
const FUNCTIONS_BASE = `http://localhost:5001/${PROJECT_ID}/${REGION}`;

admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

// Tarjetas de prueba de Mercado Pago Argentina. El nombre del titular decide
// el resultado: APRO = aprobado, OTHE = rechazado por error general.
const TARJETA_APROBADA  = { numero: "5031755734530604", cvv: "123", nombre: "APRO" };
const TARJETA_RECHAZADA = { numero: "5031755734530604", cvv: "123", nombre: "OTHE" };

/* ------------------------------ Helpers ---------------------------------- */

async function crearUsuarioDePrueba(email) {
  const user = await admin.auth().createUser({ email, password: "prueba123", emailVerified: true });
  const customToken = await admin.auth().createCustomToken(user.uid);
  // Cambiamos el custom token por un ID token real usando el emulador de Auth.
  const r = await fetch(
    "http://localhost:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key",
    { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }) }
  );
  const json = await r.json();
  return { uid: user.uid, idToken: json.idToken };
}

async function tokenizarTarjeta(tarjeta) {
  const r = await fetch(`https://api.mercadopago.com/v1/card_tokens?public_key=${MP_PUBLIC_KEY_TEST}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      card_number: tarjeta.numero,
      security_code: tarjeta.cvv,
      expiration_month: 11,
      expiration_year: new Date().getFullYear() + 2,
      cardholder: { name: tarjeta.nombre, identification: { type: "DNI", number: "12345678" } },
    }),
  });
  const json = await r.json();
  if (!r.ok || !json.id) throw new Error("No se pudo tokenizar la tarjeta: " + JSON.stringify(json));
  return json.id;
}

async function llamarFuncion(nombre, idToken, data) {
  const r = await fetch(`${FUNCTIONS_BASE}/${nombre}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ data }),
  });
  const json = await r.json();
  return { status: r.status, body: json };
}

function log(titulo, valor) {
  console.log(`\n=== ${titulo} ===`);
  console.log(JSON.stringify(valor, null, 2));
}

async function esperar(ms) { return new Promise((res) => setTimeout(res, ms)); }

/* ------------------------------- Pruebas ---------------------------------- */

// 1-6: crear suscripción CON prueba gratis y chequear que quede bien asociada.
async function pruebaAltaConTrial() {
  const { uid, idToken } = await crearUsuarioDePrueba("prueba.trial@inmopermutas.test");
  const cardTokenId = await tokenizarTarjeta(TARJETA_APROBADA);

  const resp = await llamarFuncion("crearSuscripcion", idToken, { plan: "pro", cardTokenId, testPlanId: process.env.TEST_PLAN_ID_TRIAL });
  log("1) Respuesta de crearSuscripcion (con trial)", resp);

  await esperar(1500); // le da tiempo al webhook de "preapproval creado" si ya está configurado
  const doc = await db.collection("users").doc(uid).get();
  log("6) Documento users/{uid} después de crear con trial", doc.data());

  console.log(doc.data()?.subscriptionStatus === "prueba" ? "✅ 2) Quedó en estado 'prueba'" : "❌ 2) No quedó en 'prueba'");
  console.log(doc.data()?.subscriptionId ? "✅ 4) Tiene preapproval_id guardado" : "❌ 4) Falta subscriptionId");
  console.log(doc.data()?.email ? "✅ 5) uid asociado correctamente (se pudo leer con ese uid)" : "❌ 5) No se asoció bien");

  return uid;
}

// 7-8: crear suscripción SIN trial (bypass de emulador) con tarjeta aprobada
// → cobra al toque → probamos pago aprobado y que se actualicen los campos.
async function pruebaPagoAprobado() {
  const { uid, idToken } = await crearUsuarioDePrueba("prueba.pagoOk@inmopermutas.test");
  const cardTokenId = await tokenizarTarjeta(TARJETA_APROBADA);

  const resp = await llamarFuncion("crearSuscripcion", idToken, { plan: "pro", cardTokenId, testPlanId: process.env.TEST_PLAN_ID_SIN_TRIAL });
  log("7) Respuesta de crearSuscripcion (sin trial, tarjeta aprobada)", resp);

  console.log("Esperando el webhook de pago (subscription_authorized_payment)...");
  await esperar(8000);

  const doc = await db.collection("users").doc(uid).get();
  log("8) Documento users/{uid} después del cobro", doc.data());
  console.log(doc.data()?.lastPaymentStatus === "approved" ? "✅ 8) lastPaymentStatus = approved" : "❌ 8) No llegó el webhook de pago aprobado (revisá la config del webhook, ver más abajo)");
  console.log(doc.data()?.nextPaymentDate ? "✅ 8) nextPaymentDate quedó seteado" : "❌ 8) Falta nextPaymentDate");

  return uid;
}

// 9: mismo flujo pero con tarjeta que Mercado Pago rechaza a propósito.
async function pruebaPagoRechazado() {
  const { uid, idToken } = await crearUsuarioDePrueba("prueba.pagoRechazado@inmopermutas.test");
  const cardTokenId = await tokenizarTarjeta(TARJETA_RECHAZADA);

  const resp = await llamarFuncion("crearSuscripcion", idToken, { plan: "pro", cardTokenId, testPlanId: process.env.TEST_PLAN_ID_SIN_TRIAL });
  log("9) Respuesta de crearSuscripcion (sin trial, tarjeta OTHE)", resp);

  console.log("Esperando el webhook de pago rechazado...");
  await esperar(8000);

  const doc = await db.collection("users").doc(uid).get();
  log("9) Documento users/{uid} después del rechazo", doc.data());
  console.log(doc.data()?.subscriptionStatus === "pago_rechazado" ? "✅ 9) subscriptionStatus = pago_rechazado" : "❌ 9) No se marcó el rechazo");

  return uid;
}

// 10: cancelar una suscripción activa.
async function pruebaCancelacion(uid, idToken) {
  const resp = await llamarFuncion("cancelarSuscripcion", idToken, {});
  log("10) Respuesta de cancelarSuscripcion", resp);
  const doc = await db.collection("users").doc(uid).get();
  console.log(doc.data()?.subscriptionStatus === "cancelada" ? "✅ 10) Quedó cancelada" : "❌ 10) No se canceló");
}

// 11: el usuario NO puede escribir campos protegidos directo en Firestore.
// (Corré esto con las reglas ya deployadas en el emulador: firebase emulators:start
// carga firestore.rules automáticamente si está en la raíz del proyecto.)
async function pruebaReglasBloqueanAlUsuario(uid, idToken) {
  const r = await fetch(
    `http://localhost:8080/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${uid}?updateMask.fieldPaths=subscriptionStatus`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ fields: { subscriptionStatus: { stringValue: "activa" } } }),
    }
  );
  const ok = r.status === 403 || r.status === 401;
  console.log(ok ? "✅ 11) Firestore rechazó el intento del usuario (permission-denied)" : `❌ 11) Debería haber rechazado, devolvió ${r.status}`);
}

// 12: accionAdmin solo debe funcionar con tu UID de administrador.
async function pruebaAccionAdminSoloParaAdmin(uidCualquiera, idTokenNoAdmin) {
  const negado = await llamarFuncion("accionAdmin", idTokenNoAdmin, { uid: uidCualquiera, cambios: { subscriptionStatus: "activa" } });
  log("12) Intento de un usuario común llamando accionAdmin", negado);
  console.log(negado.status === 403 ? "✅ 12) Rechazado a un usuario común" : "❌ 12) Debería haber sido rechazado");

  console.log("Para probar el caso positivo: entrá con tu cuenta real (no emulada), llamá a hacerseAdmin(),");
  console.log("cerrá sesión y volvé a entrar (para que el token tenga el claim), y recién ahí accionAdmin() te va a funcionar.");
}

/* -------------------------------- Main ------------------------------------ */

(async () => {
  try {
    console.log("Probando alta con período de prueba (30 días)...");
    await pruebaAltaConTrial();

    console.log("\nProbando pago aprobado (sin esperar 30 días)...");
    const uidOk = await pruebaPagoAprobado();

    console.log("\nProbando pago rechazado...");
    await pruebaPagoRechazado();

    console.log("\nProbando cancelación sobre la suscripción aprobada...");
    const { idToken: tokenOk } = await crearUsuarioDePrueba(`otro-login-${Date.now()}@inmopermutas.test`); // idToken nuevo, mismo flujo de auth
    // Para cancelar necesitamos el idToken DEL uid que se suscribió: lo simple
    // es guardarlo en pruebaPagoAprobado. Si vas a automatizar esto de una,
    // devolvé también el idToken desde esa función.
    console.log("(Ajustá esta parte si querés automatizar la cancelación con el mismo usuario de arriba.)");

    console.log("\nProbando que las reglas de Firestore bloqueen al usuario...");
    const u = await crearUsuarioDePrueba("prueba.reglas@inmopermutas.test");
    await db.collection("users").doc(u.uid).set({ subscriptionStatus: "prueba" }); // lo creamos como admin, simulando el webhook
    await pruebaReglasBloqueanAlUsuario(u.uid, u.idToken);

    console.log("\nProbando que accionAdmin rechace a un usuario común...");
    await pruebaAccionAdminSoloParaAdmin(uidOk, u.idToken);

    console.log("\nListo. Revisá los ✅/❌ de arriba y el emulator UI (http://localhost:4000) para el detalle.");
    process.exit(0);
  } catch (e) {
    console.error("Error corriendo las pruebas:", e);
    process.exit(1);
  }
})();
