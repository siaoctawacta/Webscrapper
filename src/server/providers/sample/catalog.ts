/**
 * Business categories and fictional-name generation for the sample provider (pure).
 * Category labels follow Google's English type names; business names follow the local language.
 */
import type { Language } from "@/lib/domain";
import { foldText, titleCase } from "@/server/normalize/text";
import type { CountryDef, Flavor } from "./places-data";
import type { Rng } from "./prng";

export type NameCtx = {
  rng: Rng;
  lang: Language;
  flavor: Flavor;
  country: CountryDef;
  hood: string | null;
};

export type SubCategory = {
  /** Category label (English, like Google's type display names). */
  label: string;
  weight: number;
  /** Words naming this kind of business in each language ("Hôtel", "Guest House"…). */
  fr: readonly string[];
  en: readonly string[];
};

export interface CategoryDef {
  key: string;
  /** Folded single words or phrases that select this category. */
  keywords: readonly string[];
  subs: readonly SubCategory[];
  /** Share of businesses that list a website. */
  websiteRate: number;
  /** Multiplier on review counts (hotels get many more reviews than garages). */
  reviewScale: number;
  emailLocals: Record<Language, readonly string[]>;
  /** Boost for Instagram/TikTok presence (image-driven businesses). */
  visualSocial: number;
  name(ctx: NameCtx, sub: SubCategory): string;
}

/* ───────────────────────────── vocabulary ───────────────────────────── */

const FR_AFRICA_DESC = [
  "Le Palmier d'Or", "Les Cocotiers", "Le Flamboyant", "Le Baobab", "La Lagune", "L'Océan", "Le Soleil Levant", "L'Étoile", "L'Oasis", "Le Paradis",
  "Les Bougainvilliers", "Les Acacias", "Les Manguiers", "L'Horizon", "Belle Vue", "Le Rivage", "La Savane", "La Colline", "Le Néré", "Le Karité",
  "La Paillote", "Les Rôniers", "Le Fromager", "La Détente", "La Concorde", "L'Harmonie", "Les Filaos", "La Perle", "Le Phare", "Le Lagon",
  "Le Royal", "Le Prestige", "Les Palmiers", "Le Jardin", "La Source", "Le Relais", "L'Escale", "Le Calao", "La Cascade", "Le Manguier d'Or",
];
const FR_WEST_DESC = [
  "Les Lilas", "Le Tilleul", "Les Marronniers", "Le Belvédère", "La Fontaine", "Le Lion d'Or", "Le Cheval Blanc", "Les Arcades", "La Tour", "Le Square",
  "Les Remparts", "Le Vieux Pont", "La Licorne", "Le Grand Cerf", "Les Platanes", "La Terrasse", "Le Comptoir", "L'Atelier", "Belle Époque", "Le Petit Jardin",
];
const EN_ADJ_AFRICA = [
  "Golden", "Royal", "Green", "Blue", "Silver", "Sunrise", "Sunset", "Coconut", "Ocean", "Harbour", "Savannah", "Coastal", "Grand", "Peace",
  "Unity", "Heritage", "Crystal", "Emerald", "Ivory", "Baobab", "Mango", "Lagoon", "Rainbow", "Palm",
];
const EN_ADJ_WEST = ["Old", "Royal", "Grand", "Park", "River", "Bridge", "Crown", "Kings", "Queens", "Victoria", "Maple", "Harbour", "City", "Garden", "Liberty", "Union", "Copper", "Oak", "Willow", "Hudson"];
const EN_NOUN = ["Palm", "Grove", "View", "Gardens", "Breeze", "Haven", "Oasis", "Crest", "Point", "Court", "Pearl", "Star", "Springs", "Ridge", "Rock", "Gate", "Bay", "Hills", "Leaf", "Light"];

