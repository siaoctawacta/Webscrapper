/**
 * Built-in geography for the sample provider (pure data). City centres, rough map areas and real
 * neighbourhood names; businesses generated inside them are fictional.
 */
import type { Language, LatLng, Rect } from "@/lib/domain";
import { M_PER_DEG_LAT } from "@/server/normalize/geo";

/** Naming style: African francophone/anglophone, or European/North American. */
export type Flavor = "africa" | "west";
/** Address layout. */
export type AddressStyle = "africa" | "fr" | "uk" | "us" | "ca";

export interface CountryDef {
  code: string;
  /** Name as written locally (French for francophone countries). */
  name: string;
  aliases: string[];
  language: Language;
  flavor: Flavor;
  addressStyle: AddressStyle;
  /** Owner first names used in names like "Chez Afi" or "Kwame's Kitchen". */
  firstNames: string[];
  /** Local word of welcome used in some names ("Woezon", "Akwaaba"…). */
  welcome?: string;
  /** Postal abbreviation for US/CA addresses. */
  state?: string;
}

export interface Neighbourhood {
  name: string;
  /** Postal code or prefix for countries that use them ("75004", "NW1", "10012", "M5R"). */
  postal?: string;
}

export interface CityDef {
  id: string;
  name: string;
  aliases: string[];
  country: string;
  region: string;
  center: LatLng;
  /** Map area as kilometres from the centre: south, north, west, east. */
  extentKm: { s: number; n: number; w: number; e: number };
  /** Expected number of businesses per query across the city's map area. */
  capacity: number;
  neighbourhoods: Neighbourhood[];
  streets?: string[];
}

