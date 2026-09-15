// Versión del esquema de datos. Subí este número cada vez que cambies
// la estructura o el contenido de propertiesData: fuerza a refrescar el
// localStorage de los usuarios en vez de dejarlos con datos viejos cacheados.
const DATA_VERSION = "3.0";

const propertiesData = [
    {
        id: 1,
        title: "Casa con Jardín en Nordelta",
        type: "Casa",
        location: "Nordelta",
        city: "Buenos Aires",
        price: 320000,
        currency: "US$",
        bedrooms: 4,
        area: 210,
        image: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=80",
        seller: { name: "Marcela Ibáñez", avatar: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=200&q=80", phone: "5493512006888" },
        // Qué tipo y zona de propiedad aceptaría recibir a cambio.
        wants: { types: ["Departamento", "Casa"], locations: ["Recoleta", "Palermo", "Nordelta", "La Lucila"] }
    },
    {
        id: 2,
        title: "Casa de Diseño en La Lucila",
        type: "Casa",
        location: "La Lucila",
        city: "Buenos Aires",
        price: 410000,
        currency: "US$",
        bedrooms: 4,
        area: 280,
        image: "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=800&q=80",
        seller: { name: "Diego Fernández", avatar: "https://images.unsplash.com/photo-1568602471122-7832951cc4c5?auto=format&fit=crop&w=200&q=80", phone: "5493512006888" },
        wants: { types: ["Casa"], locations: ["Nordelta", "Cerro de las Rosas", "Villa Allende"] }
    },
    {
        id: 3,
        title: "Departamento Luminoso en Palermo",
        type: "Departamento",
        location: "Palermo",
        city: "Buenos Aires",
        price: 185000,
        currency: "US$",
        bedrooms: 2,
        area: 75,
        image: "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=800&q=80",
        seller: { name: "Luciana Roldán", avatar: "https://images.unsplash.com/photo-1580489944071-8d53d64a3ce8?auto=format&fit=crop&w=200&q=80", phone: "5493512006888" },
        wants: { types: ["Casa"], locations: ["Nordelta", "Villa Allende", "Cerro de las Rosas"] }
    },
    {
        id: 4,
        title: "Departamento a Estrenar en Nueva Córdoba",
        type: "Departamento",
        location: "Nueva Córdoba",
        city: "Córdoba",
        price: 150000,
        currency: "US$",
        bedrooms: 3,
        area: 95,
        image: "https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=800&q=80",
        seller: { name: "Tomás Bianchi", avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=200&q=80", phone: "5493512006888" },
        wants: { types: ["Casa", "Departamento"], locations: ["Nueva Córdoba", "Cerro de las Rosas", "Villa Allende"] }
    },
    {
        id: 5,
        title: "Terreno en Barrio Cerrado, Escobar",
        type: "Terreno",
        location: "Escobar",
        city: "Buenos Aires",
        price: 95000,
        currency: "US$",
        bedrooms: 0,
        area: 500,
        image: "https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=800&q=80",
        seller: { name: "Gabriel Ortiz", avatar: "https://images.unsplash.com/photo-1519345182560-3f2917c472ef?auto=format&fit=crop&w=200&q=80", phone: "5493512006888" },
        wants: { types: ["Departamento"], locations: ["Palermo", "Recoleta", "Nueva Córdoba"] }
    },
    {
        id: 6,
        title: "Casa con Pileta en Villa Allende",
        type: "Casa",
        location: "Villa Allende",
        city: "Córdoba",
        price: 260000,
        currency: "US$",
        bedrooms: 3,
        area: 180,
        image: "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=800&q=80",
        seller: { name: "Florencia Suárez", avatar: "https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=200&q=80", phone: "5493512006888" },
        wants: { types: ["Departamento"], locations: ["Palermo", "Nueva Córdoba", "Recoleta"] }
    },
    {
        id: 7,
        title: "Departamento con Balcón en Recoleta",
        type: "Departamento",
        location: "Recoleta",
        city: "Buenos Aires",
        price: 210000,
        currency: "US$",
        bedrooms: 2,
        area: 68,
        image: "https://images.unsplash.com/photo-1493809842364-78817add7ffb?auto=format&fit=crop&w=800&q=80",
        seller: { name: "Martín Acosta", avatar: "https://images.unsplash.com/photo-1531123897727-8f129e1688ce?auto=format&fit=crop&w=200&q=80", phone: "5493512006888" },
        wants: { types: ["Casa"], locations: ["Nordelta", "La Lucila", "Villa Allende"] }
    },
    {
        id: 8,
        title: "Casa de Campo en Cerro de las Rosas",
        type: "Casa",
        location: "Cerro de las Rosas",
        city: "Córdoba",
        price: 340000,
        currency: "US$",
        bedrooms: 4,
        area: 230,
        image: "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=800&q=80",
        seller: { name: "Valentina Gómez", avatar: "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=200&q=80", phone: "5493512006888" },
        wants: { types: ["Casa", "Departamento"], locations: ["La Lucila", "Nordelta", "Palermo"] }
    },
    {
        id: 9,
        title: "Local Comercial a la Calle en Mendoza Capital",
        type: "Negocio",
        location: "Ciudad de Mendoza",
        city: "Mendoza",
        price: 130000,
        currency: "US$",
        bedrooms: 0,
        area: 90,
        image: "https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=800&q=80",
        seller: { name: "Rodrigo Peralta", avatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=200&q=80", phone: "5493512006888" },
        wants: { types: ["Departamento", "Terreno"], locations: ["Nueva Córdoba", "Rosario Centro"] }
    },
    {
        id: 10,
        title: "Galpón Industrial en Rosario",
        type: "Galpón",
        location: "Parque Industrial",
        city: "Rosario",
        price: 175000,
        currency: "US$",
        bedrooms: 0,
        area: 600,
        image: "https://images.unsplash.com/photo-1553413077-190dd305871c?auto=format&fit=crop&w=800&q=80",
        seller: { name: "Nadia Villalba", avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80", phone: "5493512006888" },
        wants: { types: ["Terreno", "Galpón"], locations: ["Escobar", "Villa Allende"] }
    },
    {
        id: 11,
        title: "Cochera Cubierta en Puerto Madero",
        type: "Garaje",
        location: "Puerto Madero",
        city: "CABA",
        price: 45000,
        currency: "US$",
        bedrooms: 0,
        area: 15,
        image: "https://images.unsplash.com/photo-1506521781263-d8422e82f27a?auto=format&fit=crop&w=800&q=80",
        seller: { name: "Ezequiel Molina", avatar: "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&w=200&q=80", phone: "5493512006888" },
        wants: { types: ["Garaje", "Departamento"], locations: ["Recoleta", "Palermo"] }
    },
    {
        id: 12,
        title: "Departamento con Vista al Cerro en Bariloche",
        type: "Departamento",
        location: "Melipal",
        city: "San Carlos de Bariloche",
        price: 195000,
        currency: "US$",
        bedrooms: 2,
        area: 70,
        image: "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=800&q=80",
        seller: { name: "Carolina Núñez", avatar: "https://images.unsplash.com/photo-1489424731084-a5d8b219a5bb?auto=format&fit=crop&w=200&q=80", phone: "5493512006888" },
        wants: { types: ["Casa", "Terreno"], locations: ["Nordelta", "Villa Allende"] }
    },
    {
        id: 13,
        title: "Casa Quinta en Salta Capital",
        type: "Casa",
        location: "Villa San Lorenzo",
        city: "Salta",
        price: 230000,
        currency: "US$",
        bedrooms: 3,
        area: 190,
        image: "https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=800&q=80",
        seller: { name: "Julián Coria", avatar: "https://images.unsplash.com/photo-1502685104226-ee32379fefbe?auto=format&fit=crop&w=200&q=80", phone: "5493512006888" },
        wants: { types: ["Departamento", "Negocio"], locations: ["Nueva Córdoba", "Palermo"] }
    }
];

// Solo reseteamos el localStorage si nunca se guardó, o si cambió la
// versión de datos. Así no se pierden propiedades que el usuario haya
// publicado desde el panel, pero tampoco quedan "pegadas" versiones viejas.
const storedVersion = localStorage.getItem('propertiesDataVersion');
if (!localStorage.getItem('properties') || storedVersion !== DATA_VERSION) {
    localStorage.setItem('properties', JSON.stringify(propertiesData));
    localStorage.setItem('propertiesDataVersion', DATA_VERSION);
}