const isVowelStart = (s: string) => /^[aeiouyhàâäéèêëîïôöùûüœAEIOUYHÀÂÄÉÈÊËÎÏÔÖÙÛÜŒ]/.test(s);
/** Place names that take an article in French ("la pharmacie du Plateau", "de la Médina"). */
const DE_WITH_ARTICLE: Record<string, string> = {
  Plateau: "du Plateau", Médina: "de la Médina", Almadies: "des Almadies", "Parcelles Assainies": "des Parcelles Assainies",
  "Deux Plateaux": "des Deux Plateaux", "Zone 4": "de la Zone 4", Riviera: "de la Riviera", Hippodrome: "de l'Hippodrome",
  Lazaret: "du Lazaret", Terminus: "du Terminus", "Le Marais": "du Marais", "Quartier Latin": "du Quartier Latin",
  "Vieux Lyon": "du Vieux Lyon", "Presqu'île": "de la Presqu'île", "Croix-Rousse": "de la Croix-Rousse", "Part-Dieu": "de la Part-Dieu",
  Confluence: "de la Confluence", Guillotière: "de la Guillotière", Brotteaux: "des Brotteaux", Batignolles: "des Batignolles",
  Bastille: "de la Bastille", "Patte d'Oie": "de la Patte d'Oie", "Ouaga 2000": "de Ouaga 2000", "Point E": "du Point E",
};
/** French "de" with elision and articles: de("Agoè") → "d'Agoè", de("Plateau") → "du Plateau". */
const de = (s: string) => DE_WITH_ARTICLE[s] ?? (/^(le|la|les|l')\s?/i.test(s) ? `de ${s}` : isVowelStart(s) ? `d'${s}` : `de ${s}`);

/** Invariable complements that make descriptors more distinctive ("Le Baobab Plage"). */
const FR_COMPLEMENTS = {
  lodging: ["d'Or", "du Lac", "Plage", "Palace", "Confort", "Village", "Prestige", "Beach", "Premium", "Résidence", "Royal", "Lagune"],
  food: ["Gourmand", "Grill", "Plage", "du Lac", "Express", "Plus", "Saveurs", "Délices", "Gourmet", "du Coin"],
  nightlife: ["Lounge", "Plage", "Club", "du Lac", "VIP", "Night", "Bar", "Plus"],
} as const;

function frDesc(c: NameCtx, complements?: keyof typeof FR_COMPLEMENTS): string {
  const base = c.rng.pick(c.flavor === "africa" ? FR_AFRICA_DESC : FR_WEST_DESC);
  return complements && c.rng.chance(0.45) ? `${base} ${c.rng.pick(FR_COMPLEMENTS[complements])}` : base;
}
function enDesc(c: NameCtx): string {
  const adj = c.rng.pick(c.flavor === "africa" ? EN_ADJ_AFRICA : EN_ADJ_WEST);
  let noun = c.rng.pick(EN_NOUN);
  if (noun === adj) noun = "Gardens";
  return `${adj} ${noun}`;
}
const first = (c: NameCtx) => c.rng.pick(c.country.firstNames);
const last = (c: NameCtx) => c.rng.pick(c.country.lastNames);
const word = (c: NameCtx, sub: SubCategory) => c.rng.pick(c.lang === "fr" ? sub.fr : sub.en);
const hoodOr = (c: NameCtx, fallback: () => string) => c.hood ?? fallback();

/** Weighted choice between name builders. */
function variant(c: NameCtx, options: readonly (readonly [() => string, number])[]): string {
  return c.rng.weighted(options)();
}

/* ───────────────────────────── categories ───────────────────────────── */

const sub = (label: string, weight: number, fr: string[], en: string[]): SubCategory => ({ label, weight, fr, en });

const HOTEL: CategoryDef = {
  key: "hotel",
  keywords: ["hotel", "hotels", "hotellerie", "auberge", "auberges", "motel", "motels", "resort", "resorts", "hostel", "hostels", "lodge", "lodges", "guesthouse", "guest house", "maison d hotes", "residence hoteliere", "hebergement", "accommodation", "lodging", "inn", "bnb"],
  subs: [
    sub("Hotel", 0.45, ["Hôtel"], ["Hotel"]),
    sub("Guest house", 0.18, ["Résidence", "Maison d'hôtes", "Villa"], ["Guest House", "Guesthouse"]),
    sub("Lodge", 0.14, ["Lodge", "Écolodge"], ["Lodge"]),
    sub("Hostel", 0.08, ["Auberge"], ["Hostel", "Backpackers"]),
    sub("Resort", 0.08, ["Complexe Hôtelier", "Résidence Hôtelière"], ["Resort", "Beach Resort"]),
    sub("Motel", 0.07, ["Motel"], ["Motel", "Inn"]),
  ],
  websiteRate: 0.62,
  reviewScale: 2.2,
  emailLocals: { fr: ["reservation", "contact", "info", "accueil"], en: ["reservations", "info", "bookings", "frontdesk"] },
  visualSocial: 0.5,
  name(c, s) {
    const w = word(c, s);
    if (c.lang === "fr") {
      return variant(c, [
        [() => `${w} ${frDesc(c, "lodging")}`, 70],
        [() => `${w} ${frDesc(c, "lodging")} ${de(hoodOr(c, () => "la Plage"))}`, 8],
        [() => `${w} ${c.country.welcome ? `${c.country.welcome} ${c.rng.pick(FR_COMPLEMENTS.lodging)}` : frDesc(c, "lodging")}`, 5],
        [() => (s.label === "Hotel" || s.label === "Resort" ? `${w} ${frDesc(c, "lodging")} & Spa` : `${w} Chez ${first(c)}`), 8],
        [() => `${w} du ${c.rng.pick(["Golfe", "Lac", "Port", "Plateau", "Centre", "Marché", "Stade", "Fleuve"])} ${de(hoodOr(c, () => "la Ville"))}`, 9],
      ]);
    }
    return variant(c, [
      [() => `${enDesc(c)} ${w}`, 60],
      [() => `The ${enDesc(c)} ${w}`, 12],
      [() => `${hoodOr(c, () => enDesc(c))} ${w}`, 10],
      [() => `${c.country.welcome ?? enDesc(c)} ${w}`, 8],
      [() => `${first(c)}'s ${w}`, 10],
    ]);
  },
};

