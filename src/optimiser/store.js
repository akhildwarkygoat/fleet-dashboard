/* ============================================================================
 * optimiser/store.js — data layer for stops, fleet and depot
 * ----------------------------------------------------------------------------
 * The ONLY module that knows where optimiser data lives (localStorage today,
 * a real DB tomorrow — swap the `backend` primitive). Seeds dummy Chennai data
 * on first run so the tab is demonstrable out of the box.
 *
 * Stop:  { id, route, name, lat, lng, headcount, absentee, source, filename }
 * Bus:   own  -> { id, name, type:"own",  capacity, loanMonth, driverDay, maintDay, dieselPerKm }
 *        rent -> { id, name, type:"rent", capacity, slabFixed, slabKm, perKmBeyond }
 * Depot: { name, lat, lng }
 * ==========================================================================*/

import { REAL_STOPS, REAL_FLEET, REAL_DEPOT } from "./realData.js";

const K_STOPS = "opt-stops-v14"; // v14: 200m-consolidated network — 691 stops, red = uncertain
const K_FLEET = "opt-fleet-v10"; // v10: REAL fleet — 69 physical buses from June 2026 attendance
const K_DEPOT = "opt-depot-v6";  // v6: factory moved to the real EXIF location
const K_STOPS_BACKUP = "opt-stops-backups"; // rolling snapshots taken before auto-zone (last 5)

export const UNITS = ["Gainup", "Technotek"];
const uid = () => Math.random().toString(36).slice(2, 9);

const backend = {
  read(k, fallback) { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : fallback; } catch { return fallback; } },
  write(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* quota */ } },
};

export function statusOf(s) {
  if (s.lat == null || s.lng == null) return "no-gps";
  return s.source === "manual" ? "manual" : "ok";
}
export const STATUS_LABEL = { ok: "GPS OK", manual: "Manual pin", "no-gps": "No GPS — needs pin" };

/* ------------------------------------------------------------ real seed data */
/* Seeds now come from realData.js (822 merged nodes + 69-bus June fleet, coords
 * aligned to public/road_matrix.json). The old dummy seeds below are RETIRED —
 * kept only for reference; nothing calls them. */
const seedStops = () => REAL_STOPS.map((s) => ({ id: uid(), ...s }));
const seedFleet = () => REAL_FLEET.map((b) => ({ id: uid(), ...b }));
const seedDepot = () => ({ ...REAL_DEPOT });

