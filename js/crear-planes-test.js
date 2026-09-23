/* =========================================================================
   Crea los planes de SANDBOX en Mercado Pago (con tu token TEST-).
   Los dos planes reales de producción (fbe0b9d9... / aea36678...) NO se
   tocan: viven en tu cuenta real y quedan reservados para el deploy final.

   Uso:
     MP_ACCESS_TOKEN_TEST=TEST-tu-token node crear-planes-test.js
   ========================================================================= */

const TOKEN = process.env.MP_ACCESS_TOKEN_TEST;
if (!TOKEN) { console.error("Falta MP_ACCESS_TOKEN_TEST"); process.exit(1); }

async function crearPlan(reason, freeTrial) {
  const r = await fetch("https://api.mercadopago.com/preapproval_plan", {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      reason,
      auto_recurring: {
        frequency: 1,
        frequency_type: "months",
        transaction_amount: 100, // monto chico: en sandbox no importa el número
        currency_id: "ARS",
        ...(freeTrial ? { free_trial: freeTrial } : {}),
      },
      back_url: "https://inmopermutas.com",
    }),
  });
  const json = await r.json();
  if (!r.ok || !json.id) { console.error("Error creando plan:", reason, r.status, json); return null; }
  return json.id;
}

(async () => {
  const conTrial = await crearPlan("SANDBOX — Pro con 1 día de prueba", { frequency: 1, frequency_type: "days" });
  const sinTrial = await crearPlan("SANDBOX — Pro sin prueba (cobro inmediato)", null);

  console.log("\nPegá esto en tu terminal antes de correr test-e2e.js:\n");
  console.log(`export TEST_PLAN_ID_TRIAL=${conTrial}`);
  console.log(`export TEST_PLAN_ID_SIN_TRIAL=${sinTrial}`);
})();