const RESTAURANT: CategoryDef = {
  key: "restaurant",
  keywords: ["restaurant", "restaurants", "resto", "maquis", "cafe", "cafes", "cafeteria", "coffee", "fast food", "fastfood", "snack", "food", "chop bar", "chop", "cuisine", "pizzeria", "pizza", "bakery", "boulangerie", "patisserie", "grill", "eatery", "diner", "brasserie", "bistro", "bistrot", "traiteur", "catering"],
  subs: [
    sub("Restaurant", 0.42, ["Restaurant"], ["Restaurant"]),
    sub("African restaurant", 0.2, ["Maquis", "Maquis", "Restaurant Africain"], ["Chop Bar", "Local Kitchen", "Chop House"]),
    sub("Fast food restaurant", 0.12, ["Fast Food", "Snack"], ["Fast Food", "Grill & Fries"]),
    sub("Café", 0.1, ["Café"], ["Café", "Coffee House"]),
    sub("Bar & grill", 0.08, ["Grill", "Brasserie"], ["Bar & Grill", "Grill House"]),
    sub("Bakery", 0.08, ["Boulangerie", "Pâtisserie"], ["Bakery", "Pastries"]),
  ],
  websiteRate: 0.45,
  reviewScale: 1.6,
  emailLocals: { fr: ["contact", "commandes", "info", "resa"], en: ["info", "orders", "hello", "bookings"] },
  visualSocial: 0.9,
  name(c, s) {
    const w = word(c, s);
    if (c.lang === "fr") {
      if (s.label === "African restaurant" && w === "Maquis") {
        return variant(c, [
          [() => `Maquis Chez ${first(c)}`, 45],
          [() => `Maquis ${frDesc(c, "food")}`, 35],
          [() => `Maquis Chez Tante ${first(c)}`, 20],
        ]);
      }
      return variant(c, [
        [() => `${w} ${frDesc(c, "food")}`, 45],
        [() => `Chez ${first(c)}`, 12],
        [() => `La Table de ${first(c)}`, 8],
        [() => c.rng.pick(["Saveurs d'Afrique", "La Belle Assiette", "Le Petit Gourmet", "Le Coin des Délices", "La Table du Chef", "Le Bon Goût", "Le Festin", "La Marmite", "L'Assiette Gourmande", "Les Délices du Terroir"]), 20],
        [() => `${w} ${de(hoodOr(c, () => "la Gare"))}`, 15],
      ]);
    }
    return variant(c, [
      [() => `${first(c)}'s ${w === "Restaurant" ? "Kitchen" : w}`, 22],
      [() => `Mama ${first(c)}'s Kitchen`, 10],
      [() => `${enDesc(c)} ${w}`, 35],
      [() => c.rng.pick(["Jollof House", "Spice Garden", "Taste of Home", "Pepper Pot", "Kitchen Corner", "The Hungry Lion", "Flavours", "The Food Court", "Savanna Bites", "The Golden Spoon"]), 18],
      [() => `${hoodOr(c, () => enDesc(c))} ${w}`, 15],
    ]);
  },
};

const SALON: CategoryDef = {
  key: "salon",
  keywords: ["salon", "salons", "coiffure", "coiffeur", "coiffeuse", "barber", "barbers", "barbershop", "barbier", "hair", "hairdresser", "beaute", "beauty", "onglerie", "nail", "nails", "esthetique", "manucure", "spa", "tresses", "braids", "maquillage", "makeup"],
  subs: [
    sub("Hair salon", 0.42, ["Salon de Coiffure", "Coiffure"], ["Hair Studio", "Hair Salon"]),
    sub("Barber shop", 0.28, ["Barber Shop", "Salon de Coiffure Homme"], ["Barbershop", "Barbering Salon", "Cuts"]),
    sub("Beauty salon", 0.2, ["Institut de Beauté", "Espace Beauté"], ["Beauty Salon", "Beauty Spa"]),
    sub("Nail salon", 0.1, ["Onglerie"], ["Nail Studio", "Nails & Spa"]),
  ],
  websiteRate: 0.4,
  reviewScale: 0.8,
  emailLocals: { fr: ["contact", "rdv", "info"], en: ["info", "bookings", "hello"] },
  visualSocial: 1,
  name(c, s) {
    const w = word(c, s);
    if (c.lang === "fr") {
      const q = c.rng.pick(["Belle Allure", "Élégance", "Glamour", "Prestige", "Divine Beauté", "La Grâce", "Les Reines", "Star", "Belle Dame", "Charme", "Éclat", "Diva", "Le Gentleman", "Top Style", "Black Beauty", "Nappy Queen"]);
      return variant(c, [
        [() => `${w} ${q}`, 60],
        [() => `${w} Chez ${first(c)}`, 20],
        [() => `${q} ${s.label === "Barber shop" ? "Barber" : "Coiffure"}`, 20],
      ]);
    }
    const q = c.rng.pick(["Royal", "Glamour", "Classic Touch", "Elegance", "Divine", "Queens", "Kings", "Sharp", "Fresh", "Golden", "Elite", "Top Notch", "Silk", "Crown"]);
    return variant(c, [
      [() => `${q} ${w}`, 60],
      [() => `${first(c)}'s ${w}`, 25],
      [() => `${hoodOr(c, () => q)} ${w}`, 15],
    ]);
  },
};