export const COUNTRIES: Record<string, CountryDef> = {
  TG: { code: "TG", name: "Togo", aliases: ["togo", "republique togolaise"], language: "fr", flavor: "africa", addressStyle: "africa", welcome: "Woezon",
    firstNames: ["Kossi", "Komlan", "Afi", "Ama", "Yao", "Kodjo", "Akossiwa", "Mawuli", "Séna", "Edem", "Abla", "Essi", "Dodji", "Elom", "Kafui", "Yawa"] },
  GH: { code: "GH", name: "Ghana", aliases: ["ghana"], language: "en", flavor: "africa", addressStyle: "africa", welcome: "Akwaaba",
    firstNames: ["Kwame", "Ama", "Kofi", "Akosua", "Yaw", "Abena", "Kwabena", "Efua", "Kojo", "Esi", "Kwesi", "Adwoa", "Nana", "Kweku", "Afua"] },
  BJ: { code: "BJ", name: "Bénin", aliases: ["benin", "republique du benin"], language: "fr", flavor: "africa", addressStyle: "africa",
    firstNames: ["Codjo", "Sènami", "Bienvenu", "Fifamè", "Romaric", "Gildas", "Mèdessè", "Aïcha", "Sika", "Florent", "Rachelle", "Euloge"] },
  CI: { code: "CI", name: "Côte d'Ivoire", aliases: ["cote d ivoire", "cote divoire", "ivory coast", "rci"], language: "fr", flavor: "africa", addressStyle: "africa", welcome: "Akwaba",
    firstNames: ["Kouassi", "Aya", "Konan", "Adjoua", "Yao", "Affoué", "Koffi", "Amenan", "Sékou", "Mariam", "Drissa", "Awa"] },
  NG: { code: "NG", name: "Nigeria", aliases: ["nigeria"], language: "en", flavor: "africa", addressStyle: "africa",
    firstNames: ["Chinedu", "Ngozi", "Tunde", "Funmi", "Emeka", "Bola", "Uche", "Kemi", "Segun", "Amaka", "Ibrahim", "Aisha", "Femi", "Yetunde"] },
  SN: { code: "SN", name: "Sénégal", aliases: ["senegal"], language: "fr", flavor: "africa", addressStyle: "africa", welcome: "Teranga",
    firstNames: ["Moussa", "Fatou", "Mamadou", "Awa", "Cheikh", "Aminata", "Ousmane", "Khady", "Ibrahima", "Ndèye", "Modou", "Coumba"] },
  BF: { code: "BF", name: "Burkina Faso", aliases: ["burkina faso", "burkina"], language: "fr", flavor: "africa", addressStyle: "africa",
    firstNames: ["Issa", "Aminata", "Salif", "Rasmata", "Boukary", "Mariam", "Adama", "Awa", "Souleymane", "Bintou"] },
  ML: { code: "ML", name: "Mali", aliases: ["mali"], language: "fr", flavor: "africa", addressStyle: "africa",
    firstNames: ["Moussa", "Fatoumata", "Bakary", "Aminata", "Seydou", "Kadiatou", "Sékou", "Oumou", "Modibo", "Hawa"] },
  NE: { code: "NE", name: "Niger", aliases: ["niger"], language: "fr", flavor: "africa", addressStyle: "africa",
    firstNames: ["Abdou", "Mariama", "Moussa", "Hadiza", "Issoufou", "Zeinabou", "Ali", "Rahila", "Boubacar", "Aïssa"] },
  CM: { code: "CM", name: "Cameroun", aliases: ["cameroun", "cameroon"], language: "fr", flavor: "africa", addressStyle: "africa",
    firstNames: ["Paul", "Marie", "Emmanuel", "Brigitte", "Samuel", "Josiane", "Armand", "Clarisse", "Hervé", "Nadège", "Blaise", "Carine"] },
  KE: { code: "KE", name: "Kenya", aliases: ["kenya"], language: "en", flavor: "africa", addressStyle: "africa", welcome: "Karibu",
    firstNames: ["Wanjiru", "Otieno", "Achieng", "Kamau", "Njeri", "Mwangi", "Akinyi", "Kiprop", "Wambui", "Omondi", "Chebet", "Mutua"] },
  FR: { code: "FR", name: "France", aliases: ["france"], language: "fr", flavor: "west", addressStyle: "fr",
    firstNames: ["Julien", "Camille", "Nicolas", "Sophie", "Thomas", "Claire", "Antoine", "Léa", "Marc", "Isabelle", "Hugo", "Manon"] },
  GB: { code: "GB", name: "United Kingdom", aliases: ["united kingdom", "uk", "england", "great britain", "royaume uni", "angleterre"], language: "en", flavor: "west", addressStyle: "uk",
    firstNames: ["James", "Olivia", "Oliver", "Emily", "Harry", "Charlotte", "George", "Amelia", "Jack", "Sophie"] },
  US: { code: "US", name: "United States", aliases: ["united states", "usa", "united states of america", "etats unis"], language: "en", flavor: "west", addressStyle: "us", state: "NY",
    firstNames: ["Michael", "Jessica", "David", "Ashley", "Chris", "Sarah", "Daniel", "Emily", "Kevin", "Maria", "Luis", "Grace"] },
  CA: { code: "CA", name: "Canada", aliases: ["canada"], language: "en", flavor: "west", addressStyle: "ca", state: "ON",
    firstNames: ["Liam", "Emma", "Noah", "Olivia", "Ethan", "Chloé", "Lucas", "Sophie", "Ryan", "Priya"] },
};

const hoods = (...names: string[]): Neighbourhood[] => names.map((name) => ({ name }));
const coded = (pairs: [string, string][]): Neighbourhood[] => pairs.map(([name, postal]) => ({ name, postal }));