/* ----------------------------------------------------- RETIRED dummy seed data */
function seedStops_retiredDummy() {
  // Real Technotek field stops (Dindigul / Batlagundu area, 209 stops). Riders spread evenly
  // (~1777 registered total) with 12% absentee; company Technotek. Edit per stop in the table.
  const RAW = [
    ["Muthulapuram Stop 1",10.181897,77.788763,"Pattiveeranpatti"],
    ["Muthulapuram Stop 2",10.179628,77.78873,"Vattalagundu"],
    ["Kulipatti",10.127887,77.789165,"Kulipatti"],
    ["Sivananapuram",10.109412,77.805372,"Sivagnanapuram"],
    ["Bodiyakoundanpatti Stop 1",10.107348,77.816083,"Kullichettipatti"],
    ["Bodiyakoundanpatti Stop 2",10.102098,77.814508,"Bodiyakoundanpatti"],
    ["Kulichettypatti",10.096553,77.821605,"Kullichettipatti"],
    ["Kulichettypatti Eb Colony",10.099625,77.839223,"Pillayarnatham"],
    ["Pudukottai",10.010533,77.808617,"Pudukottai"],
    ["Chinnapalarpatti",9.997537,77.807962,"Usilampatti"],
    ["Chinnapalarpatti 2nd Stop",9.997517,77.807938,"Usilampatti"],
    ["Perumalkovilpatti",10.002307,77.80843,"Keeripatti"],
    ["Pasumponnagar",10.008853,77.802787,"Usilampatti"],
    ["Uthapanayakanur",10.015737,77.792023,"Vellaimalaipatti"],
    ["Kannapatti",10.037597,77.78966,"Uthappanaickanoor"],
    ["Mangarai",10.395435,77.866717,"Mangarai"],
    ["Thippampatti",10.378149,77.874015,"Dindigul"],
    ["Konur",10.377739,77.876892,"Kasavanampatty"],
    ["Vellampatti",10.361722,77.883289,"Dindigul"],
    ["Kasavanampatti",10.362169,77.870796,"Dindigul"],
    ["Kurumbapatti",10.369256,77.869129,"North Mettupatty"],
    ["Karisalpatti",10.359099,77.853381,"Dharmathupatti"],
    ["Palaya Kannivadi",10.353284,77.859148,"Dharmathupatti"],
    ["Lakshmipuram",10.207901,77.806315,"Nuthulapuram"],
    ["Pillayar Natham",10.141636,77.86979,"Nilakottai"],
    ["Kurumbapatti",10.148755,77.857302,"Kurumbapatty"],
    ["Valankottai",10.153077,77.864075,"Koovanuthu"],
    ["Agrakarapatti",10.148885,77.867655,"Koovanuthu"],
    ["Nilakottai",10.164955,77.852185,"Nilakottai"],
    ["Pilibnagar",10.170205,77.826347,"Nuthulapuram"],
    ["Nallampillai",10.225386,77.813321,"Salaippudur"],
    ["Vakkampatti",10.320822,77.907664,"Dindigul"],
    ["Panjampatti",10.320955,77.923592,"Panjanpatti N"],
    ["Township Nagar",10.304131,77.925005,"Kalikkampatti"],
    ["Kalikkampatti",10.303358,77.92835,"Kalikkampatti"],
    ["Pappanampatti",10.305514,77.955298,"Vellodu"],
    ["Vellode",10.305702,77.954055,"Vellodu"],
    ["Pannaipatti Pirivu",10.344368,78.058113,"Dindigul"],
    ["Airport Nagar",10.35993,78.019342,"Dindigul"],
    ["Uthanampatti",10.357873,78.010887,"Palakrishnapuram"],
    ["Kaattumadam",10.348991,78.00028,"Dindigul"],
    ["Kattakoothanpatti",10.142785,77.894857,"Murugathuran Patti"],
    ["Subburam Pattarai",10.349152,77.997605,"Dindigul"],
    ["Mariyanathapuram",10.349173,77.99025,"Dindigul"],
    ["Aariyanallur",10.318443,77.91585,"Aaiyanalur"],
    ["Kowndanpatti",10.132603,77.910918,"Pallapatti"],
    ["Kowndanpatti Colany",10.134425,77.909678,"Pallapatti"],
    ["Velayuthapuram",10.13388,77.891495,"Kullalakkundu"],
    ["Panjalankurichi",10.129673,77.8883,"Panchalankurichi"],
    ["Singampatti",10.151403,77.885843,"Silukkuvarpatti"],
    ["Kallipatti",10.413515,77.969749,"Kallippatti"],
    ["Collectorate",10.406835,77.959258,"Dindigul"],
    ["Periyar Nagar",10.396167,77.960594,"Dindigul"],
    ["Paraipatti",10.357129,77.936572,"Chinna Ponnimandurai"],
    ["Kottaipatti",10.358289,77.933063,"Chinna Ponnimandurai"],
    ["Ponnmanthurai",10.344347,77.925039,"Chinna Ponnimandurai"],
    ["Pithalaipatti",10.337132,77.927168,"Pithalaipatti"],
    ["Pillayarnattam",10.333742,77.930493,"Pillayarnattam"],
    ["Koolampatti",10.26927,77.864211,"Dindigul"],
    ["Palayankottai",10.266723,77.855082,"Athur"],
    ["Kullipatti",10.125485,77.779358,"Meenakshipuram"],
    ["Sivaznapuram",10.108882,77.808788,"Kullichettipatti"],
    ["S.vadipatti",10.100573,77.825747,"Dindigul"],
    ["Lakshmipuram",10.090698,77.82933,"Vadipatti"],
    ["Sithargal Natham",10.086458,77.842153,"Natham"],
    ["Kodikulam",9.972885,77.907592,"Kodikulam"],
    ["Kodikulam Colony",9.970862,77.909499,"Kodikulam"],
    ["Chellampatti",9.944676,77.895766,"Chellampatty"],
    ["Sakarapatti",9.950107,77.87663,"Sakkarapatti"],
    ["Valanthur Eb Stop",9.950609,77.875579,"Valandur"],
    ["Valanthur",9.952029,77.871313,"Valandur"],
    ["Cokkadevanpatti",9.952372,77.869722,"Chokkathevanpatti"],
    ["Kuppanpatti",9.94994,77.84692,"Kuppanampatti"],
    ["Kuppanampatti",9.949874,77.845844,"Kuppanampatti"],
    ["Kakkiveeranpatti",9.961166,77.80672,"Usilampatti"],
    ["Prc Depot",9.964791,77.796536,"Usilampatti"],
    ["Malaiyandi Theatre",9.965046,77.794575,"Usilampatti"],
    ["Kelaputhur Stop 1",9.965293,77.793908,"Usilampatti"],
    ["Kelaputhur Stop 2",9.965666,77.792681,"Usilampatti"],
    ["Usilampatti Poilce Station",9.965964,77.78889,"Usilampatti"],
    ["Kokanampatti",9.973695,77.792009,"Usilampatti"],
    ["Velaimalaipatti Stop 1",10.010522,77.792477,"Usilampatti"],
    ["Velaimalaipatti Pasumpon Nagar",10.015526,77.792084,"Vellaimalaipatti"],
    ["Authoor Akaraipatti",10.292293,77.851232,"Dindigul"],
    ["Authoor Poonsoorai",10.2893,77.85631,"Athoor"],
    ["Authoor Musilm Street",10.28818,77.853782,"Athoor"],
    ["Authoor Bus Stand",10.286995,77.853347,"Athoor"],
    ["Authoor Pathara Office",10.285407,77.85122,"Athur"],
    ["Authoor Taluk Office",10.28705,77.848847,"Dindigul"],
    ["Sithanyankottai Gh",10.270927,77.835747,"Sithayankottai"],
    ["Sithanyankottai Coffee Kadai",10.270195,77.833198,"Sithayankottai"],
    ["Sithanyankottai Nayakar Stop",10.269802,77.831592,"Sithayankottai"],
    ["Sithanyankottai Soceity Stop",10.268577,77.830007,"Sithayankottai"],
    ["Narasingapuram Junction",10.268352,77.821683,"Alagarnayakkanpatti"],
    ["Alagarnayakanpatti Mata Mill",10.267903,77.82531,"Alagarnayakkanpatti"],
    ["Alafarnayakanpatti Bus Stand",10.267525,77.827425,"Alagarnayakkanpatti"],
    ["Alagarnayakanpatti Bus Stand Stop 2",10.267343,77.828903,"Sithayankottai"],
    ["Sokiligapuram Junction 1",10.265632,77.830677,"Sithayankottai"],
    ["Sokiligapuram Junction 2",10.26473,77.832248,"Sithayankottai"],
    ["Sokilingapuram Bus Stand",10.262993,77.831547,"Sithayankottai"],
    ["Sokilingapuram Bus Stand 2",10.261193,77.830865,"Athur"],
    ["Bodikamanvadi",10.254857,77.821863,"Bodikkamanvadi"],
    ["Bodikamanvadi Stop 2",10.254845,77.823888,"Dindigul"],
    ["Michealpalayam Stop 1",10.20671,77.866408,"Michealpalayam"],
    ["Michealpalayam Stop 2",10.205597,77.86577,"Michealpalayam"],
    ["Kattunayakanpatti",10.197695,77.885063,"Nariyuthu"],
    ["Rayapanpatti",10.194428,77.865062,"Nariyuthu"],
    ["Senkottai",10.187127,77.857399,"Nariyuthu"],
    ["Ottur",10.186966,77.86112,"Nariyuthu"],
    ["Nilakottai Gh",10.172452,77.857493,"Nilakottai"],
    ["Nilkottai Gh Stop 2",10.170147,77.857208,"Nilakottai"],
    ["Kokarkulam",10.168488,77.857128,"Nilakottai"],
    ["Konkarkulam Stop 2",10.167208,77.856612,"Peraiyur"],
    ["Mariamman Kovil Stop",10.167765,77.849973,"Nilakottai"],
    ["Ration Kadai Nilakottai",10.16812,77.850097,"Nilakottai"],
    ["Ration Kadi Nilkottai Stop 2",10.169897,77.850578,"Nilakottai"],
    ["Apalapatti",10.178237,77.847273,"Dindigul"],
    ["Apalapatti Stop 2",10.183642,77.842548,"Nilakottai"],
    ["Thambinayankanpatti",10.183787,77.835015,"Nilakottai"],
    ["Viralipatti",10.191442,77.825478,"Dindigul"],
    ["Thumalapatti",10.19949,77.815513,"Chinnamanayakkanottai"],
    ["Thumalapatti Stop 2",10.199538,77.815387,"Chinnamanayakkanottai"],
    ["Thumalapatti Stop 3",10.199558,77.81394,"Chinnamanayakkanottai"],
    ["Sevugampatti Stop 1",10.198233,77.81322,"Noothalapuram"],
    ["Sevugampatti Stop 2",10.19804,77.806185,"Sevugampatti"],
    ["Sevugampatti Stop 3",10.197925,77.804085,"Sevugampatti"],
    ["Genguvarpatti Perumal Kovil",10.166503,77.694365,"Theni"],
    ["Genguvarpatti Vandi Karuppu Kovil",10.168252,77.694668,"Genguvarpatti"],
    ["Genguvarpatti Mahal Stop",10.16918,77.6949,"Genguvarpatti"],
    ["Genguvarpatti Kutty Vel Kadai",10.169195,77.69565,"Genguvarpatti"],
    ["Genguvarpatti Rice Mill",10.169278,77.696352,"Genguvarpatti"],
    ["Genguvarpatti Atm Stop",10.17075,77.697322,"Genguvarpatti"],
    ["Genguvarpatti Suresh Theatre",10.17109,77.698632,"Genguvarpatti"],
    ["Genguvarpatti Suresh Theatre Stop 2",10.171613,77.699655,"Genguvarpatti"],
    ["Kallupatti Kodi Maram",10.175045,77.702697,"Genguvarpatti"],
    ["Kallupatti Veeramangalam Stop",10.176272,77.702828,"G.kallupatti"],
    ["Kallupatti Pettai Stop",10.179048,77.703048,"G.kallupatti"],
    ["Kallupatti Kaliamman Kovil Stop",10.178885,77.703777,"G.kallupatti"],
    ["Thumalapatti Kovil",10.185465,77.711623,"Thumbalapatti"],
    ["Kanavaipatti Bus Stand",10.185393,77.73536,"Kanavaipatti"],
    ["Kanavaipatti Asaramam",10.183502,77.739225,"Asaramam"],
    ["Btl Navin Bakery",10.177048,77.759715,"Pazhaiya Vathalakundu"],
    ["Ayyampalayam Bus Stand",10.224425,77.746877,"Ayyampalayam"],
    ["Ayyamapalayam Anna Mandram",10.225167,77.747238,"Ayyampalayam"],
    ["Ayyampalayam Theatre Stop",10.226758,77.748248,"Udumalaipettai"],
    ["Ayyampalayam Arasa Maram Stop",10.226803,77.749573,"Ayyampalayam"],
    ["Ayyampalayam Water Pipe Stop",10.225717,77.750678,"Nilakottai"],
    ["Ayyampalayam Veppa Mara Stop",10.224572,77.750717,"Ayyampalayam"],
    ["Thevakarupanpatti Perivu",10.220758,77.754452,"Thevarappanpatti"],
    ["Muneeshwaran Kovil Stop",10.217673,77.756905,"Thevarappanpatti"],
    ["Pativeeranpatti Ghandhipuram Stop",10.214888,77.759558,"Pattiveeranpatti"],
    ["Pativeeranpatti Radio Maithanam",10.212838,77.761843,"Pattiveeranpatti"],
    ["Anna Nagar",10.20954,77.762035,"Pattiveeranpatti"],
    ["Pativeeranpatti Theatre Stop",10.205472,77.765001,"Pattiveeranpatti"],
    ["Vadipaati Guruvel Nagar",10.192543,77.770593,"M.vadipatti"],
    ["Vadipatti Bus Stand",10.188424,77.773366,"M.vadipatti"],
    ["Vadipatti Ayyapan Kovil",10.186691,77.774965,"M.vadipatti"],
    ["Sealinayankanpatti",9.855248,77.685093,"Sealinayakanpatti"],
    ["Elumalai",9.86511,77.700035,"Elumalai"],
    ["Uthapuram",9.871192,77.71373,"Uthapuram"],
    ["Uthapuram Stop2",9.870582,77.716043,"Uthapuram"],
    ["Jothinayakanur",9.88169,77.753337,"Tadayampatti"],
    ["Rajakapatti",9.885863,77.764055,"Jothilnaickanur"],
    ["Perumalkovilpatti",9.881777,77.798532,"Perumalkovilpatti"],
    ["Kanavaipatti",9.912527,77.793905,"Kanavaipatti"],
    ["Samathivapuram",9.924112,77.789495,"Nalladevanpatti"],
    ["Naludevanpatti",9.938402,77.788343,"Nalludevanpatti"],
    ["Panapati",9.949357,77.788892,"Usilampatti"],
    ["Usilampatti Guru Mahal",9.956263,77.788958,"Usilampatti"],
    ["Usilampatti Police Station",9.96599,77.788825,"Usilampatti"],
    ["Usilampatti Railway Gate Stop 1",9.97004,77.789998,"Usilampatti"],
    ["Usilamaptti Railway Gate Stop 2",9.971263,77.790065,"Usilampatti"],
    ["Meiyanampatti",9.979813,77.790863,"Seemanoothu"],
    ["Veeruvedu",10.079927,77.781815,"Veerapandi"],
    ["Kannapatti Stop 1",10.105658,77.777112,"Kannapatti"],
    ["Kannapatti Stop 2",10.1086,77.775715,"Kannapatti"],
    ["Silvarpatti",10.308937,78.139801,"V.s.k.valasai"],
    ["Silvarpatti Stop 2",10.308452,78.139498,"V.s.k.valasai"],
    ["Pudhur Junction",10.306706,78.138547,"V.s.k.valasai"],
    ["Manikaranpatti",10.299741,78.13602,"Maniyakkaranpatti"],
    ["Pallpatti",10.276968,78.133687,"Timmananallur"],
    ["Pallapatti Stop2",10.275695,78.133192,"Timmananallur"],
    ["Paraipatti",10.272547,78.127718,"Timmananallur"],
    ["Gopalpatti",10.257357,78.120977,"Gopalpatti"],
    ["Gopalpatti Gh",10.258732,78.117818,"Gopalpatti"],
    ["Gopalpatti Pertrol Bunk",10.260092,78.11435,"Gopalpatti"],
    ["Velakaddu Road",10.26268,78.107975,"Dindigul"],
    ["Sanarpatti Pertol Bunk",10.275127,78.079978,"Anjukulipatti"],
    ["Union Office",10.277548,78.074833,"Sanarpatti"],
    ["Sanarpatti Bus Stand",10.279852,78.071742,"Sanarpatti"],
    ["Kosavapatti",10.28619,78.063433,"Kosavapatti"],
    ["Viralipatti",10.290565,78.046605,"Viralipatti"],
    ["Kottaipatti Rice Mill",10.30083,78.03059,"Dindigul"],
    ["Nochiodaipatti",10.305382,78.027842,"Koovanuthu"],
    ["Reddiyapatti",10.3237,78.007778,"Tottanuthu"],
    ["Sirumalai Junction",10.325998,78.004898,"Tottanuthu"],
    ["Valakaipatti Junction",10.331968,77.999945,"Valakkaipatti"],
    ["Nallampatti Junction",10.343208,77.991337,"Dindigul"],
    ["Vijay Theatre",10.350372,77.984147,"Dindigul"],
    ["Nagal Nagar",10.354402,77.978462,"Dindigul"],
    ["Nagal Nagar Roundana",10.355108,77.977432,"Dindigul"],
    ["Angu Vilas",10.3562,77.970523,"Dindigul"],
    ["Yannai Thepam",10.356535,77.96685,"Hasanathpuram"],
    ["Begampur Junction",10.355355,77.96592,"Dindigul"],
    ["Begampur Rasi Bunk",10.354785,77.961917,"Dindigul"],
    ["Dindigul Paraipatti",10.35329,77.958638,"Dindigul"],
    ["Ap Nagar",10.352307,77.957398,"Ayyampalayam"],
    ["Ap Nagar Stop 2",10.35143,77.955943,"Dindigul"],
    ["Pithalipatti Junction",10.334552,77.932587,"Pillayarnattam"]
  ];
  const per = Math.round(1777 / RAW.length);
  return RAW.map(([name, lat, lng, village]) => ({
    id: uid(), route: "Imported", name, lat, lng, village,
    headcount: per, absentee: 0.12, company: "Technotek", source: "csv", filename: "",
  }));
}