const PHARMA_FR = [
  "de l'Espoir", "La Grâce", "Bel Air", "du Marché", "de la Paix", "du Progrès", "Sainte-Rita", "du Rond-Point", "de la Gare", "La Confiance",
  "du Plateau", "de l'Avenir", "La Bienveillance", "du Soleil", "Bon Pasteur", "Sainte-Anne", "du Boulevard", "de la Lagune", "Notre-Dame",
  "des Cocotiers", "du Carrefour", "de l'Amitié", "de la Victoire", "du Bien-Être", "Saint-Luc", "de la Cathédrale", "de l'Océan", "du Stade",
  "Les Palmiers", "du Port", "Bethesda", "La Providence", "du Lac", "Sainte-Famille", "de l'Unité", "de la Concorde", "Le Bon Samaritain", "Saint-Raphaël",
];
const PHARMA_EN = [
  "Good Health", "Life Care", "Grace", "Wellness", "Family", "Trust", "Health First", "City Care", "Hope", "Unity", "Royal Care", "Evergreen",
  "Bethel", "Good Shepherd", "Mercy", "Vital", "Prime Care", "Faith", "Victory", "Rock of Ages", "Sunshine", "Harmony", "Lifeline", "Abundant Life",
];

const PHARMACY: CategoryDef = {
  key: "pharmacy",
  keywords: ["pharmacie", "pharmacies", "pharmacy", "pharmacies", "chemist", "chemists", "drugstore", "drug store", "parapharmacie", "officine"],
  subs: [sub("Pharmacy", 0.9, ["Pharmacie"], ["Pharmacy", "Chemist"]), sub("Drugstore", 0.1, ["Parapharmacie"], ["Drug Store"])],
  websiteRate: 0.5,
  reviewScale: 0.7,
  emailLocals: { fr: ["contact", "info"], en: ["info", "contact"] },
  visualSocial: 0.2,
  name(c, s) {
    const w = word(c, s);
    if (c.lang === "fr") {
      return variant(c, [
        [() => `${w} ${c.rng.pick(PHARMA_FR)}`, 40],
        [() => `${w} ${last(c)}`, 22],
        [() => `${w} ${de(hoodOr(c, () => "la Cité"))}`, 10],
        [() => `${w} ${frDesc(c)}`, 18],
        [() => `${w} ${c.rng.pick(PHARMA_FR)} ${de(hoodOr(c, () => "la Cité"))}`, 10],
      ]);
    }
    const a = c.rng.pick(PHARMA_EN);
    return variant(c, [
      [() => `${a} ${w}`, 50],
      [() => `${last(c)} ${w}`, 20],
      [() => `${hoodOr(c, () => a)} ${w}`, 12],
      [() => `${a} ${w} ${hoodOr(c, () => "Central")}`, 8],
      [() => `${first(c)}'s ${w}`, 10],
    ]);
  },
};

const SCHOOL: CategoryDef = {
  key: "school",
  keywords: ["ecole", "ecoles", "school", "schools", "college", "lycee", "academy", "academie", "complexe scolaire", "groupe scolaire", "creche", "maternelle", "kindergarten", "montessori", "preschool", "universite", "university", "formation", "training", "institut", "institute"],
  subs: [
    sub("School", 0.3, ["Groupe Scolaire", "Complexe Scolaire"], ["Academy", "International School"]),
    sub("Primary school", 0.25, ["École Primaire"], ["Primary School", "Basic School"]),
    sub("Secondary school", 0.15, ["Collège Privé", "Lycée Privé"], ["Senior High School", "College"]),
    sub("Private school", 0.12, ["Institut", "École Privée"], ["Preparatory School"]),
    sub("Preschool", 0.1, ["École Maternelle", "Jardin d'Enfants"], ["Montessori School", "Kindergarten"]),
    sub("Vocational school", 0.08, ["Centre de Formation"], ["Vocational Institute", "Training Centre"]),
  ],
  websiteRate: 0.6,
  reviewScale: 0.6,
  emailLocals: { fr: ["contact", "secretariat", "info", "direction"], en: ["info", "admissions", "office", "contact"] },
  visualSocial: 0.3,
  name(c, s) {
    const w = word(c, s);
    if (c.lang === "fr") {
      const n = c.rng.pick(["Les Étoiles", "La Sagesse", "Les Lauréats", "L'Excellence", "Le Savoir", "Les Petits Génies", "La Réussite", "Les Bambins", "L'Avenir", "La Lumière", "Les Pionniers", "La Persévérance", "Sainte-Famille", "Saint-Michel"]);
      return variant(c, [
        [() => `${w} ${n}`, 55],
        [() => `${w} ${n} ${de(hoodOr(c, () => "la Cité"))}`, 25],
        [() => `${w} ${first(c)} ${last(c)}`, 20],
      ]);
    }
    const n = c.rng.pick(["Bright Future", "Little Stars", "Excellence", "Wisdom Hill", "Golden Gate", "Morning Star", "Royal", "Faith", "Victory", "New Horizon", "Pinnacle", "Hilltop", "Unity", "Heritage"]);
    return variant(c, [
      [() => `${n} ${w}`, 55],
      [() => `${n} ${w}, ${hoodOr(c, () => "Central")}`, 25],
      [() => `${hoodOr(c, () => n)} ${w}`, 20],
    ]);
  },
};