export const CITIES: CityDef[] = [
  { id: "lome", name: "Lomé", aliases: ["lome", "lome togo", "grand lome"], country: "TG", region: "Maritime", center: { lat: 6.1319, lng: 1.2228 },
    extentKm: { s: 1.5, n: 16, w: 12, e: 16 }, capacity: 32000,
    neighbourhoods: hoods("Bè", "Tokoin", "Nyékonakpoè", "Adidogomé", "Agoè", "Hédzranawoé", "Kodjoviakopé", "Baguida", "Avédji", "Adakpamé", "Amoutivé") },
  { id: "kara", name: "Kara", aliases: ["kara", "lama kara"], country: "TG", region: "Kara", center: { lat: 9.5511, lng: 1.1861 },
    extentKm: { s: 6, n: 6, w: 6, e: 6 }, capacity: 7000,
    neighbourhoods: hoods("Tomdè", "Kpéwa", "Chaminade", "Dongoyo", "Kakpa", "Lassa", "Pya", "Landa") },
  { id: "sokode", name: "Sokodé", aliases: ["sokode"], country: "TG", region: "Centrale", center: { lat: 8.9833, lng: 1.1333 },
    extentKm: { s: 5, n: 5, w: 5, e: 5 }, capacity: 6000,
    neighbourhoods: hoods("Komah", "Kpangalam", "Didaouré", "Kouloundè", "Tchawanda", "Zongo", "Barkoissi", "Salimdè") },
  { id: "kpalime", name: "Kpalimé", aliases: ["kpalime"], country: "TG", region: "Plateaux", center: { lat: 6.9, lng: 0.6333 },
    extentKm: { s: 4, n: 4, w: 4, e: 4 }, capacity: 4000,
    neighbourhoods: hoods("Nyivémé", "Zomayi", "Kpodzi", "Hanyigba", "Agbétiko", "Dzigbé", "Kusuntu") },
  { id: "accra", name: "Accra", aliases: ["accra", "greater accra", "accra ghana"], country: "GH", region: "Greater Accra", center: { lat: 5.556, lng: -0.1969 },
    extentKm: { s: 1.5, n: 22, w: 16, e: 24 }, capacity: 34000,
    neighbourhoods: hoods("Osu", "Labone", "East Legon", "Cantonments", "Airport Residential", "Madina", "Dansoman", "Spintex", "Adabraka", "Kaneshie", "Achimota", "Teshie", "Dzorwulu"),
    streets: ["Oxford Street", "Liberation Road", "Independence Avenue", "Ring Road Central", "Spintex Road", "Lagos Avenue", "Boundary Road", "Kojo Thompson Road", "Palm Street", "Church Crescent"] },
  { id: "kumasi", name: "Kumasi", aliases: ["kumasi"], country: "GH", region: "Ashanti", center: { lat: 6.6885, lng: -1.6244 },
    extentKm: { s: 12, n: 12, w: 12, e: 12 }, capacity: 28000,
    neighbourhoods: hoods("Adum", "Bantama", "Asokwa", "Ahodwo", "Nhyiaeso", "Suame", "Tafo", "Kwadaso", "Asafo", "Santasi", "Ayigya") },
  { id: "tamale", name: "Tamale", aliases: ["tamale"], country: "GH", region: "Northern", center: { lat: 9.4008, lng: -0.8393 },
    extentKm: { s: 8, n: 8, w: 8, e: 8 }, capacity: 10000,
    neighbourhoods: hoods("Lamashegu", "Kalpohin", "Vittin", "Changli", "Sakasaka", "Kukuo", "Gumani", "Nyohini") },
  { id: "takoradi", name: "Takoradi", aliases: ["takoradi", "sekondi takoradi", "sekondi"], country: "GH", region: "Western", center: { lat: 4.8845, lng: -1.7554 },
    extentKm: { s: 1, n: 10, w: 8, e: 10 }, capacity: 9000,
    neighbourhoods: hoods("Market Circle", "Anaji", "Effia", "Kwesimintsim", "Beach Road", "Airport Ridge", "Fijai", "New Takoradi") },
  { id: "cotonou", name: "Cotonou", aliases: ["cotonou"], country: "BJ", region: "Littoral", center: { lat: 6.3654, lng: 2.4183 },
    extentKm: { s: 1.5, n: 9, w: 12, e: 9 }, capacity: 28000,
    neighbourhoods: hoods("Cadjèhoun", "Akpakpa", "Fidjrossè", "Gbégamey", "Haie Vive", "Zogbo", "Ganhi", "Agla", "Jéricho", "Dantokpa") },
  { id: "porto-novo", name: "Porto-Novo", aliases: ["porto novo", "portonovo"], country: "BJ", region: "Ouémé", center: { lat: 6.4969, lng: 2.6289 },
    extentKm: { s: 2, n: 7, w: 6, e: 6 }, capacity: 9000,
    neighbourhoods: hoods("Ouando", "Djègan-Kpèvi", "Tokpota", "Attaké", "Houinmè", "Avassa", "Djassin", "Gbèkon") },
  { id: "abidjan", name: "Abidjan", aliases: ["abidjan"], country: "CI", region: "Abidjan", center: { lat: 5.3364, lng: -4.0267 },
    extentKm: { s: 6, n: 16, w: 18, e: 18 }, capacity: 34000,
    neighbourhoods: hoods("Cocody", "Plateau", "Marcory", "Treichville", "Yopougon", "Adjamé", "Riviera", "Deux Plateaux", "Koumassi", "Abobo", "Zone 4", "Port-Bouët") },
  { id: "lagos", name: "Lagos", aliases: ["lagos", "lagos nigeria"], country: "NG", region: "Lagos", center: { lat: 6.455, lng: 3.3841 },
    extentKm: { s: 1.5, n: 30, w: 25, e: 30 }, capacity: 40000,
    neighbourhoods: hoods("Ikeja", "Victoria Island", "Lekki", "Ikoyi", "Surulere", "Yaba", "Ajah", "Apapa", "Festac", "Maryland", "Gbagada", "Magodo"),
    streets: ["Allen Avenue", "Admiralty Way", "Adeola Odeku Street", "Awolowo Road", "Herbert Macaulay Way", "Bode Thomas Street", "Opebi Road", "Ajose Adeogun Street", "Isaac John Street", "Akin Adesola Street"] },
  { id: "abuja", name: "Abuja", aliases: ["abuja", "fct"], country: "NG", region: "Federal Capital Territory", center: { lat: 9.0765, lng: 7.3986 },
    extentKm: { s: 15, n: 15, w: 15, e: 15 }, capacity: 28000,
    neighbourhoods: hoods("Wuse", "Garki", "Maitama", "Asokoro", "Gwarinpa", "Jabi", "Utako", "Kubwa", "Lugbe", "Wuye") },
  { id: "dakar", name: "Dakar", aliases: ["dakar"], country: "SN", region: "Dakar", center: { lat: 14.6928, lng: -17.4467 },
    extentKm: { s: 1.5, n: 14, w: 4, e: 22 }, capacity: 30000,
    neighbourhoods: hoods("Plateau", "Médina", "Almadies", "Ouakam", "Yoff", "Mermoz", "Sacré-Cœur", "Point E", "Fann", "Parcelles Assainies", "Grand Yoff", "HLM") },
  { id: "ouagadougou", name: "Ouagadougou", aliases: ["ouagadougou", "ouaga"], country: "BF", region: "Centre", center: { lat: 12.3714, lng: -1.5197 },
    extentKm: { s: 13, n: 13, w: 13, e: 13 }, capacity: 28000,
    neighbourhoods: hoods("Ouaga 2000", "Gounghin", "Dapoya", "Zogona", "Tampouy", "Pissy", "Cissin", "Koulouba", "Patte d'Oie", "Wemtenga", "Samandin") },
  { id: "bamako", name: "Bamako", aliases: ["bamako"], country: "ML", region: "District de Bamako", center: { lat: 12.6392, lng: -8.0029 },
    extentKm: { s: 14, n: 14, w: 14, e: 14 }, capacity: 28000,
    neighbourhoods: hoods("ACI 2000", "Hamdallaye", "Badalabougou", "Hippodrome", "Kalaban Coura", "Magnambougou", "Lafiabougou", "Faladié", "Missira", "Baco Djicoroni") },
  { id: "niamey", name: "Niamey", aliases: ["niamey"], country: "NE", region: "Niamey", center: { lat: 13.5116, lng: 2.1254 },
    extentKm: { s: 10, n: 10, w: 10, e: 10 }, capacity: 15000,
    neighbourhoods: hoods("Plateau", "Koira Kano", "Yantala", "Lazaret", "Gamkalley", "Kouara Kano", "Talladjé", "Banifandou", "Terminus") },
  { id: "douala", name: "Douala", aliases: ["douala"], country: "CM", region: "Littoral", center: { lat: 4.0511, lng: 9.7679 },
    extentKm: { s: 12, n: 12, w: 12, e: 12 }, capacity: 28000,
    neighbourhoods: hoods("Akwa", "Bonanjo", "Bonapriso", "Deïdo", "Bali", "Bonamoussadi", "Makepe", "Logpom", "New Bell", "Ndokoti", "Kotto") },
  { id: "yaounde", name: "Yaoundé", aliases: ["yaounde"], country: "CM", region: "Centre", center: { lat: 3.848, lng: 11.5021 },
    extentKm: { s: 12, n: 12, w: 12, e: 12 }, capacity: 28000,
    neighbourhoods: hoods("Bastos", "Mvog-Mbi", "Nlongkak", "Biyem-Assi", "Essos", "Mokolo", "Melen", "Omnisport", "Nkolbisson", "Mendong", "Etoudi") },
  { id: "nairobi", name: "Nairobi", aliases: ["nairobi"], country: "KE", region: "Nairobi County", center: { lat: -1.2864, lng: 36.8172 },
    extentKm: { s: 16, n: 16, w: 16, e: 16 }, capacity: 32000,
    neighbourhoods: hoods("Westlands", "Kilimani", "Karen", "Lavington", "Parklands", "Kileleshwa", "South B", "Eastleigh", "Upper Hill", "Gigiri", "Langata"),
    streets: ["Ngong Road", "Moi Avenue", "Kenyatta Avenue", "Waiyaki Way", "Argwings Kodhek Road", "Kimathi Street", "Muthithi Road", "Mombasa Road", "Langata Road", "Lenana Road"] },
  { id: "paris", name: "Paris", aliases: ["paris"], country: "FR", region: "Île-de-France", center: { lat: 48.8566, lng: 2.3522 },
    extentKm: { s: 5, n: 5, w: 8, e: 8 }, capacity: 30000,
    neighbourhoods: coded([["Le Marais", "75004"], ["Montmartre", "75018"], ["Saint-Germain-des-Prés", "75006"], ["Belleville", "75020"], ["Bastille", "75011"], ["Batignolles", "75017"], ["Quartier Latin", "75005"], ["Oberkampf", "75011"], ["Montparnasse", "75014"], ["Pigalle", "75009"]]) },
  { id: "lyon", name: "Lyon", aliases: ["lyon"], country: "FR", region: "Auvergne-Rhône-Alpes", center: { lat: 45.764, lng: 4.8357 },
    extentKm: { s: 7, n: 7, w: 7, e: 7 }, capacity: 16000,
    neighbourhoods: coded([["Presqu'île", "69002"], ["Croix-Rousse", "69004"], ["Vieux Lyon", "69005"], ["Part-Dieu", "69003"], ["Confluence", "69002"], ["Guillotière", "69007"], ["Brotteaux", "69006"], ["Monplaisir", "69008"], ["Vaise", "69009"], ["Gerland", "69007"]]) },
  { id: "london", name: "London", aliases: ["london", "londres", "greater london"], country: "GB", region: "England", center: { lat: 51.5072, lng: -0.1276 },
    extentKm: { s: 15, n: 15, w: 22, e: 22 }, capacity: 36000,
    neighbourhoods: coded([["Camden", "NW1"], ["Shoreditch", "E1"], ["Soho", "W1D"], ["Brixton", "SW9"], ["Islington", "N1"], ["Hackney", "E8"], ["Kensington", "W8"], ["Notting Hill", "W11"], ["Greenwich", "SE10"], ["Clapham", "SW4"], ["Peckham", "SE15"], ["Marylebone", "W1U"]]) },
  { id: "new-york", name: "New York", aliases: ["new york", "new york city", "nyc", "manhattan"], country: "US", region: "New York", center: { lat: 40.7549, lng: -73.984 },
    extentKm: { s: 18, n: 16, w: 10, e: 20 }, capacity: 40000,
    neighbourhoods: coded([["Harlem", "10027"], ["SoHo", "10012"], ["Williamsburg", "11211"], ["Chelsea", "10011"], ["Tribeca", "10013"], ["Astoria", "11102"], ["Greenwich Village", "10014"], ["Upper West Side", "10024"], ["Bushwick", "11237"], ["Park Slope", "11215"], ["Midtown", "10036"], ["Lower East Side", "10002"]]),
    streets: ["Broadway", "W 45th St", "E 14th St", "Lexington Ave", "Bedford Ave", "Atlantic Ave", "Amsterdam Ave", "Canal St", "Prince St", "Steinway St", "5th Ave", "Flatbush Ave"] },
  { id: "toronto", name: "Toronto", aliases: ["toronto"], country: "CA", region: "Ontario", center: { lat: 43.6532, lng: -79.3832 },
    extentKm: { s: 1, n: 20, w: 18, e: 22 }, capacity: 30000,
    neighbourhoods: coded([["Yorkville", "M5R"], ["Kensington Market", "M5T"], ["Leslieville", "M4M"], ["The Annex", "M5R"], ["Liberty Village", "M6K"], ["Distillery District", "M5A"], ["Little Italy", "M6G"], ["Cabbagetown", "M4X"], ["Roncesvalles", "M6R"], ["Scarborough", "M1P"], ["North York", "M2N"]]),
    streets: ["Queen St W", "King St E", "Yonge St", "Spadina Ave", "Dundas St W", "Bloor St W", "College St", "Danforth Ave", "Front St E", "Bathurst St"] },
];