function seedFleet_retiredDummy() {
  // Technotek real fleet (from the Jun 2026 attendance abstract): 20 owned big buses (54/55-seat,
  // plus one 50) + 37 rental vans (36×15-seat, one 9). Rentals share the tiered day tariff
  // (engine.RENT_TARIFF); slabFixed/slabKm/perKmBeyond are the base-tier figures the OR-Tools backend uses.
  //
  // SAMPLE owned costs — real monthly totals spread evenly across the 20 owned buses.
  // cost/head here is an OPERATING metric (driver + maint + diesel); it EXCLUDES the EMI,
  // matching the real ~₹72/head benchmark. The loan (Σ12 EMIs ₹13,25,400/mo ≈ ₹66,270/bus)
  // is capital tracked separately — set loanMonth back to 66270 if you want it in cost/head.
  //   loan    : EXCLUDED from operating cost/head (capital)                  = ₹0/mo
  //   Owned-bus model (user 2026 figures) ÷ 312 working days/yr (26×12):
  //   driver  : ₹18,000/bus/mo × 12 ÷ 312                                    = ₹692/day
  //   maint   : (maint 30k + tyres 62k + tyre-maint 20k + FC ~35k)/312       = ₹471/day
  //             + (insurance 79k + road tax 132k)/312 = ₹676  [folded here]  = ₹1,147/day
  //   diesel  : flat ₹/km (user)                                            = ₹18.00/km
  const OWN = { loanMonth: 0, driverDay: 692, maintDay: 1147, dieselPerKm: 18.00 };
  const owned = [
    ["TN57BC3636", 50], ["TN57BP3434", 55], ["TN57BS3434", 55], ["TN57CB3434", 55], ["TN57CD3434", 55],
    ["TN57CE3434", 55], ["TN57CF3434", 55], ["TN57CF3636", 55], ["TN57CH3636", 55], ["TN57CJ3636", 55],
    ["TN57CL3434", 54], ["TN58BK3636", 54], ["TN58BL3434", 55], ["TN58BL3636", 54], ["TN58BM3434", 55],
    ["TN58BP3434", 55], ["TN60AP3434", 55], ["TN60AQ3434", 55], ["TN60AS3434", 55], ["TN60AS3636", 55],
  ];
  const rentals = [
    ["TN02AB5688", 15], ["TN030857", 15], ["TN05V6697", 15], ["TN20AJ3944", 15], ["TN20AK5513", 15],
    ["TN20AL3611", 15], ["TN20AU6396", 15], ["TN23AC2721", 15], ["TN25M4073", 15], ["TN25M4928", 15],
    ["TN31AB3789", 15], ["TN31AC0182", 15], ["TN31AY8208", 15], ["TN31CD6636", 15], ["TN31J6001", 15],
    ["TN32AA4015", 15], ["TN36L5458", 15], ["TN39AP2287", 15], ["TN39AZ4680", 15], ["TN40W3708", 15],
    ["TN41S5818", 15], ["TN41T5270", 15], ["TN41W8996", 15], ["TN42A3533", 15], ["TN45AP3948", 15],
    ["TN46F3361", 15], ["TN49AW5908", 15], ["TN54T2368", 15], ["TN57L8446", 15], ["TN57P6909", 15],
    ["TN58BC3494", 9], ["TN58S5303", 15], ["TN59AB3444", 15], ["TN59AH9703", 15], ["TN63E9861", 15],
    ["TN69M1957", 15], ["TN74AW0645", 15],
  ];
  const rent = (name, capacity) => ({ id: uid(), name, type: "rent", capacity, slabFixed: 1700, slabKm: 80, perKmBeyond: 18.7 });
  return [
    ...owned.map(([name, capacity]) => ({ id: uid(), name, type: "own", capacity, ...OWN })),
    ...rentals.map(([name, capacity]) => rent(name, capacity)),
  ];
}
const seedDepot_retiredDummy = () => ({ name: "FACTORY", lat: 10.207550, lng: 77.806206 }); // same as REAL_DEPOT (photo EXIF)