const GARAGE: CategoryDef = {
  key: "garage",
  keywords: ["garage", "garages", "mecanique", "mecanicien", "mechanic", "mechanics", "auto repair", "car repair", "vulcanisation", "vulcanisateur", "tyre", "tyres", "tire", "tires", "pieces detachees", "auto parts", "spare parts", "carrosserie", "car wash", "lavage auto"],
  subs: [
    sub("Auto repair shop", 0.45, ["Garage"], ["Auto Repairs", "Motors"]),
    sub("Car repair and maintenance", 0.15, ["Mécanique Générale"], ["Auto Works", "Car Care"]),
    sub("Tire shop", 0.15, ["Vulcanisation"], ["Tyre Centre", "Tyres & Wheels"]),
    sub("Auto parts store", 0.15, ["Pièces Auto", "Pièces Détachées"], ["Auto Parts", "Spare Parts"]),
    sub("Car wash", 0.1, ["Lavage Auto", "Car Wash"], ["Car Wash"]),
  ],
  websiteRate: 0.35,
  reviewScale: 0.6,
  emailLocals: { fr: ["contact", "atelier", "info"], en: ["info", "service", "workshop"] },
  visualSocial: 0.3,
  name(c, s) {
    const w = word(c, s);
    if (c.lang === "fr") {
      const g = c.rng.pick(["Auto Plus", "de la Paix", "Le Volant", "Moderne", "Express", "Central", "Excellence", "Méca Pro", "Le Bon Mécano", "Turbo", "Rapide", "Garantie"]);
      return variant(c, [
        [() => `${w} ${g}`, 45],
        [() => `${w} Chez ${first(c)}`, 15],
        [() => `${w} ${last(c)} & Fils`, 20],
        [() => `${w} ${g} ${de(hoodOr(c, () => "la Gare"))}`, 20],
      ]);
    }
    const g = c.rng.pick(["Speedy", "Precision", "Reliable", "Top Gear", "Prime", "Smart", "Express", "City", "Allied", "Master", "Pro"]);
    return variant(c, [
      [() => `${g} ${w}`, 45],
      [() => `${last(c)} & Sons ${w}`, 25],
      [() => `${hoodOr(c, () => g)} ${w}`, 15],
      [() => `${g} ${w} ${hoodOr(c, () => "Central")}`, 15],
    ]);
  },
};

const SUPERMARKET: CategoryDef = {
  key: "supermarket",
  keywords: ["supermarche", "supermarches", "supermarket", "supermarkets", "superette", "epicerie", "grocery", "groceries", "mini market", "minimarket", "mini mart", "alimentation", "hypermarche", "provisions", "wholesale", "grossiste"],
  subs: [
    sub("Supermarket", 0.4, ["Supermarché"], ["Supermarket"]),
    sub("Grocery store", 0.25, ["Alimentation Générale", "Épicerie"], ["Grocery", "Provisions Store"]),
    sub("Convenience store", 0.2, ["Supérette"], ["Mini Mart"]),
    sub("Wholesaler", 0.15, ["Dépôt", "Grossiste"], ["Wholesale", "Distributors"]),
  ],
  websiteRate: 0.55,
  reviewScale: 1.2,
  emailLocals: { fr: ["contact", "service.client", "info"], en: ["info", "customercare", "sales"] },
  visualSocial: 0.4,
  name(c, s) {
    const w = word(c, s);
    if (c.lang === "fr") {
      const m = c.rng.pick(["Le Bon Prix", "Plus", "Économie", "Le Panier", "La Ménagère", "Le Grenier", "Prix Doux", "Abondance", "Bonne Affaire", "Le Partage", "Sans Souci", "La Bénédiction"]);
      return variant(c, [
        [() => `${w} ${m}`, 40],
        [() => `${w} Chez ${first(c)}`, 20],
        [() => `${w} ${m} ${de(hoodOr(c, () => "la Cité"))}`, 20],
        [() => `${w} ${last(c)}`, 20],
      ]);
    }
    const m = c.rng.pick(["FreshMart", "Daily Needs", "Value Plus", "Family", "Bargain", "Smart Shop", "Everyday", "Blessed", "Royal", "Unity", "Corner", "Goodwill"]);
    return variant(c, [
      [() => `${m} ${w}`, 40],
      [() => `${first(c)}'s ${w}`, 20],
      [() => `${m} ${w} ${hoodOr(c, () => "Central")}`, 20],
      [() => `${last(c)} ${w}`, 20],
    ]);
  },
};