export const CITY_BY_ID = new Map(CITIES.map((c) => [c.id, c]));

const kmPerDegLng = (lat: number) => (M_PER_DEG_LAT / 1000) * Math.cos((lat * Math.PI) / 180);
const KM_PER_DEG_LAT = M_PER_DEG_LAT / 1000;

/** The city's map area (viewport) as a rectangle. */
export function cityViewport(c: CityDef): Rect {
  const { s, n, w, e } = c.extentKm;
  const kx = kmPerDegLng(c.center.lat);
  return {
    low: { lat: c.center.lat - s / KM_PER_DEG_LAT, lng: c.center.lng - w / kx },
    high: { lat: c.center.lat + n / KM_PER_DEG_LAT, lng: c.center.lng + e / kx },
  };
}

/** Radius of the density peak around the centre, in km. */
export function cityRadiusKm(c: CityDef): number {
  const { s, n, w, e } = c.extentKm;
  return Math.max(2, 0.35 * ((s + n + w + e) / 2));
}

export function cityAreaKm2(c: CityDef): number {
  const { s, n, w, e } = c.extentKm;
  return (s + n) * (w + e);
}

/** Generic street names by language / style. */
export const STREETS: Record<"fr-africa" | "en-africa" | "fr" | "uk" | "us" | "ca", string[]> = {
  "fr-africa": [
    "Rue des Cocotiers", "Boulevard de la Paix", "Avenue de la Libération", "Rue du Commerce", "Rue des Hibiscus", "Avenue de l'Indépendance",
    "Rue des Flamboyants", "Rue de la Mission", "Avenue de la Nation", "Rue du Marché", "Rue des Écoles", "Rue de l'Église", "Rue des Manguiers",
    "Avenue des Nations Unies", "Rue de la Gare", "Rue du Lycée", "Rue des Palmiers", "Boulevard de la Côte", "Rue des Artisans", "Avenue de l'Unité",
  ],
  "en-africa": [
    "Liberation Road", "Independence Avenue", "Palm Street", "Ring Road", "Church Street", "Market Road", "Station Road", "High Street",
    "Mango Tree Avenue", "Unity Road", "School Lane", "Hospital Road", "Lake Road", "Airport Road", "Commercial Street", "Garden Close",
  ],
  fr: [
    "Rue de la République", "Rue Victor Hugo", "Boulevard Voltaire", "Rue des Lilas", "Avenue Jean Jaurès", "Rue du Faubourg Saint-Antoine",
    "Rue de la Paix", "Rue des Martyrs", "Rue de la Gare", "Place du Marché", "Rue Pasteur", "Quai des Arts", "Rue Mercière", "Cours Gambetta",
  ],
  uk: ["High Street", "Station Road", "Church Lane", "Market Street", "King Street", "Queen's Road", "Victoria Road", "Park Lane", "Mill Lane", "Albert Street", "Camden Road", "Brick Lane"],
  us: ["Broadway", "Main St", "Park Ave", "Lexington Ave", "5th Ave", "Bedford Ave"],
  ca: ["Queen St W", "King St E", "Yonge St", "Spadina Ave"],
};

/** Directional addresses common in West Africa ("En face de la pharmacie…"). */
export const LANDMARKS: Record<Language, string[]> = {
  fr: ["En face de la station-service", "Près du marché", "Derrière la mairie", "À côté de l'école primaire", "Près du grand carrefour", "En face de la pharmacie", "Près de la gare routière", "Derrière l'église"],
  en: ["Opposite the filling station", "Near the market", "Behind the post office", "Next to the primary school", "Near the main junction", "Opposite the pharmacy", "Near the lorry station", "Behind the church"],
};