/* ----------------------------------------------------------------- stops API */
export function getStops() { return backend.read(K_STOPS, null) || (() => { const s = seedStops(); backend.write(K_STOPS, s); return s; })(); }
function writeStops(list) { backend.write(K_STOPS, list); }

/** Sync the stop network from the live-ERP merged stops (public/merged_stops.json).
 *  Replaces the seeded/stale network with the ERP-derived one while KEEPING the id
 *  (and user-set route/village/absentee/company) of any stop that matches by
 *  coordinate — so Planner drafts and edits survive a refresh. */
export function syncStopsFromErp(erpStops) {
  const existing = getStops();
  const byKey = new Map(existing.filter((s) => s.lat != null && s.lng != null).map((s) => [coordKey(s.lat, s.lng), s]));
  let matched = 0;
  const next = (erpStops || []).filter((e) => isFinite(+e.lat) && isFinite(+e.lng)).map((e) => {
    const old = byKey.get(coordKey(e.lat, e.lng));
    if (old) matched++;
    return {
      id: old ? old.id : uid(),
      route: old ? old.route : "ERP",
      name: (e.name || "").trim() || (old && old.name) || "Stop",
      lat: +e.lat, lng: +e.lng,
      village: old ? old.village : "",
      headcount: e.headcount != null ? +e.headcount : (old ? old.headcount : 0),
      absentee: old && old.absentee != null ? old.absentee : 0.12,
      company: old ? old.company : "Gainup",
      source: "erp",
    };
  });
  if (!next.length) return { synced: false };
  writeStops(next);
  return { synced: true, stops: next.length, matched, added: next.length - matched };
}
export function getStopsWithStatus() { return getStops().map((s) => ({ ...s, status: statusOf(s) })); }
export function getRoutes() { const seen = []; for (const s of getStops()) if (!seen.includes(s.route)) seen.push(s.route); return seen; }
export function addMany(route, parsed) {
  const list = getStops();
  const created = parsed.map((p) => ({
    id: uid(), route, name: p.name, lat: p.hasGps ? p.lat : null, lng: p.hasGps ? p.lng : null, village: "",
    headcount: 25, absentee: 0.10, company: "Gainup", source: "exif", filename: p.file ? p.file.name : p.filename || p.name,
  }));
  writeStops([...list, ...created]);
  return created;
}

