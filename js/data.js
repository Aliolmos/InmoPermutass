// InmoPermutas — datos iniciales
// Las propiedades reales se almacenan exclusivamente en Firebase Firestore.
// Este archivo ya no contiene propiedades de demostración.

const propertiesData = [];

// Eliminamos los datos antiguos que pertenecían al sistema anterior
// basado en localStorage.
// NO eliminamos "ip_props_cache", porque esa caché la utiliza backend.js
// para almacenar temporalmente las propiedades reales de Firestore.

try {
    localStorage.removeItem('properties');
    localStorage.removeItem('propertiesDataVersion');
} catch (e) {
    // Si localStorage no está disponible, Firestore sigue siendo
    // la fuente principal de propiedades.
}