const BOUTIQUE: CategoryDef = {
  key: "boutique",
  keywords: ["boutique", "boutiques", "shop", "shops", "store", "stores", "magasin", "vetements", "vetement", "clothing", "clothes", "fashion", "mode", "couture", "couturier", "tailleur", "tailor", "pagne", "pagnes", "wax", "chaussures", "shoes", "tissus", "fabrics", "accessoires"],
  subs: [
    sub("Clothing store", 0.4, ["Boutique"], ["Fashion", "Boutique"]),
    sub("Shoe store", 0.15, ["Chaussures"], ["Shoes"]),
    sub("Fabric store", 0.15, ["Tissus", "Pagnes"], ["Fabrics", "Textiles"]),
    sub("Tailor", 0.15, ["Couture", "Atelier de Couture"], ["Tailoring", "Fashion Designs"]),
    sub("Fashion accessories store", 0.15, ["Accessoires"], ["Accessories"]),
  ],
  websiteRate: 0.45,
  reviewScale: 0.6,
  emailLocals: { fr: ["contact", "boutique", "info"], en: ["info", "shop", "hello"] },
  visualSocial: 1,
  name(c, s) {
    const w = word(c, s);
    if (c.lang === "fr") {
      const b = c.rng.pick(["Élégance", "Chic & Choc", "La Mode", "Wax & Pagne", "Style Africain", "Les Merveilles", "Tendance", "Prestige", "Diva", "Belle Allure", "Le Dressing", "Mode & Beauté"]);
      return variant(c, [
        [() => `${w} ${b}`, 55],
        [() => `${b} ${w}`, 15],
        [() => `${w} Chez ${first(c)}`, 15],
        [() => `${first(c)} ${w}`, 15],
      ]);
    }
    const b = c.rng.pick(["Kente", "Style Hub", "Classy", "Trendy", "Elegant", "Royal", "Urban", "Glam", "Chic", "Ankara", "Prestige", "Fabulous"]);
    return variant(c, [
      [() => `${b} ${w}`, 60],
      [() => `${first(c)}'s ${w}`, 25],
      [() => `${first(c)} ${w}`, 15],
    ]);
  },
};

const CHURCH: CategoryDef = {
  key: "church",
  keywords: ["eglise", "eglises", "church", "churches", "paroisse", "parish", "chapelle", "chapel", "temple", "cathedrale", "cathedral", "assemblee de dieu", "ministry", "ministries", "mosquee", "mosque"],
  subs: [
    sub("Church", 0.3, ["Église"], ["Church"]),
    sub("Catholic church", 0.2, ["Paroisse", "Église Catholique"], ["Catholic Church"]),
    sub("Evangelical church", 0.2, ["Église Évangélique"], ["Evangelical Church"]),
    sub("Protestant church", 0.12, ["Église Protestante", "Temple"], ["Methodist Church", "Presbyterian Church"]),
    sub("Pentecostal church", 0.18, ["Église Pentecôtiste", "Assemblée"], ["Pentecostal Church", "Gospel Church", "Chapel"]),
  ],
  websiteRate: 0.55,
  reviewScale: 0.9,
  emailLocals: { fr: ["contact", "secretariat", "info"], en: ["info", "office", "contact"] },
  visualSocial: 0.3,
  name(c, s) {
    const w = word(c, s);
    if (s.label === "Catholic church") {
      if (c.lang === "fr") {
        const saint = c.rng.pick(["Saint-Augustin", "Sainte-Thérèse", "Saint-Pierre", "Saint-Michel", "Notre-Dame de la Paix", "Saint-François d'Assise", "Sainte-Rita", "Saint-Joseph", "Saint-Paul", "Sainte-Anne", "Saint-Kizito", "Saint-Esprit", "Christ-Roi", "Sainte-Cécile"]);
        return c.rng.chance(0.45) ? `${w} ${saint} ${de(hoodOr(c, () => "la Cité"))}` : `${w} ${saint}`;
      }
      const saint = c.rng.pick(["St. Augustine", "St. Theresa", "St. Peter", "St. Michael", "Our Lady of Peace", "St. Francis", "St. Rita", "St. Joseph", "St. Paul", "St. Anne", "St. Kizito", "Holy Spirit", "Christ the King", "St. Cecilia"]);
      return c.rng.chance(0.4) ? `${saint} ${w}, ${hoodOr(c, () => "Central")}` : `${saint} ${w}`;
    }
    if (c.lang === "fr") {
      const e = c.rng.pick(["de la Grâce", "du Réveil", "de la Foi", "Béthel", "Shalom", "de la Nouvelle Alliance", "Béthanie", "Emmanuel", "du Salut", "Sion", "de la Victoire", "Rehoboth", "du Plein Évangile", "de la Résurrection", "Élim", "de la Délivrance"]);
      return variant(c, [
        [() => `${w} ${e}`, 50],
        [() => `${w} ${e} ${de(hoodOr(c, () => "la Cité"))}`, 35],
        [() => `${w} ${e} ${c.rng.pick(["Internationale", "Mission", "Centre", "Temple", "Paroisse"])}`, 15],
      ]);
    }
    const e = c.rng.pick(["Grace", "Living Word", "Faith", "Bethel", "Shalom", "New Covenant", "Bethany", "Emmanuel", "Salvation", "Zion", "Victory", "Rehoboth"]);
    return variant(c, [
      [() => `${e} ${w}`, 70],
      [() => `${e} ${w} International`, 15],
      [() => `${e} ${w} ${hoodOr(c, () => "Central")}`, 15],
    ]);
  },
};