/* dedupe key: two stops at the same ~1m coordinate are the same stop */
const coordKey = (la, ln) => Number(la).toFixed(5) + "," + Number(ln).toFixed(5);

/** Bulk-add stops parsed from a CSV ({name, lat, lng, village} rows).
 *  Riders/absentee/company get defaults (editable in the table). Skips rows with
 *  no valid coordinates and de-dupes by coordinate. opts.replace wipes existing
 *  stops first (but never wipes to empty if nothing valid parsed). */
export function addImported(rows, opts = {}) {
  const base = opts.replace ? [] : getStops();
  const seen = new Set(base.filter((s) => s.lat != null && s.lng != null).map((s) => coordKey(s.lat, s.lng)));
  const route = opts.route || "Imported";
  const created = [];
  let skipped = 0, dupes = 0;
  for (const r of rows || []) {
    const lat = parseFloat(r.lat), lng = parseFloat(r.lng);
    if (!isFinite(lat) || !isFinite(lng)) { skipped++; continue; }
    const key = coordKey(lat, lng);
    if (seen.has(key)) { dupes++; continue; }
    seen.add(key);
    created.push({
      id: uid(), route, name: (r.name || "").trim() || "Unnamed stop", lat, lng, village: (r.village || "").trim(),
      headcount: 25, absentee: 0.10, company: "Gainup", source: "csv", filename: "",
    });
  }
  if (created.length || !opts.replace) writeStops([...base, ...created]);
  return { added: created.length, skipped, dupes, replaced: !!opts.replace };
}
export function addStop(stop) {
  const row = { id: uid(), route: stop.route, name: stop.name || "Unnamed stop", lat: stop.lat ?? null, lng: stop.lng ?? null, village: stop.village || "", headcount: +stop.headcount || 25, absentee: stop.absentee ?? 0.10, company: stop.company || "Gainup", source: stop.source || "manual", filename: "" };
  writeStops([...getStops(), row]);
  return row;
}
export function updateStop(id, patch) {
  writeStops(getStops().map((s) => {
    if (s.id !== id) return s;
    const m = { ...s, ...patch };
    if (("lat" in patch || "lng" in patch) && patch.source == null) m.source = "manual";
    return m;
  }));
}
export function removeStop(id) { writeStops(getStops().filter((s) => s.id !== id)); }
export function renameRoute(oldName, newName) { writeStops(getStops().map((s) => (s.route === oldName ? { ...s, route: newName } : s))); }
export function findDuplicateNames(names, route) {
  const set = new Set(getStops().filter((s) => (route ? s.route === route : true)).map((s) => s.name.toLowerCase()));
  return names.filter((n) => set.has((n || "").toLowerCase()));
}

/* ----------------------------------------------------------------- fleet API */
export function getFleet() { return backend.read(K_FLEET, null) || (() => { const f = seedFleet(); backend.write(K_FLEET, f); return f; })(); }
export function setFleet(list) { backend.write(K_FLEET, list); }
export function updateBus(id, patch) { setFleet(getFleet().map((b) => (b.id === id ? { ...b, ...patch } : b))); }
export function addBus(type) {
  const base = type === "own"
    ? { id: uid(), name: "OWN-?", type: "own", capacity: 40, loanMonth: 35000, driverDay: 800, maintDay: 280, dieselPerKm: 22 }
    : { id: uid(), name: "RENT-?", type: "rent", capacity: 40, slabFixed: 1800, slabKm: 55, perKmBeyond: 32 };
  setFleet([...getFleet(), base]);
}
export function removeBus(id) { setFleet(getFleet().filter((b) => b.id !== id)); }

/* ----------------------------------------------------------------- depot API */
export function getDepot() { return backend.read(K_DEPOT, null) || (() => { const d = seedDepot(); backend.write(K_DEPOT, d); return d; })(); }
export function setDepot(d) { backend.write(K_DEPOT, d); }

/* --------------------------------------------------- editable plan drafts (v1)
 * A draft is a plain object { assignments: { [busId]: stopId[] }, ts }. Keyed so the
 * "New plan" builder and the route editor keep separate saved work. */