const CLINIC: CategoryDef = {
  key: "clinic",
  keywords: ["clinique", "cliniques", "clinic", "clinics", "hopital", "hospital", "hospitals", "centre medical", "medical center", "medical centre", "centre de sante", "health centre", "health center", "medical", "medecin", "doctor", "dentiste", "dentist", "dentaire", "dental", "laboratoire", "laboratory", "ophtalmologie", "opticien", "optician", "polyclinique", "cabinet medical", "maternite", "maternity"],
  subs: [
    sub("Medical clinic", 0.35, ["Clinique", "Cabinet Médical"], ["Clinic", "Medical Centre"]),
    sub("Health center", 0.15, ["Centre Médical", "Centre de Santé"], ["Health Centre"]),
    sub("Dental clinic", 0.15, ["Cabinet Dentaire", "Clinique Dentaire"], ["Dental Clinic", "Dental Care"]),
    sub("Hospital", 0.1, ["Polyclinique", "Hôpital Privé"], ["Hospital", "Specialist Hospital"]),
    sub("Medical laboratory", 0.15, ["Laboratoire d'Analyses"], ["Diagnostic Laboratory", "Medical Laboratory"]),
    sub("Eye care center", 0.1, ["Centre Ophtalmologique", "Optique"], ["Eye Clinic", "Vision Centre"]),
  ],
  websiteRate: 0.6,
  reviewScale: 1,
  emailLocals: { fr: ["contact", "rdv", "info", "secretariat"], en: ["info", "appointments", "contact", "care"] },
  visualSocial: 0.2,
  name(c, s) {
    const w = word(c, s);
    if (c.lang === "fr") {
      const pool =
        s.label === "Dental clinic" ? ["Le Sourire", "Dent Blanche", "Bel Sourire", "Émail"]
        : s.label === "Eye care center" ? ["Bonne Vue", "Clair Regard", "Vision Plus"]
        : ["La Providence", "Espoir", "La Grâce", "Sainte-Marie", "Les Anges", "La Paix", "Vie Nouvelle", "Santé Plus", "Bon Samaritain", "La Main Tendue", "Bien-Être", "Lumière"];
      return variant(c, [
        [() => `${w} ${c.rng.pick(pool)}`, 55],
        [() => `${w} ${last(c)}`, 20],
        [() => `${w} ${c.rng.pick(pool)} ${de(hoodOr(c, () => "la Cité"))}`, 15],
        [() => `${w} ${de(hoodOr(c, () => "la Cité"))}`, 10],
      ]);
    }
    const pool =
      s.label === "Dental clinic" ? ["Smile", "Bright Smile", "Pearl", "Gentle"]
      : s.label === "Eye care center" ? ["Clear Vision", "Eye Care", "Bright Eyes"]
      : ["Hope", "Grace", "Mercy", "Good Shepherd", "Life Line", "Family Care", "Premier", "Trust", "Royal", "Haven", "Healing Hands"];
    return variant(c, [
      [() => `${c.rng.pick(pool)} ${w}`, 55],
      [() => `${last(c)} ${w}`, 20],
      [() => `${c.rng.pick(pool)} ${w} ${hoodOr(c, () => "Central")}`, 15],
      [() => `${hoodOr(c, () => c.rng.pick(pool))} ${w}`, 10],
    ]);
  },
};

const BAR: CategoryDef = {
  key: "bar",
  keywords: ["bar", "bars", "buvette", "lounge", "lounges", "pub", "pubs", "night club", "nightclub", "boite de nuit", "discotheque", "club", "cocktail"],
  subs: [
    sub("Bar", 0.45, ["Bar", "Buvette", "Bar-Restaurant"], ["Bar", "Spot"]),
    sub("Night club", 0.15, ["Night-Club", "Club"], ["Night Club", "Club"]),
    sub("Lounge", 0.2, ["Lounge"], ["Lounge"]),
    sub("Pub", 0.1, ["Pub"], ["Pub"]),
    sub("Beer garden", 0.1, ["Espace", "Jardin"], ["Beer Garden", "Joint"]),
  ],
  websiteRate: 0.35,
  reviewScale: 1.2,
  emailLocals: { fr: ["contact", "events", "info"], en: ["info", "events", "bookings"] },
  visualSocial: 1,
  name(c, s) {
    const w = word(c, s);
    if (c.lang === "fr") {
      return variant(c, [
        [() => `${w} ${frDesc(c, "nightlife")}`, 55],
        [() => `${w} Chez ${first(c)}`, 25],
        [() => `${frDesc(c, "nightlife")} ${w}`, 20],
      ]);
    }
    return variant(c, [
      [() => `${enDesc(c)} ${w}`, 55],
      [() => `${first(c)}'s ${w}`, 25],
      [() => `The ${enDesc(c)}`, 20],
    ]);
  },
};