export function saveDraftPlan(key, assignments) {
  const obj = {};
  for (const [busId, ids] of (assignments instanceof Map ? assignments : Object.entries(assignments))) obj[busId] = ids;
  backend.write("opt-draft-" + key, { assignments: obj, ts: Date.now() });
}
export function getDraftPlan(key) { return backend.read("opt-draft-" + key, null); }
export function clearDraftPlan(key) { backend.write("opt-draft-" + key, null); }

/* --------------------------------------------------- named plan drafts (v2, Google-Docs style)
 * Many saved plans, each: { id, name, ts (last edited), created, assignments:{busId:stopId[]}, meta }.
 * meta = { riders, buses, stops } for the gallery cards. Stored together under one key. */
const K_PLAN_DRAFTS = "opt-plan-drafts";
function readPlanDrafts() { return backend.read(K_PLAN_DRAFTS, {}) || {}; }
export function listPlanDrafts() { return Object.values(readPlanDrafts()).sort((a, b) => (b.ts || 0) - (a.ts || 0)); }
export function getPlanDraft(id) { return readPlanDrafts()[id] || null; }
export function savePlanDraft({ id, name, assignments, meta }) {
  const drafts = readPlanDrafts();
  const obj = {};
  for (const [busId, ids] of (assignments instanceof Map ? assignments : Object.entries(assignments || {}))) obj[busId] = ids;
  const did = id || uid();
  drafts[did] = { id: did, name: (name || "Untitled plan").trim() || "Untitled plan",
    assignments: obj, meta: meta || {}, ts: Date.now(), created: (drafts[did] && drafts[did].created) || Date.now() };
  backend.write(K_PLAN_DRAFTS, drafts);
  return did;
}
export function renamePlanDraft(id, name) { const d = readPlanDrafts(); if (d[id]) { d[id].name = (name || "").trim() || d[id].name; backend.write(K_PLAN_DRAFTS, d); } }
export function deletePlanDraft(id) { const d = readPlanDrafts(); delete d[id]; backend.write(K_PLAN_DRAFTS, d); }

/* ----------------------------------------------------------- backup / restore */
/* Snapshot the current stops before a destructive op (auto-zone). Keeps the last 5. */
export function backupStops(label = "") {
  const cur = getStops();
  let arr = backend.read(K_STOPS_BACKUP, []) || [];
  arr.unshift({ ts: Date.now(), label, count: cur.length, stops: cur });
  arr = arr.slice(0, 5);
  backend.write(K_STOPS_BACKUP, arr);
  return arr.length;
}
export function hasBackup() { const a = backend.read(K_STOPS_BACKUP, []); return !!(a && a.length); }
export function listBackups() { return (backend.read(K_STOPS_BACKUP, []) || []).map(({ ts, label, count }) => ({ ts, label, count })); }
/* Restore the most recent snapshot. Returns true if one existed. */
export function restoreLatestBackup() {
  const a = backend.read(K_STOPS_BACKUP, []) || [];
  if (!a.length) return false;
  writeStops(a[0].stops);
  return true;
}

/* ------------------------------------------------------------------ auto-zone */
/* Group GPS stops into geographic zones of <= cap each and write each stop's
 * `route` to "Z1".."Zn" (left-to-right). Deterministic: farthest-point seeding +
 * capacity-balanced k-means on an equirectangular projection. Non-GPS stops keep
 * their current route. Snapshots first (restoreLatestBackup undoes it). */