export const CATEGORIES: readonly CategoryDef[] = [HOTEL, RESTAURANT, SALON, PHARMACY, SCHOOL, GARAGE, SUPERMARKET, BOUTIQUE, CHURCH, CLINIC, BAR];
const BY_KEY = new Map(CATEGORIES.map((c) => [c.key, c]));

const DEFAULT_FR = [
  "Excellence", "Plus", "Prestige", "Express", "Pro", "Services", "Élite", "Confiance", "Le Progrès", "Horizon", "Avenir", "Star", "Qualité",
  "Rapide", "Moderne", "Expert", "Pour Tous", "Solutions", "International", "Génération", "Espoir", "Succès", "Victoire", "Élégance", "Lumière",
  "Harmonie", "Concept", "Nouvelle Vision", "Top", "Royal", "Grâce", "Fiable", "Partenaire", "Leader", "Innovation", "Synergie",
];
const DEFAULT_EN = [
  "Excellence", "Prime", "Pro", "Express", "Elite", "Trusted", "Smart", "Royal", "Premier", "Star", "Unity", "Golden", "Quality", "Rapid",
  "Modern", "Expert", "Solutions", "International", "Generation", "Hope", "Success", "Victory", "Classic", "Bright", "Harmony", "Concept",
  "New Vision", "Top", "Grace", "Reliable", "Partners", "Leaders", "Innovation", "Synergy", "Pioneer", "Superior",
];

/** Category for any free-text query (title-cased query + variants). */
export function defaultCategory(label: string): CategoryDef {
  const title = titleCase(label);
  return {
    key: `q${Buffer.from(label, "utf8").toString("base64url")}`,
    keywords: [],
    subs: [
      sub(title, 0.75, [title], [title]),
      sub(`${title} service`, 0.15, [title], [title]),
      sub(`${title} supplier`, 0.1, [title], [title]),
    ],
    websiteRate: 0.55,
    reviewScale: 0.7,
    emailLocals: { fr: ["contact", "info"], en: ["info", "contact"] },
    visualSocial: 0.4,
    name(c) {
      if (c.lang === "fr") {
        const q = c.rng.pick(DEFAULT_FR);
        return variant(c, [
          [() => `${title} ${q}`, 35],
          [() => `${q} ${title}`, 10],
          [() => `${title} ${q} ${de(hoodOr(c, () => "la Cité"))}`, 20],
          [() => `Ets ${last(c)} ${title}`, 20],
          [() => `${title} ${first(c)} ${last(c)}`, 15],
        ]);
      }
      const q = c.rng.pick(DEFAULT_EN);
      return variant(c, [
        [() => `${q} ${title}`, 35],
        [() => `${title} ${q}`, 10],
        [() => `${q} ${title} ${hoodOr(c, () => "Central")}`, 20],
        [() => `${last(c)} & Sons ${title}`, 20],
        [() => `${first(c)} ${last(c)} ${title}`, 15],
      ]);
    },
  };
}

const MAX_LABEL = 60;

/** Lower-cased, whitespace-collapsed query used as the label of a free-text category. */
export function queryLabel(query: string): string {
  return query.replace(/\s+/g, " ").trim().toLocaleLowerCase("fr").slice(0, MAX_LABEL).trim();
}

/**
 * Category selected by the query's keywords ("hôtel", "auberge" → hotel; "barber shop" → salon).
 * When several categories match, the keyword that appears first in the query wins.
 * Unknown queries get a free-text category named after the query.
 */
export function resolveCategory(query: string): CategoryDef {
  const folded = ` ${foldText(query)} `;
  let best: { def: CategoryDef; pos: number; len: number } | null = null;
  for (const def of CATEGORIES) {
    for (const kw of def.keywords) {
      const pos = folded.indexOf(` ${kw} `);
      if (pos < 0) continue;
      if (!best || pos < best.pos || (pos === best.pos && kw.length > best.len)) best = { def, pos, len: kw.length };
    }
  }
  if (best) return best.def;
  const label = queryLabel(query) || "business";
  return defaultCategory(label);
}

/** Inverse of CategoryDef.key (used to regenerate records from their IDs). */
export function categoryFromKey(key: string): CategoryDef | null {
  const known = BY_KEY.get(key);
  if (known) return known;
  if (!key.startsWith("q") || key.length < 2) return null;
  const encoded = key.slice(1);
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
  const label = Buffer.from(encoded, "base64url").toString("utf8");
  if (!label || label.length > MAX_LABEL || label !== queryLabel(label)) return null;
  return defaultCategory(label);
}