export function autoZone(cap = 55) {
  const all = getStops();
  const pts = all.filter((s) => s.lat != null && s.lng != null);
  if (!pts.length) return { zones: 0, cap, firstZone: null, zoneCounts: {} };
  backupStops("before auto-zone");

  const k = Math.max(1, Math.ceil(pts.length / cap));
  // Depot-aware feature space: km offsets from the depot (dx east, dy north) PLUS a
  // weighted distance-from-depot (z). The z dimension keeps near and far stops in
  // SEPARATE zones even when they sit in the same direction — so a zone never mixes a
  // 7km stop with a 41km one (which forced long rides + poor utilisation before).
  const depot = getDepot();
  const latMean = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const kx = Math.cos((latMean * Math.PI) / 180);
  const Wd = 1.5; // distance-from-depot weight (0 = pure geography; higher = stricter distance banding)
  const X = pts.map((p) => {
    const dy = (p.lat - depot.lat) * 111;
    const dx = (p.lng - depot.lng) * 111 * kx;
    return { x: dx, y: dy, z: Wd * Math.hypot(dx, dy) };
  });
  const d2 = (a, b) => { const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z; return dx * dx + dy * dy + dz * dz; };

  // farthest-point seeding (deterministic: start at the westmost/southmost point)
  let start = 0;
  for (let i = 1; i < X.length; i++) if (X[i].x < X[start].x || (X[i].x === X[start].x && X[i].y < X[start].y)) start = i;
  const seeds = [start];
  while (seeds.length < k) {
    let best = 0, bestD = -1;
    for (let i = 0; i < X.length; i++) {
      let nd = Infinity; for (const s of seeds) nd = Math.min(nd, d2(X[i], X[s]));
      if (nd > bestD) { bestD = nd; best = i; }
    }
    seeds.push(best);
  }
  let centroids = seeds.map((i) => ({ ...X[i] }));
  const assign = new Array(X.length).fill(0);

  for (let iter = 0; iter < 30; iter++) {
    for (let i = 0; i < X.length; i++) {
      let bc = 0, bd = Infinity;
      for (let c = 0; c < k; c++) { const dd = d2(X[i], centroids[c]); if (dd < bd) { bd = dd; bc = c; } }
      assign[i] = bc;
    }
    const sum = Array.from({ length: k }, () => ({ x: 0, y: 0, z: 0, n: 0 }));
    for (let i = 0; i < X.length; i++) { const c = assign[i]; sum[c].x += X[i].x; sum[c].y += X[i].y; sum[c].z += X[i].z; sum[c].n++; }
    for (let c = 0; c < k; c++) if (sum[c].n) centroids[c] = { x: sum[c].x / sum[c].n, y: sum[c].y / sum[c].n, z: sum[c].z / sum[c].n };
  }

  // capacity rebalance: move the farthest-from-centroid point out of any over-cap
  // zone into the nearest zone with room (k = ceil(n/cap) guarantees room exists)
  const counts = () => { const ct = new Array(k).fill(0); for (const a of assign) ct[a]++; return ct; };
  for (let pass = 0; pass < X.length + k; pass++) {
    const ct = counts();
    const over = ct.findIndex((n) => n > cap);
    if (over < 0) break;
    let far = -1, farD = -1;
    for (let i = 0; i < X.length; i++) if (assign[i] === over) { const dd = d2(X[i], centroids[over]); if (dd > farD) { farD = dd; far = i; } }
    let bc = -1, bd = Infinity;
    for (let c = 0; c < k; c++) if (c !== over && ct[c] < cap) { const dd = d2(X[far], centroids[c]); if (dd < bd) { bd = dd; bc = c; } }
    if (bc < 0) break;
    assign[far] = bc;
  }

  // label zones nearest-first by centroid distance from depot, as Z1..Zm (Z1 = closest/tightest)
  const cdist = (c) => Math.hypot(centroids[c].x, centroids[c].y);
  const used = [...new Set(assign)].sort((a, b) => cdist(a) - cdist(b));
  const label = {}; used.forEach((c, idx) => (label[c] = "Z" + (idx + 1)));
  const routeById = new Map();
  pts.forEach((p, i) => routeById.set(p.id, label[assign[i]]));
  const updated = all.map((s) => (routeById.has(s.id) ? { ...s, route: routeById.get(s.id) } : s));
  writeStops(updated);

  const zoneCounts = {}; for (const a of assign) { const L = label[a]; zoneCounts[L] = (zoneCounts[L] || 0) + 1; }
  return { zones: used.length, cap, firstZone: label[used[0]], zoneCounts };
}

/* --------------------------------------------------------------- reset / util */
export function resetAll() { backend.write(K_STOPS, seedStops()); backend.write(K_FLEET, seedFleet()); backend.write(K_DEPOT, seedDepot()); }
export function summarize(list) { const total = list.length, withGps = list.filter((s) => s.lat != null && s.lng != null).length; return { total, withGps, needFix: total - withGps }; }
