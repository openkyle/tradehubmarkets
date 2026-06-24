const MODULE_ID = "tradehub-markets";
const SOCKET = `module.${MODULE_ID}`;
const LEGACY_ID = "tradehub";
const NEWS_FOLDER_NAME = "TradeHubMarkets";
const NEWS_JOURNAL_NAME = "TradeHubNews";
const LEGACY_NEWS_JOURNAL_NAME = "TradeHub News Stories";

const DEFAULT_DATA = {
  capital: 0,
  currentLocation: "",
  locations: {},
  markets: {},
  shipDirectory: [],
  activeRumours: [],
  tickerSelections: {}
};

let selectedShipId = null;
let selectedShipName = "";
const openWindows = new Set();
const pristineRefreshTimers = new Map();

const clone = value => foundry.utils.deepClone(value);
const duplicateDoc = doc => doc.toObject ? doc.toObject() : clone(doc);
const setting = key => game.settings.get(MODULE_ID, key);
const setSetting = (key, value) => game.settings.set(MODULE_ID, key, value);
const formatGp = value => `${Number(Math.floor(value || 0)).toLocaleString()} GP`;
const stripHtml = html => String(html || "").replace(/<[^>]*>/g, "").trim();
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const parseNumber = value => {
  if (typeof value === "number") return value;
  const match = String(value ?? "").match(/-?\d[\d,]*(\.\d+)?/);
  return match ? Number(match[0].replace(/,/g, "")) : 0;
};

function moduleApi() {
  game.tradehub = game.tradehub || {};
  game.tradehub.SplashPage = SplashPage;
  game.tradehub.BuyGoodsPage = BuyGoodsPage;
  game.tradehub.SellGoodsPage = SellGoodsPage;
  game.tradehub.RestockPage = RestockPage;
  game.tradehub.RepairShipPage = RepairShipPage;
  game.tradehub.ShipyardPage = ShipyardPage;
  game.tradehub.ShipToolsPage = ShipToolsPage;
  game.tradehub.CombatDamagePage = CombatDamagePage;
  game.tradehub.MeetNpcPage = MeetNpcPage;
  game.tradehub.MeetSystemPage = MeetSystemPage;
  game.tradehub.HeroesForHirePage = HeroesForHirePage;
  game.tradehub.FinesPage = FinesPage;
  game.tradehub.DockingPage = DockingPage;
  game.tradehub.BankingPage = BankingPage;
  game.tradehub.ConfigPage = ConfigPage;
  game.tradehub.refresh = refreshOpenWindows;
}

Hooks.once("init", () => {
  registerSettings();
  moduleApi();
});

Hooks.once("ready", async () => {
  moduleApi();
  game.socket.on(SOCKET, handleSocket);
  if (game.user.isGM && !setting("data")) await setSetting("data", clone(DEFAULT_DATA));
  if (game.user.isGM) {
    const data = getData();
    if (!data.capital && bankActor()?.system?.currency?.gp) data.capital = Number(bankActor().system.currency.gp || 0);
    syncShipDirectory(data);
    await setSetting("data", data);
  }
  if (game.user.isGM && setting("showGmBar")) GmBar.render();
});

Hooks.on("renderChatMessage", (message, html) => {
  html.find("[data-thm-heat-sink], [data-thm-heat-sink-no]").on("click", ev => {
    ev.preventDefault();
    const button = ev.currentTarget;
    const payload = {
      actorId: button.dataset.actorId,
      amount: Number(button.dataset.amount || 0),
      reason: button.dataset.reason || "",
      extra: button.dataset.extra || "",
      attack: Number(button.dataset.attack || 0),
      damageType: button.dataset.damageType || "thermal",
      mode: button.dataset.mode || "carryover",
      messageId: message.id
    };
    requestGm(button.dataset.thmHeatSinkNo !== undefined ? "declineHeatSink" : "deployHeatSink", payload);
  });
});

Hooks.on("renderSceneControls", () => {
  if (game.user.isGM && setting("showGmBar")) GmBar.render();
});

Hooks.on("createItem", item => {
  const actor = item?.parent;
  if (!game.user.isGM || actor?.type !== "vehicle" || !["equipment", "weapon"].includes(item?.type)) return;
  scheduleVehicleStatSync(actor, `${item.name} added`);
});

Hooks.on("deleteItem", item => {
  const actor = item?.parent;
  if (!game.user.isGM || actor?.type !== "vehicle" || !["equipment", "weapon"].includes(item?.type)) return;
  scheduleVehicleStatSync(actor, `${item.name} removed`);
});

Hooks.on("updateItem", (item, changes) => {
  const actor = item?.parent;
  if (!game.user.isGM || actor?.type !== "vehicle" || !["equipment", "weapon"].includes(item?.type)) return;
  const relevant = [
    "name",
    "system.equipped",
    "system.hp.value",
    "system.hp.max",
    "system.armor.value",
    "system.ac.value",
    "system.price",
    "system.price.value"
  ].some(path => foundry.utils.hasProperty(changes, path));
  if (relevant) scheduleVehicleStatSync(actor, `${item.name} updated`);
});

function registerSettings() {
  const register = (key, data) => game.settings.register(MODULE_ID, key, data);
  game.settings.registerMenu(MODULE_ID, "settingsMenu", {
    name: "TradeHub Markets Settings",
    label: "Open TradeHub Settings",
    hint: "Configure compendiums, folders, capital, labels, market math, ads, and the floating GM control bar.",
    icon: "fas fa-cog",
    type: TradeHubSettingsForm,
    restricted: true
  });
  register("data", { scope: "world", config: false, type: Object, default: clone(DEFAULT_DATA) });
  register("tradeGoodsPack", {
    name: "Trade Goods Compendium",
    hint: "Pack id containing trade goods, for example world.trade-goods or module-name.pack-name.",
    scope: "world",
    config: false,
    type: String,
    default: ""
  });
  register("tradeGoodsFolderPath", {
    name: "Trade Goods Compendium Folder",
    hint: "Optional folder or subfolder path inside the trade goods compendium. Leave blank to use the whole pack.",
    scope: "world",
    config: false,
    type: String,
    default: ""
  });
  register("vehicleConsumablesPack", {
    name: "Vehicle Consumables Compendium",
    hint: "Pack containing ammo, restock items, and repair consumables.",
    scope: "world",
    config: false,
    type: String,
    default: ""
  });
  register("vehicleConsumablesFolderPath", {
    name: "Vehicle Consumables Folder",
    hint: "Optional folder path inside the vehicle consumables compendium.",
    scope: "world",
    config: false,
    type: String,
    default: ""
  });
  register("shipyardPack", {
    name: "Shipyard Vehicles Compendium",
    hint: "Actor compendium containing purchasable vehicles.",
    scope: "world",
    config: false,
    type: String,
    default: ""
  });
  register("shipyardFolderPath", {
    name: "Shipyard Folder",
    hint: "Optional folder path inside the shipyard vehicle compendium.",
    scope: "world",
    config: false,
    type: String,
    default: ""
  });
  register("adFolder", {
    name: "Advertisement Folder",
    hint: "FilePicker folder or URL folder used for random market ads. Each player gets a random ad on their own client.",
    scope: "world",
    config: false,
    type: String,
    default: "https://assets.forge-vtt.com/62bf9a2b7fa42ce7966f6738/STARPG/Ads/Horizontal/"
  });
  register("marketplaceImage", {
    name: "Marketplace Splash Image URL",
    scope: "world",
    config: false,
    type: String,
    default: `modules/${MODULE_ID}/images/splashimage.webp`
  });
  register("heroesForHireImage", {
    name: "Heroes for Hire Banner Image",
    hint: "16:9 banner image shown on the Heroes for Hire panel. GMs can set it from the H4H panel.",
    scope: "world",
    config: false,
    type: String,
    default: "https://assets.forge-vtt.com/62bf9a2b7fa42ce7966f6738/STARPG/Icons/H4H2.webp"
  });
  register("dockSoundPath", {
    name: "Dock / Travel Sound File",
    hint: "Optional audio file path or URL played for all players when Dock / Travel is confirmed and Play Dock Sound is checked.",
    scope: "world",
    config: false,
    type: String,
    default: ""
  });
  register("starportLoadSoundPath", {
    name: "Starport Services Load Sound File",
    hint: "Optional audio file path or URL played locally when Starport Services opens.",
    scope: "world",
    config: false,
    type: String,
    default: ""
  });
  register("bankActorName", { name: "Bank Actor Name", scope: "world", config: false, type: String, default: "Bank of Holding" });
  register("bankFolderName", { name: "Bank Actor Folder", scope: "world", config: false, type: String, default: "Party" });
  register("ammoRestockPack", {
    name: "Ammunition Restock Compendium",
    hint: "Dedicated pack containing ammunition and restock items.",
    scope: "world",
    config: false,
    type: String,
    default: ""
  });
  register("ammoRestockFolderPath", {
    name: "Ammunition Restock Folder",
    hint: "Optional folder path inside the ammunition restock compendium.",
    scope: "world",
    config: false,
    type: String,
    default: ""
  });
  register("repairCostPerHp", {
    name: "Repair Cost Per HP",
    hint: "TradeHub internal capital cost to restore one missing equipment HP.",
    scope: "world",
    config: false,
    type: Number,
    default: 100
  });
  register("repairCostPerShieldPoint", {
    name: "Repair Cost Per Shield Point",
    hint: "TradeHub internal capital cost to restore one missing shield generator HP.",
    scope: "world",
    config: false,
    type: Number,
    default: 100
  });
  register("vehicleLabel", { name: "Vehicle Label", hint: "Shown in menus as Vessel, Ship, Vehicle, Carriage, etc.", scope: "world", config: false, type: String, default: "Vessel" });
  register("showGmBar", {
    name: "Show Floating GM TradeHub Controls",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
    onChange: value => value ? GmBar.render() : GmBar.close()
  });
  register("gmBarPosition", { scope: "client", config: false, type: Object, default: { left: 12, top: 120 } });
  register("launchOnDock", {
    name: "Launch Marketplace on Dock",
    hint: "Automatically opens Starport Services for all logged-in users when the GM docks the party.",
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });
  register("stockMin", { name: "Market Stock Minimum", scope: "world", config: false, type: Number, default: 200 });
  register("stockMax", { name: "Market Stock Maximum", scope: "world", config: false, type: Number, default: 1300 });
  register("maxPriceChangePercent", { name: "Maximum Price Change Percent", scope: "world", config: false, type: Number, default: 15 });
  register("maxShortagePriceIncreasePercent", {
    name: "Maximum Shortage Price Increase Percent",
    hint: "Highest possible hidden price increase from predictive TradeHub News rumours.",
    scope: "world",
    config: false,
    type: Number,
    default: 57
  });
  register("enableTradeRumours", {
    name: "Enable Predictive Trade Rumours",
    hint: "Wildcard ticker hints that can secretly influence future market prices for attentive players.",
    scope: "world",
    config: false,
    type: Boolean,
    default: true
  });
  register("seenAds", { scope: "client", config: false, type: Array, default: [] });
}

function getData() {
  const data = setting("data");
  const merged = !data || !data.locations ? clone(DEFAULT_DATA) : foundry.utils.mergeObject(clone(DEFAULT_DATA), clone(data), { inplace: false });
  normalizeLocationData(merged);
  return merged;
}

function normalizeLocationData(data) {
  data.locations ||= {};
  for (const [name, loc] of Object.entries({ ...data.locations })) {
    if (["unknown", "wild", "space"].includes(String(loc.mode || "").toLowerCase())) {
      delete data.locations[name];
      if (data.currentLocation === name) data.currentLocation = "";
      continue;
    }
    loc.name ||= name;
    loc.mode = "docked";
    loc.useIn = !!loc.useIn;
  }
  if (data.currentLocation && !data.locations[data.currentLocation]) data.currentLocation = "";
}

async function saveData(data) {
  if (!game.user.isGM) return requestGm("saveData", { data });
  normalizeLocationData(data);
  syncShipDirectory(data);
  await setSetting("data", data);
  broadcastRefresh();
}

async function getPackDocs(packId, folderPath = "") {
  if (!packId) return [];
  const pack = game.packs.get(packId);
  if (!pack) {
    ui.notifications.error(`TradeHub compendium not found: ${packId}`);
    return [];
  }
  const docs = await pack.getDocuments();
  const path = folderPath.trim().toLowerCase();
  if (!path) return docs;
  return docs.filter(doc => folderMatches(doc, path));
}

function folderMatches(doc, path) {
  const folder = doc.folder;
  if (!folder) return false;
  const names = [];
  let current = folder;
  while (current) {
    names.unshift(current.name);
    current = current.folder;
  }
  return names.join(" / ").toLowerCase() === path || folder.name.toLowerCase() === path;
}

async function getTradeGoods() {
  const docs = await getPackDocs(setting("tradeGoodsPack"), setting("tradeGoodsFolderPath"));
  return docs.filter(doc => ["loot", "consumable", "equipment"].includes(doc.type)).map(itemFromDocument);
}

async function getVehicleConsumables() {
  const docs = await getPackDocs(setting("vehicleConsumablesPack"), setting("vehicleConsumablesFolderPath"));
  return docs.filter(doc => ["loot", "consumable", "equipment", "weapon"].includes(doc.type)).map(itemFromDocument);
}

async function getAmmoRestockItems() {
  const pack = setting("ammoRestockPack") || setting("vehicleConsumablesPack");
  const folder = setting("ammoRestockFolderPath") || setting("vehicleConsumablesFolderPath");
  const docs = await getPackDocs(pack, folder);
  return docs.filter(doc => ["loot", "consumable", "equipment", "weapon"].includes(doc.type)).map(itemFromDocument);
}

async function getShipyardVehicles() {
  const docs = await getPackDocs(setting("shipyardPack"), setting("shipyardFolderPath"));
  return docs.filter(doc => doc.type === "vehicle");
}

function itemFromDocument(doc) {
  const system = doc.system || {};
  const price = parseNumber(system.price?.value ?? system.price ?? system.cost ?? 0);
  const weight = parseNumber(system.weight ?? 0);
  const max = parseNumber(system.source?.custom ?? system.description?.value ?? system.description?.chat ?? 0);
  return { id: doc.id, uuid: doc.uuid, name: doc.name, img: doc.img, type: doc.type, system, price, weight, restockMax: max, doc };
}

function currentLocation() {
  const data = getData();
  const name = data.currentLocation || "";
  return data.locations[name] || { name: name || "No Location", mode: "", sellsIllegal: false, hasShipyard: false, stateOfEmergency: false, uninhabited: true, useIn: false };
}

function serviceState() {
  const loc = currentLocation();
  const docked = loc.mode === "docked";
  const emergency = !!loc.stateOfEmergency;
  const uninhabited = !!loc.uninhabited;
  return {
    loc,
    markets: docked && !uninhabited,
    buy: docked && !uninhabited,
    sell: docked && !uninhabited,
    restock: docked && !emergency && !uninhabited,
    repair: docked && !emergency && !uninhabited,
    shipyard: docked && loc.hasShipyard && !emergency && !uninhabited,
    any: docked
  };
}

async function ensureMarket(locationName, options = {}) {
  const data = getData();
  data.markets ||= {};
  if (!data.markets[locationName] || options.regenerate) {
    const goods = await getTradeGoods();
    const previousMarket = data.markets[locationName] || {};
    data.markets[locationName] = {};
    const stockMin = Math.max(0, setting("stockMin"));
    const stockMax = Math.max(stockMin, setting("stockMax"));
    const maxPct = Math.max(0, setting("maxPriceChangePercent"));
    for (const good of goods) {
      const rumour = activeRumourFor(data, locationName, good.name);
      const pct = Math.floor(Math.random() * (maxPct + 1));
      const direction = rumour ? "Higher" : (options.forceProfit ? "Higher" : Math.random() >= 0.5 ? "Higher" : "Lower");
      const percent = rumour ? Math.round((Number(rumour.priceMultiplier || 1) - 1) * 100) : pct;
      const stock = Math.floor(stockMin + Math.random() * (stockMax - stockMin + 1));
      data.markets[locationName][good.name] = {
        stock: rumour ? Math.max(0, Math.floor(stock * Number(rumour.stockMultiplier || 1))) : stock,
        direction,
        percent,
        lastPaid: options.clearLastPaid ? 0 : Number(previousMarket[good.name]?.lastPaid || 0)
      };
    }
    if (game.user.isGM) {
      syncShipDirectory(data);
      await setSetting("data", data);
    }
  }
  return data.markets[locationName] || {};
}

async function marketRows(locationName) {
  const goods = await getTradeGoods();
  const market = await ensureMarket(locationName);
  const loc = getData().locations[locationName] || {};
  return goods
    .filter(good => loc.sellsIllegal || loc.stateOfEmergency || !isIllegalGood(good.name))
    .map(good => {
      const state = market[good.name] || { stock: 0, direction: "None", percent: 0, lastPaid: 0 };
      const pct = Number(state.percent || 0) / 100;
      const priceInc = good.price * (1 + pct);
      const priceDec = good.price * Math.max(0, 1 - pct);
      const price = state.direction === "Higher" ? priceInc : state.direction === "Lower" ? priceDec : good.price;
      return { ...good, stock: state.stock || 0, direction: state.direction, percent: state.percent || 0, lastPaid: state.lastPaid || 0, price, priceInc, priceDec, emrg: !!loc.stateOfEmergency && !isIllegalGood(good.name) };
    })
    .sort((a, b) => changeSort(a) - changeSort(b) || a.name.localeCompare(b.name));
}

function isIllegalGood(name) {
  return /\[illegal\]|illegal/i.test(name);
}

const RUMOUR_TEMPLATES = [
  "Rumour has it there is a severe shortage of {item} {place}. Anyone carrying supply could name their price.",
  "Word is local reserves of {item} {place} have nearly vanished.",
  "Travellers say {location} is rationing essentials, and {item} is suddenly moving fast.",
  "A construction surge {place} has brokers quietly hunting for {item}.",
  "A major festival is starting {place}. Vendors are buying up {item} before the crowds arrive.",
  "Port chatter says a dockside fire wiped out warehouses full of {item} {place}.",
  "A guild contract {place} is pulling every crate of {item} off the open market.",
  "Customs delays near {location} have made {item} harder to find than usual.",
  "Private buyers {place} are offering premiums for discreet shipments of {item}.",
  "A refinery outage {place} has turned {item} into a priority purchase.",
  "Several freighters skipped {location}, leaving merchants short on {item}.",
  "Military requisitions {place} are consuming available {item}.",
  "A quarantine scare {place} has disrupted normal deliveries of {item}.",
  "Market analysts are whispering that {item} is underpriced before arrival at {location}.",
  "A noble house {place} is stockpiling {item} through intermediaries.",
  "Bad harvests around {location} have shifted demand toward {item}.",
  "Industrial buyers {place} have posted rush orders for {item}.",
  "A convoy accident near {location} has tightened supply of {item}.",
  "Dock unions {place} report unusual movement around {item} contracts.",
  "A rival market collapse has sent buyers {place} scrambling for {item}."
];

function locationPreposition(loc) {
  return loc?.useIn ? "in" : "on";
}

function locationPhrase(locOrName) {
  const loc = typeof locOrName === "string" ? getData().locations?.[locOrName] || { name: locOrName } : locOrName;
  return `${locationPreposition(loc)} ${loc?.name || locOrName || "this location"}`;
}

function activeRumourFor(data, locationName, itemName) {
  const now = Date.now();
  return (data.activeRumours || []).find(r => r.locationName === locationName && r.itemName === itemName && Number(r.expiresAt || 0) > now);
}

function cleanRumours(data) {
  const now = Date.now();
  data.activeRumours = (data.activeRumours || []).filter(r => Number(r.expiresAt || 0) > now);
}

async function maintainTradeRumours(data, targetCount = 2) {
  cleanRumours(data);
  if (!setting("enableTradeRumours")) {
    data.activeRumours = [];
    return;
  }
  const goods = await getTradeGoods();
  const loc = data.locations?.[data.currentLocation];
  if (!goods.length || !loc || loc.mode !== "docked" || loc.uninhabited) return;
  const localRumours = (data.activeRumours || []).filter(r => r.locationName === loc.name);
  if (localRumours.length >= targetCount) return;
  let attempts = 0;
  while ((data.activeRumours || []).filter(r => r.locationName === loc.name).length < targetCount && attempts < targetCount * 20) {
    attempts += 1;
    const good = pickRandom(goods);
    if (!good || !loc) break;
    if (data.activeRumours.some(r => r.locationName === loc.name && r.itemName === good.name)) continue;
    const text = pickRandom(RUMOUR_TEMPLATES)
      .replaceAll("{item}", good.name)
      .replaceAll("{place}", locationPhrase(loc))
      .replaceAll("{location}", loc.name);
    const rawMaxIncrease = Number(setting("maxShortagePriceIncreasePercent"));
    const maxIncrease = Math.max(0, Number.isFinite(rawMaxIncrease) ? rawMaxIncrease : 57);
    const minIncrease = Math.min(maxIncrease, Math.max(5, Math.floor(maxIncrease * 0.35)));
    const priceIncrease = maxIncrease ? randomBetween(minIncrease, maxIncrease) : 0;
    data.activeRumours.push({
      id: foundry.utils.randomID(),
      locationName: loc.name,
      itemName: good.name,
      itemUuid: good.uuid,
      priceMultiplier: 1 + priceIncrease / 100,
      stockMultiplier: randomBetween(0.15, 0.75),
      expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 14,
      rumourText: text
    });
  }
}

function randomBetween(min, max) {
  return Math.round((min + Math.random() * (max - min)) * 100) / 100;
}

function pickRandom(values) {
  return values[Math.floor(Math.random() * values.length)];
}

async function refreshTickerSelection(data, locationName, count = 6) {
  data.tickerSelections ||= {};
  data.tickerSelections[locationName] = buildTickerSelection(data, locationName, count, true);
  return data.tickerSelections[locationName];
}

function tradeHubTickers(locationName, count = 6) {
  const data = getData();
  const saved = data.tickerSelections?.[locationName];
  if (saved?.length >= count) return shuffleArray(saved).slice(0, count);
  if (saved?.length) {
    const expanded = [...saved];
    for (const line of buildTickerSelection(data, locationName, count, true)) {
      if (expanded.length >= count) break;
      if (!expanded.includes(line)) expanded.push(line);
    }
    while (expanded.length && expanded.length < count) expanded.push(expanded[expanded.length % Math.max(1, expanded.length)]);
    return shuffleArray(expanded).slice(0, count);
  }
  return shuffleArray(buildTickerSelection(data, locationName, count, false)).slice(0, count);
}

function buildTickerSelection(data, locationName, count = 6, randomize = false) {
  const journalLines = journalNewsLines(locationName);
  cleanRumours(data);
  const localRumours = setting("enableTradeRumours")
    ? (data.activeRumours || []).filter(r => r.locationName === locationName).map(r => r.rumourText).filter(Boolean).slice(0, 2)
    : [];
  const selected = [];
  const uniqueRumours = Array.from(new Set(localRumours));
  const rumourTarget = Math.min(uniqueRumours.length, uniqueRumours.length > 1 ? (Math.random() >= 0.5 ? 2 : 1) : 1, count);
  while (uniqueRumours.length && selected.length < rumourTarget) {
    const index = randomize ? Math.floor(Math.random() * uniqueRumours.length) : 0;
    selected.push(uniqueRumours.splice(index, 1)[0]);
  }
  const unique = Array.from(new Set(journalLines)).filter(line => !selected.includes(line));
  while (unique.length && selected.length < count) {
    const index = randomize ? Math.floor(Math.random() * unique.length) : 0;
    selected.push(unique.splice(index, 1)[0]);
  }
  while (selected.length && selected.length < count) selected.push(selected[selected.length % Math.max(1, selected.length)]);
  return randomize ? shuffleArray(selected) : selected;
}

function shuffleArray(values) {
  const copy = [...(values || [])];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function journalNewsLines(locationName) {
  const lines = [];
  const location = String(locationName || "").toLowerCase();
  const modernHub = tradeHubNewsJournal();
  const hubs = [modernHub, game.journal?.getName?.(LEGACY_NEWS_JOURNAL_NAME)].filter(Boolean);
  for (const hub of hubs) {
    const pages = Array.from(hub.pages || []);
    const matching = pages.filter(page => page.name?.toLowerCase() === location);
    for (const page of matching) lines.push(...tickerLinesFromHtml(page.text?.content || page.system?.text?.content || ""));
  }
  const legacyFolder = game.folders?.find(folder => folder.type === "JournalEntry" && folder.name === LEGACY_NEWS_JOURNAL_NAME);
  if (legacyFolder) {
    const journals = (legacyFolder.contents || []).filter(entry => entry.name?.toLowerCase() === location);
    for (const journal of journals) for (const page of Array.from(journal.pages || [])) lines.push(...tickerLinesFromHtml(page.text?.content || page.system?.text?.content || ""));
  }
  return lines;
}

function tradeHubNewsJournal() {
  const folder = game.folders?.find(folder => folder.type === "JournalEntry" && folder.name?.toLowerCase() === NEWS_FOLDER_NAME.toLowerCase());
  return folder?.contents?.find(entry => entry.name?.toLowerCase() === NEWS_JOURNAL_NAME.toLowerCase())
    || game.journal?.find(entry => entry.name?.toLowerCase() === NEWS_JOURNAL_NAME.toLowerCase());
}

function tickerLinesFromHtml(html) {
  const normalized = String(html || "")
    .replace(/<(br|p|div|li|h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n");
  return stripHtml(normalized).split(/\n+/).map(line => line.replace(/^[-*•]\s*/, "").trim()).filter(Boolean);
}

function tickerHtml(lines) {
  if (!lines?.length) return "";
  const stories = lines.map(line => `<span class="thm-news-story">${escapeHtml(line)}</span>`).join("");
  return `<div class="thm-news-ticker"><span class="thm-news-label">TradeHub News</span><marquee>${stories}</marquee></div>`;
}

function changeSort(row) {
  if (row.direction === "Lower") return 1;
  if (row.direction === "Higher") return 3;
  return 2;
}

function bankActor() {
  const name = setting("bankActorName").toLowerCase();
  const folder = setting("bankFolderName").toLowerCase();
  return game.actors.find(actor => actor.name.toLowerCase() === name && (!folder || actor.folder?.name?.toLowerCase() === folder))
    || game.actors.find(actor => actor.name.toLowerCase() === name);
}

function bankBalance() {
  return Number(getData().capital || 0);
}

async function updateBank(gp) {
  const data = getData();
  data.capital = Math.max(0, Number(gp || 0));
  syncShipDirectory(data);
  await setSetting("data", data);
}

function accessibleShips() {
  const ships = game.user.isGM
    ? game.actors.contents.filter(actor => actor.type === "vehicle" && actor.name !== setting("bankActorName"))
    : (getData().shipDirectory || []).filter(ship => ship.type === "vehicle" && ship.name !== setting("bankActorName"));
  return ships.filter(ship => hasOwnerAccessForStarport(ship));
}

function hasOwnerAccessForStarport(ship) {
  const owner = CONST.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? CONST.DOCUMENT_PERMISSION_LEVELS?.OWNER ?? 3;
  const ownership = ship.ownership || ship.data?.permission || {};
  if (game.user.isGM) {
    return game.users.contents
      .filter(user => !user.isGM)
      .some(user => Number(ownership[user.id] ?? ownership.default ?? 0) >= owner);
  }
  return Number(ownership[game.user.id] ?? ownership.default ?? 0) >= owner;
}

function partyShips() {
  return accessibleShips().filter(actor => (actor.folderName || actor.folder?.name || "").toLowerCase() !== "playerships");
}

function selectedShip() {
  return game.actors.get(selectedShipId) || (getData().shipDirectory || []).find(ship => ship.id === selectedShipId);
}

function cargoStats(ship) {
  const base = Number(ship?.system?.attributes?.capacity?.cargo || 0) * 2000;
  let bonus = 0;
  for (const effect of ship?.effects || []) {
    const label = effect.label || effect.name || effect.data?.label || "";
    if (!label.toLowerCase().includes("cargo bay")) continue;
    for (const change of effect.changes || effect.data?.changes || []) {
      if (String(change.key).includes("attributes.capacity.cargo")) bonus += parseNumber(change.value);
    }
  }
  const max = base + bonus;
  if (ship?.cargoStats) return clone(ship.cargoStats);
  const items = getShipItems(ship).filter(i => ["consumable", "loot"].includes(i.type)) || [];
  const current = items.reduce((total, item) => total + Number(item.system?.weight || item.weight || 0) * Number(item.system?.quantity || item.quantity || 0), 0);
  const remaining = max - current;
  const pct = max > 0 ? Math.min((current / max) * 100, 100) : 0;
  return { max, current, remaining, pct };
}

function getShipItems(ship) {
  if (!ship) return [];
  if (Array.isArray(ship.items)) return ship.items;
  return ship.items?.contents || [];
}

function getShipItem(ship, nameOrId) {
  if (!ship) return null;
  if (ship.items?.getName) return ship.items.getName(nameOrId) || ship.items.get(nameOrId);
  return getShipItems(ship).find(item => item.name === nameOrId || item.id === nameOrId);
}

function syncShipDirectory(data = getData()) {
  if (!game.user.isGM) return data;
  data.shipDirectory = game.actors.contents
    .filter(actor => actor.type === "vehicle" && actor.name !== setting("bankActorName"))
    .map(actor => {
      const stats = cargoStats(actor);
      return {
        id: actor.id,
        name: actor.name,
        type: actor.type,
        img: actor.img,
        folderName: actor.folder?.name || "",
        ownership: clone(actor.ownership || actor.data?.permission || {}),
        system: {
          attributes: actor.system?.attributes || {},
          traits: actor.system?.traits || {},
          details: actor.system?.details || {},
          cargo: actor.system?.cargo || {}
        },
        cargoStats: stats,
        items: actor.items.contents.map(item => ({
          id: item.id,
          name: item.name,
          type: item.type,
          img: item.img,
          quantity: Number(item.system?.quantity || 0),
          weight: Number(item.system?.weight || 0),
          system: {
            quantity: Number(item.system?.quantity || 0),
            weight: Number(item.system?.weight || 0),
            hp: clone(item.system?.hp || {}),
            price: clone(item.system?.price || {})
          }
        }))
      };
    });
  return data;
}

function cargoBar(stats) {
  const color = stats.pct > 95 ? "#f44336" : stats.pct > 90 ? "#ff9033" : "#4caf50";
  return `<div class="thm-cargo-bar">
    <div class="thm-cargo-fill" style="width:${Math.min(stats.pct, 100)}%; background:${color};"></div>
    <div class="thm-cargo-label">Cargo: ${Math.floor(stats.current).toLocaleString()} lbs / Room: ${Math.max(0, Math.floor(stats.remaining)).toLocaleString()} lbs</div>
  </div>`;
}

async function randomAd() {
  const folder = setting("adFolder") || "";
  const fallback = ["Ad1.webp", "Ad2.webp", "Ad3.webp", "Ad4.webp", "Ad5.webp", "Ad6.webp"].map(f => `${folder.replace(/\/?$/, "/")}${f}`);
  let images = fallback;
  if (folder && !/^https?:/i.test(folder)) {
    try {
      const result = await FilePicker.browse("data", folder);
      images = result.files.filter(file => /\.(webp|png|jpe?g|gif)$/i.test(file));
    } catch (_err) {
      images = fallback;
    }
  }
  const seen = setting("seenAds") || [];
  const unseen = images.filter(img => !seen.includes(img));
  const selected = (unseen.length ? unseen : images)[Math.floor(Math.random() * (unseen.length ? unseen.length : images.length))];
  await setSetting("seenAds", unseen.length ? [...seen, selected] : [selected]);
  return selected || `modules/${MODULE_ID}/images/splashimage.webp`;
}

function dialogOptions(classes = []) {
  return { classes: ["tradehub-markets", ...classes], width: 900, resizable: true };
}

function attachWindow(app) {
  openWindows.add(app);
  const originalClose = app.close.bind(app);
  app.close = (...args) => {
    openWindows.delete(app);
    return originalClose(...args);
  };
}

function refreshOpenWindows() {
  for (const app of [...openWindows]) {
    if (app.rendered) app.render(false);
  }
  SplashPage.refreshSplash();
}

function broadcastRefresh(openSplash = false) {
  game.socket.emit(SOCKET, { type: "refresh", openSplash });
  refreshOpenWindows();
}

function requestGm(action, payload) {
  if (game.user.isGM) return processGmRequest({ action, payload, userId: game.user.id });
  game.socket.emit(SOCKET, { type: "request", action, payload, userId: game.user.id });
  ui.notifications.info("TradeHub request sent to the GM client.");
  return true;
}

async function handleSocket(message) {
  if (message.type === "request" && game.user.isGM) return processGmRequest(message);
  if (message.type === "refresh") {
    refreshOpenWindows();
    if (message.openSplash) SplashPage.showSplash();
  }
}

async function processGmRequest(message) {
  try {
    if (message.action === "buyGoods") return Transactions.buyGoods(message.payload, message.userId);
    if (message.action === "sellGoods") return Transactions.sellGoods(message.payload, message.userId);
    if (message.action === "restock") return Transactions.restock(message.payload, message.userId);
    if (message.action === "repair") return Transactions.repair(message.payload, message.userId);
    if (message.action === "dock") return Transactions.dock(message.payload, message.userId);
    if (message.action === "deleteLocation") return Transactions.deleteLocation(message.payload, message.userId);
    if (message.action === "shipyardBuy") return Transactions.shipyardBuy(message.payload, message.userId);
    if (message.action === "shipyardSell") return Transactions.shipyardSell(message.payload, message.userId);
    if (message.action === "shipLongRest") return Transactions.shipLongRest(message.payload, message.userId);
    if (message.action === "shipRegister") return Transactions.shipRegister(message.payload, message.userId);
    if (message.action === "shipInsurance") return Transactions.shipInsurance(message.payload, message.userId);
    if (message.action === "payBounties") return Transactions.payBounties(message.payload, message.userId);
    if (message.action === "shipJettison") return Transactions.shipJettison(message.payload, message.userId);
    if (message.action === "shipFuelPurge") return Transactions.shipFuelPurge(message.payload, message.userId);
    if (message.action === "shipFuelScoop") return Transactions.shipFuelScoop(message.payload, message.userId);
    if (message.action === "applyCombatDamage") return Transactions.applyCombatDamage(message.payload, message.userId);
    if (message.action === "deployHeatSink") return Transactions.deployHeatSink(message.payload, message.userId);
    if (message.action === "declineHeatSink") return Transactions.declineHeatSink(message.payload, message.userId);
    if (message.action === "combatRepair") return Transactions.combatRepair(message.payload, message.userId);
    if (message.action === "saveData") return saveData(message.payload.data);
  } catch (err) {
    console.error(err);
    ui.notifications.error(err.message || "TradeHub transaction failed.");
  }
}

class SplashPage {
  static async showSplash() {
    const state = serviceState();
    if (!state.any) return ui.notifications.error(`${state.loc.name || "No Location"} has no TradeHub services available.`);
    const ships = accessibleShips();
    if (!ships.length) return ui.notifications.info("No owned vehicle actors found.");
    if (!selectedShipId || !ships.some(ship => ship.id === selectedShipId)) selectedShipId = ships[0].id;
    selectedShipName = selectedShip()?.name || ships[0].name;
    const image = setting("marketplaceImage");
    await this.preloadSplashImage(image);
    const tickers = tradeHubTickers(state.loc.name, 6);
    const bank = bankBalance();
    const label = setting("vehicleLabel");
    const options = ships.map(ship => `<option value="${ship.id}" ${ship.id === selectedShipId ? "selected" : ""}>${ship.name}</option>`).join("");
    const ship = selectedShip();
    const content = `<div class="thm-root">
      <img class="thm-splash-image" src="${image}">
      ${tickerHtml(tickers)}
      <div class="thm-center">Current Location:</div>
      <div class="thm-center thm-green" style="font-size:1.5em;">${state.loc.name}</div>
      <div class="thm-center thm-green" id="thm-starport-capital">Capital: ${formatGp(bank)}</div>
      <hr>
      <div class="thm-vessel-select-wrap">
        <div class="thm-vessel-select-main">
          <div class="thm-vessel-label">Select ${label}:</div>
          <select id="thm-ship">${options}</select>
        </div>
        <div class="thm-vessel-image-cell"><img class="thm-ship-thumb" id="thm-ship-img" src="${ship?.img || ""}"></div>
      </div>
      <div class="thm-actions">
        <button id="thm-buy" ${state.markets ? "" : "disabled"}>Browse Goods</button>
        <button id="thm-sell" ${state.sell ? "" : "disabled"}>Sell Cargo</button>
        <button id="thm-shipyard" ${state.shipyard ? "" : "disabled"}>${state.loc.hasShipyard ? "Shipyard" : "No Shipyard"}</button>
      </div>
      <button class="thm-full-button" id="thm-restock" ${state.restock ? "" : "disabled"}>${state.loc.stateOfEmergency ? "Supply Restock - Emergency Only" : "Supply Restock"}</button>
      <button class="thm-full-button" id="thm-repair" ${state.repair ? "" : "disabled"}>Repair ${label}</button>
    </div>`;
    const dialog = new Dialog({
      title: "Starport Services",
      content,
      buttons: { close: { label: "Close" } },
      render: html => {
        html.find("#thm-ship").on("change", ev => {
          selectedShipId = ev.currentTarget.value;
          selectedShipName = selectedShip()?.name || "";
          html.find("#thm-ship-img").attr("src", selectedShip()?.img || "");
        });
        html.find("#thm-ship-img").on("click", () => selectedShip()?.sheet?.render(true));
        html.find("#thm-buy").on("click", () => BuyGoodsPage.showBuyPage());
        html.find("#thm-sell").on("click", () => SellGoodsPage.showSellPage());
        html.find("#thm-restock").on("click", () => RestockPage.showRestockPage());
        html.find("#thm-repair").on("click", () => RepairShipPage.showRepairPage());
        html.find("#thm-shipyard").on("click", () => ShipyardPage.showShipyardPage());
      }
    }, { ...dialogOptions(), width: 640 });
    attachWindow(dialog);
    dialog.render(true);
    this.playLoadSound();
  }

  static playLoadSound() {
    const soundPath = setting("starportLoadSoundPath");
    if (!soundPath) return;
    AudioHelper.play({ src: soundPath, volume: 0.8, autoplay: true, loop: false }, false);
  }

  static preloadSplashImage(src) {
    if (!src) return Promise.resolve(false);
    const loader = new Dialog({
      title: "Starport Services",
      content: `<div class="thm-root thm-loading">
        <div class="thm-loading-title">Loading TradeHub Markets</div>
        <div class="thm-loading-bar"><div></div></div>
      </div>`,
      buttons: {}
    }, { ...dialogOptions(), width: 360 });
    let settled = false;
    const closeLoader = () => {
      if (settled) return;
      settled = true;
      loader.close();
    };
    loader.render(true);
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        closeLoader();
        resolve(true);
      };
      img.onerror = () => {
        closeLoader();
        resolve(false);
      };
      img.src = src;
      window.setTimeout(() => {
        closeLoader();
        resolve(false);
      }, 2500);
    });
  }

  static closeSplash() {
    for (const app of Object.values(ui.windows)) if (app.title === "Starport Services") app.close();
  }

  static refreshSplash() {
    for (const app of Object.values(ui.windows)) {
      if (app.title !== "Starport Services") continue;
      app.element?.find("#thm-starport-capital").text(`Capital: ${formatGp(bankBalance())}`);
    }
  }
}

class MarketDialog {
  static rowInputName(row) { return row.name.replace(/[^a-zA-Z0-9-_]/g, ""); }

  static async render(type) {
    const state = serviceState();
    if (type === "buy" && !state.markets) return ui.notifications.error("Markets are not available at this location.");
    if (type === "sell" && !state.sell) return ui.notifications.error("Selling cargo is not available at this location.");
    const ship = selectedShip();
    if (!ship) return ui.notifications.error(`No ${setting("vehicleLabel").toLowerCase()} selected.`);
    const rows = await marketRows(state.loc.name);
    const ad = await randomAd();
    const stats = cargoStats(ship);
    const sellMode = type === "sell";
    const tickers = sellMode ? [] : tradeHubTickers(state.loc.name, 6);
    const visibleRows = sellMode ? rows.filter(row => getShipItem(ship, row.name)) : rows;
    const table = visibleRows.map(row => {
      const key = this.rowInputName(row);
      const owned = getShipItem(ship, row.name)?.system?.quantity || getShipItem(ship, row.name)?.quantity || 0;
      const max = sellMode ? owned : (row.emrg ? 0 : row.stock);
      const profit = sellMode ? this.profitText(row) : this.changeText(row);
      const marketSort = sellMode ? this.profitSortValue(row) : this.buyMarketSortValue(row);
      const priceDisplay = !sellMode && row.emrg ? "EMRG" : row.price.toFixed(2);
      return `<tr data-key="${key}" data-name="${row.name}" data-price="${row.price}" data-weight="${row.weight}" data-max="${max}">
        <td><div class="thm-item-cell"><img src="${row.img}" data-uuid="${row.uuid}"><span class="thm-item-name" data-uuid="${row.uuid}">${row.name}</span></div></td>
        <td class="thm-center">${priceDisplay}</td>
        <td class="thm-center">${Math.ceil(row.weight)}</td>
        <td class="thm-center" data-sort-value="${marketSort}">${profit}</td>
        <td class="thm-center">${sellMode ? owned : row.stock}</td>
        <td class="thm-center"><input class="thm-number thm-qty" type="number" min="0" max="${max}" value="0"></td>
        <td class="thm-center"><span class="thm-row-actions"><button class="thm-mini-button thm-clear">x</button><button class="thm-max">Max</button><input class="thm-check" type="checkbox" disabled></span></td>
      </tr>`;
    }).join("");
    const actionLabel = sellMode ? "Sell Goods" : "Buy Goods";
    const content = `<div class="thm-root thm-compact">
      <img class="thm-ad" src="${ad}">
      ${tickerHtml(tickers)}
      <div class="thm-link-title ${sellMode ? "sell" : "buy"}">${sellMode ? "Sell Trade Goods" : "Buy Trade Goods"}</div>
      <div style="max-height:50vh; overflow:auto;">
        <table class="thm-table">
          <thead><tr><th data-sort="text">Item Name</th><th data-sort="number">Price (GP)</th><th data-sort="number">Weight (lb.)</th><th data-sort="number" data-default-dir="desc">${sellMode ? "Profit / Loss" : "Mkt. Price (%)"}</th><th data-sort="number">${sellMode ? "Owned" : "In Stock"}</th><th data-sort="number">${sellMode ? "Sell Qty" : "Buy Qty"}</th><th data-sort="text">${sellMode ? "Offload" : "Purchase"}</th></tr></thead>
          <tbody>${table || `<tr><td colspan="7" class="thm-center">No cargo is available for this market.</td></tr>`}</tbody>
        </table>
      </div>
      <div class="thm-market-footer">
        <div class="thm-row">
          <div>Market services available for ${setting("vehicleLabel").toLowerCase()}:<br><strong class="thm-open-ship">${ship.name}</strong></div>
          <div class="thm-center thm-green"><div id="thm-bank">Capital: ${formatGp(bankBalance())}</div><div id="thm-total">${sellMode ? "Cart" : "Purchase"} Total: 0 GP</div></div>
          <div class="thm-row"><button id="thm-cancel">Cancel</button><button id="thm-final" disabled>${actionLabel}</button></div>
        </div>
        <div id="thm-cargo">${cargoBar(stats)}</div>
      </div>
    </div>`;
    const dialog = new Dialog({
      title: sellMode ? "Sell Trade Goods" : "Buy Trade Goods",
      content,
      buttons: {},
      render: html => this.activate(html, { type, ship, stats })
    }, dialogOptions([sellMode ? "sell" : "buy"]));
    attachWindow(dialog);
    dialog.render(true);
  }

  static activate(html, { type, ship, stats }) {
    const sellMode = type === "sell";
    const recalc = () => {
      let total = 0;
      let cargo = stats.current;
      html.find("tbody tr[data-key]").each((_i, tr) => {
      const row = $(tr);
        const qty = Math.max(0, Math.min(Number(row.find(".thm-qty").val() || 0), Number(row.data("max"))));
        row.find(".thm-qty").val(qty);
        const active = qty > 0;
        row.find(".thm-check").prop("disabled", !active).prop("checked", active);
        total += qty * Number(row.data("price"));
        cargo += (sellMode ? -1 : 1) * qty * Number(row.data("weight"));
      });
      const remainingBank = sellMode ? bankBalance() + total : bankBalance() - total;
      html.find("#thm-total").text(`${sellMode ? "Cart" : "Purchase"} Total: ${formatGp(total)}`);
      html.find("#thm-bank").text(`Capital: ${formatGp(remainingBank)}`).toggleClass("thm-red", remainingBank < 0);
      html.find("#thm-cargo").html(cargoBar({ ...stats, current: cargo, remaining: stats.max - cargo, pct: stats.max ? Math.min(cargo / stats.max * 100, 100) : 0 }));
      html.find("#thm-final").prop("disabled", total <= 0 || remainingBank < 0 || (!sellMode && cargo > stats.max));
    };
    const clampRow = row => {
      row = $(row);
      let max = Number(row.data("max"));
      if (!sellMode) {
        let usedCapital = 0;
        let usedCargo = stats.current;
        html.find("tbody tr[data-key]").not(row).each((_i, tr) => {
          const other = $(tr);
          const qty = Math.max(0, Number(other.find(".thm-qty").val() || 0));
          usedCapital += qty * Number(other.data("price"));
          usedCargo += qty * Number(other.data("weight"));
        });
        const price = Math.max(Number(row.data("price")), 0.000001);
        const weight = Math.max(Number(row.data("weight")), 0.000001);
        max = Math.min(max, Math.floor(Math.max(0, bankBalance() - usedCapital) / price), Math.floor(Math.max(0, stats.max - usedCargo) / weight));
      }
      const value = Math.max(0, Math.min(Number(row.find(".thm-qty").val() || 0), Math.max(0, max)));
      row.find(".thm-qty").val(value);
      return value;
    };
    html.find(".thm-qty").on("focus", ev => ev.currentTarget.select()).on("input", ev => { clampRow($(ev.currentTarget).closest("tr")); recalc(); });
    html.find(".thm-clear").on("click", ev => { $(ev.currentTarget).closest("tr").find(".thm-qty").val(0); recalc(); });
    html.find(".thm-max").on("click", ev => {
      const row = $(ev.currentTarget).closest("tr");
      let max = Number(row.data("max"));
      if (!sellMode) {
        const price = Number(row.data("price"));
        const weight = Number(row.data("weight"));
        max = Math.min(max, Math.floor(bankBalance() / price), Math.floor(Math.max(0, stats.remaining) / weight));
      }
      row.find(".thm-qty").val(Math.max(0, max));
      clampRow(row);
      recalc();
    });
    html.find(".thm-item-cell img, .thm-item-name").on("click", async ev => (await fromUuid(ev.currentTarget.dataset.uuid))?.sheet?.render(true));
    html.find(".thm-open-ship").on("click", () => game.actors.get(ship.id)?.sheet?.render(true));
    html.find("#thm-cancel").on("click", () => html.closest(".app").find(".close").click());
    html.find("#thm-final").on("click", () => {
      const items = [];
      html.find("tbody tr[data-key]").each((_i, tr) => {
        const row = $(tr);
        const quantity = Number(row.find(".thm-qty").val() || 0);
        if (quantity > 0) items.push({ name: row.data("name"), quantity });
      });
      requestGm(sellMode ? "sellGoods" : "buyGoods", { shipId: ship.id, location: currentLocation().name, items });
      html.closest(".app").find(".close").click();
    });
    activateTableSort(html.find(".thm-table"));
  }

  static changeText(row) {
    if (!row.percent) return `<span class="thm-muted">None</span>`;
    const color = row.direction === "Higher" ? "thm-red" : "thm-green";
    return `<span class="${color}">${row.direction} by ${row.percent}%</span>`;
  }

  static profitText(row) {
    if (!row.lastPaid) return `<span class="thm-green">100% Profit</span>`;
    const diff = ((row.price - row.lastPaid) / row.lastPaid) * 100;
    if (Math.abs(diff) < 1) return `<span class="thm-muted">None</span>`;
    const capped = Math.min(100, Math.abs(diff));
    return diff >= 0 ? `<span class="thm-green">+${capped.toFixed(0)}% Profit</span>` : `<span class="thm-red">-${capped.toFixed(0)}% Loss</span>`;
  }

  static buyMarketSortValue(row) {
    if (row.emrg) return -9999;
    if (row.direction === "Lower") return Number(row.percent || 0);
    if (row.direction === "Higher") return -Number(row.percent || 0);
    return 0;
  }

  static profitSortValue(row) {
    if (!row.lastPaid) return 100;
    const diff = ((row.price - row.lastPaid) / row.lastPaid) * 100;
    return Math.max(-100, Math.min(100, diff));
  }
}

function activateTableSort(table) {
  table.find("thead th").each((index, th) => {
    $(th).on("click", () => {
      const tbody = table.find("tbody");
      const previousDir = $(th).data("dir");
      const dir = previousDir ? (previousDir === "asc" ? "desc" : "asc") : ($(th).data("default-dir") || "asc");
      table.find("thead th").data("dir", "");
      $(th).data("dir", dir);
      const mode = $(th).data("sort") || "text";
      const rows = tbody.find("tr").get().sort((a, b) => {
        const ac = $(a).children().eq(index);
        const bc = $(b).children().eq(index);
        const av = ac.data("sort-value") ?? ac.text().trim();
        const bv = bc.data("sort-value") ?? bc.text().trim();
        const cmp = mode === "number" ? Number(av) - Number(bv) : String(av).localeCompare(String(bv));
        return dir === "asc" ? cmp : -cmp;
      });
      tbody.append(rows);
    });
  });
}

class BuyGoodsPage { static showBuyPage() { return MarketDialog.render("buy"); } }
class SellGoodsPage { static showSellPage() { return MarketDialog.render("sell"); } }

class RestockPage {
  static async showRestockPage() {
    const ship = selectedShip();
    if (!ship) return ui.notifications.error(`No ${setting("vehicleLabel").toLowerCase()} selected.`);
    const vehicleLabel = setting("vehicleLabel") || "Ship";
    const items = await getAmmoRestockItems();
    const rows = items.sort((a, b) => Number(!getShipItem(ship, a.name)) - Number(!getShipItem(ship, b.name)) || a.name.localeCompare(b.name)).map(item => {
      const currentItem = getShipItem(ship, item.name);
      const current = Number(currentItem?.system?.quantity || currentItem?.quantity || 0);
      const max = item.restockMax || current;
      return `<tr data-name="${item.name}" data-price="${item.price}" data-max="${Math.max(0, max - current)}">
        <td><div class="thm-item-cell"><img src="${item.img}" data-uuid="${item.uuid}"><span class="thm-item-name ${current ? "" : "thm-muted"}" data-uuid="${item.uuid}">${item.name}</span></div></td>
        <td class="thm-center">${item.price}</td><td class="thm-center">${current} / ${max}</td>
        <td class="thm-center"><input class="thm-number thm-qty" type="number" min="0" value="0"></td>
        <td class="thm-center"><span class="thm-row-actions"><button class="thm-mini-button thm-clear">x</button><button class="thm-max">Restock</button></span></td>
      </tr>`;
    }).join("");
    const content = `<div class="thm-root thm-compact"><div class="thm-link-title restock">${vehicleLabel} Consumables</div>
      <p class="thm-center">Supply restocking services are available for the ${vehicleLabel.toLowerCase()}:<br><strong>${ship.name}</strong></p>
      <p class="thm-center thm-green" id="thm-restock-capital">Capital: ${formatGp(bankBalance())}</p>
      <p class="thm-center thm-green" id="thm-restock-total">Supply Total: 0 GP</p>
      <table class="thm-table"><thead><tr><th data-sort="text">Item Name</th><th data-sort="number">Price</th><th data-sort="number">Supply</th><th data-sort="number">Buy</th><th data-sort="text">Actions</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="thm-actions"><button id="thm-cancel">Cancel</button><button id="thm-confirm">Confirm</button></div></div>`;
    new Dialog({
      title: "Supply Restock",
      content,
      buttons: {},
      render: html => {
        const clampRow = row => {
          row = $(row);
          let used = 0;
          html.find("tbody tr").not(row).each((_i, tr) => {
            const other = $(tr);
            used += Number(other.find(".thm-qty").val() || 0) * Number(other.data("price"));
          });
          const maxByMoney = Math.floor(Math.max(0, bankBalance() - used) / Math.max(Number(row.data("price")), 0.000001));
          const max = Math.min(Number(row.data("max")), maxByMoney);
          row.find(".thm-qty").val(Math.max(0, Math.min(Number(row.find(".thm-qty").val() || 0), Math.max(0, max))));
        };
        const recalc = () => {
          let total = 0;
          html.find("tbody tr").each((_i, tr) => {
            const row = $(tr);
            total += Number(row.find(".thm-qty").val() || 0) * Number(row.data("price"));
          });
          html.find("#thm-restock-capital").text(`Capital: ${formatGp(bankBalance() - total)}`);
          html.find("#thm-restock-total").text(`Supply Total: ${formatGp(total)}`);
          html.find("#thm-confirm").prop("disabled", total <= 0 || bankBalance() - total < 0);
        };
        html.find(".thm-qty").on("focus", ev => ev.currentTarget.select()).on("input", ev => { clampRow($(ev.currentTarget).closest("tr")); recalc(); });
        html.find(".thm-clear").on("click", ev => { $(ev.currentTarget).closest("tr").find(".thm-qty").val(0); recalc(); });
        html.find(".thm-max").on("click", ev => { const row = $(ev.currentTarget).closest("tr"); row.find(".thm-qty").val(row.data("max")); clampRow(row); recalc(); });
        html.find(".thm-item-cell img, .thm-item-name").on("click", async ev => (await fromUuid(ev.currentTarget.dataset.uuid))?.sheet?.render(true));
        html.find("#thm-cancel").on("click", () => html.closest(".app").find(".close").click());
        html.find("#thm-confirm").on("click", () => {
          const restock = [];
          html.find("tbody tr").each((_i, tr) => {
            const row = $(tr);
            const quantity = Number(row.find(".thm-qty").val() || 0);
            if (quantity > 0) restock.push({ name: row.data("name"), quantity });
          });
          requestGm("restock", { shipId: ship.id, items: restock });
          html.closest(".app").find(".close").click();
        });
        activateTableSort(html.find(".thm-table"));
        recalc();
      }
    }, { ...dialogOptions(), width: 850 }).render(true);
  }
}

class RepairShipPage {
  static async showRepairPage() {
    const ship = selectedShip();
    if (!ship) return ui.notifications.error(`No ${setting("vehicleLabel").toLowerCase()} selected.`);
    const vehicleLabel = setting("vehicleLabel") || "Ship";
    const insured = isGlaxonInsured(ship);
    const modules = damageableModules(ship).sort((a, b) => hpPct(a) - hpPct(b));
    const rows = modules.map(item => {
      const hp = item.system?.hp || {};
      const value = Number(hp.value ?? 0);
      const max = Number(hp.max ?? 0);
      const pct = max ? value / max * 100 : 100;
      const color = pct <= 35 ? "#f44336" : pct <= 60 ? "#ffeb3b" : "#4caf50";
      const missing = Math.max(0, max - value);
      const rawCost = missing * repairUnitCost(item);
      const cost = repairCostForItem(item, missing, ship);
      return `<tr data-id="${item.id}" data-cost="${cost}" data-missing="${missing}" data-value="${value}" data-max="${max}" data-pct="${pct}" data-color="${color}">
        <td><div class="thm-item-cell"><img src="${item.img}"><span>${item.name}</span></div></td>
        <td><div class="thm-hp-bar"><div class="thm-hp-fill" style="width:${pct}%; background:${color};"></div><div class="thm-hp-label">${value} / ${max}</div></div></td>
        <td class="thm-center">${missing ? `${formatGp(cost)}${insured ? `<br><span class="thm-muted">Full: ${formatGp(rawCost)}</span>` : ""}` : "N/A"}</td>
        <td class="thm-center"><span class="thm-row-actions"><button class="thm-mini-button thm-clear" ${missing ? "" : "disabled"}>x</button><button class="thm-repair-one" ${missing ? "" : "disabled"}>Repair</button><input class="thm-check thm-repair-pick" type="checkbox" disabled></span></td>
      </tr>`;
    }).join("");
    const content = `<div class="thm-root thm-compact"><div class="thm-link-title repair">${vehicleLabel} Repairs</div>
      <p class="thm-center">Repair services are available for the ${vehicleLabel.toLowerCase()}:<br><strong>${ship.name}</strong></p>
      ${insured ? `<p class="thm-center thm-green"><strong>Glaxon Insurance Active:</strong> 50% repair discount applied.</p>` : ""}
      <p class="thm-center thm-green" id="thm-repair-capital">Capital: ${formatGp(bankBalance())}</p>
      <p class="thm-center thm-green" id="thm-repair-total">Repair Total: 0 GP</p>
      <table class="thm-table"><thead><tr><th data-sort="text">Equipment</th><th data-sort="number">Condition</th><th data-sort="number">Cost</th><th data-sort="text">Repair</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="thm-actions"><button id="thm-cancel">Cancel</button><button id="thm-confirm">Confirm</button></div></div>`;
    const dialog = new Dialog({
      title: `Repair ${vehicleLabel}`,
      content,
      buttons: {},
      render: html => {
        const previewRow = row => {
          row = $(row);
          const selected = row.find(".thm-repair-pick").prop("checked");
          const value = Number(row.data("value") || 0);
          const max = Number(row.data("max") || 0);
          const pct = Number(row.data("pct") || 0);
          const color = row.data("color") || "#4caf50";
          row.find(".thm-hp-fill").css({
            width: `${selected ? 100 : pct}%`,
            background: selected ? "#4caf50" : color
          });
          row.find(".thm-hp-label").text(selected ? `${max} / ${max}` : `${value} / ${max}`);
        };
        const recalc = () => {
          let total = 0;
          html.find("tbody tr").each((_i, tr) => {
            const row = $(tr);
            if (row.find(".thm-repair-pick").prop("checked")) total += Number(row.data("cost") || 0);
            previewRow(row);
          });
          const remaining = bankBalance() - total;
          html.find("#thm-repair-capital").text(`Capital: ${formatGp(remaining)}`).toggleClass("thm-red", remaining < 0);
          html.find("#thm-repair-total").text(`Repair Total: ${formatGp(total)}`);
          html.find("#thm-confirm").prop("disabled", total <= 0 || remaining < 0);
        };
        html.find(".thm-repair-one").on("click", ev => {
          $(ev.currentTarget).closest("tr").find(".thm-repair-pick").prop("checked", true);
          recalc();
        });
        html.find(".thm-clear").on("click", ev => {
          $(ev.currentTarget).closest("tr").find(".thm-repair-pick").prop("checked", false);
          recalc();
        });
        html.find("#thm-cancel").on("click", () => html.closest(".app").find(".close").click());
        html.find("#thm-confirm").on("click", async () => {
          const itemIds = [];
          html.find("tbody tr").each((_i, tr) => {
            const row = $(tr);
            if (row.find(".thm-repair-pick").prop("checked")) itemIds.push(row.data("id"));
          });
          await requestGm("repair", { shipId: ship.id, itemIds });
          html.closest(".app").find(".close").click();
        });
        activateTableSort(html.find(".thm-table"));
        recalc();
      }
    }, { ...dialogOptions(), width: 820 });
    attachWindow(dialog);
    dialog.render(true);
  }
}

function hpPct(item) {
  const hp = item.system?.hp || {};
  return Number(hp.max || 1) ? Number(hp.value || 0) / Number(hp.max || 1) : 1;
}

function isShieldModule(item) {
  return /shield generator/i.test(item?.name || "");
}

function repairUnitCost(item) {
  return Number(setting(isShieldModule(item) ? "repairCostPerShieldPoint" : "repairCostPerHp") || 0);
}

function isGlaxonInsured(ship) {
  return ship?.getFlag?.(MODULE_ID, "glaxonInsured") === true;
}

function repairCostForItem(item, missing, ship = null) {
  const raw = Math.max(0, Number(missing || 0)) * repairUnitCost(item);
  return isGlaxonInsured(ship) ? Math.floor(raw * 0.5) : raw;
}

function fullRepairValue(ship) {
  return damageableModules(ship).reduce((total, item) => total + itemMaxHp(item) * repairUnitCost(item), 0);
}

function glaxonPremium(ship) {
  const value = fullRepairValue(ship);
  return value > 0 ? Math.ceil(value * 0.05) : 0;
}

class DockingPage {
  static async showDockingPage() {
    if (!game.user.isGM) return ui.notifications.error("Only the GM can dock or update TradeHub markets.");
    const data = getData();
    const locations = Object.values(data.locations);
    const current = currentLocation();
    const options = [`<option value="create-new">Create New</option>`].concat(locations.map(loc => `<option value="${loc.name}" ${loc.name === current.name ? "selected" : ""}>${loc.name}</option>`)).join("");
    const content = `<div class="thm-root thm-docking-form">
      <div class="thm-config-grid">
        <label>Select Location:</label><select id="loc">${options}</select>
        <label>Market State:</label><select id="market-state"><option value="available">Market Available</option><option value="emergency">State of Emergency</option><option value="uninhabited">Uninhabited</option></select>
      </div>
      <div class="thm-docking-check-grid">
        <label><span>Sells Illegal</span><input type="checkbox" id="illegal"></label>
        <label><span>Has a Shipyard</span><input type="checkbox" id="shipyard"></label>
        <label><span>Clear All Last Paid Prices</span><input type="checkbox" id="clear"></label>
        <label><span>Force Player Profit</span><input type="checkbox" id="profit"></label>
        <label><span>Play Dock Sound</span><input type="checkbox" id="play-sound" ${setting("dockSoundPath") ? "checked" : ""}></label>
        <label><span>Use "in" instead of "on" when located here</span><input type="checkbox" id="use-in"></label>
        <label><span>Delete Location</span><input type="checkbox" id="delete-location"></label>
      </div>
    </div>`;
    new Dialog({
      title: "Party Docking, Market Update",
      content,
      buttons: {
        dock: { label: "<b>Dock / Travel</b>", callback: html => this.submit(html) },
        cancel: { label: "Cancel" }
      },
      render: html => {
        const fill = () => {
          const loc = data.locations[html.find("#loc").val()] || {};
          html.find("#illegal").prop("checked", !!loc.sellsIllegal);
          html.find("#shipyard").prop("checked", !!loc.hasShipyard);
          html.find("#use-in").prop("checked", !!loc.useIn);
          html.find("#market-state").val(loc.uninhabited ? "uninhabited" : (loc.stateOfEmergency ? "emergency" : "available"));
          toggleMarketControls(html);
          toggleDeleteLocationMode(html);
        };
        html.find("#loc").on("change", fill);
        html.find("#market-state").on("change", () => toggleMarketControls(html));
        html.find("#delete-location").on("change", () => toggleDeleteLocationMode(html));
        fill();
      }
    }, { ...dialogOptions(), width: 560 }).render(true);
  }

  static async submit(html) {
    let name = html.find("#loc").val();
    if (html.find("#delete-location").prop("checked")) {
      if (name === "create-new") return ui.notifications.error("Select an existing location to delete.");
      return requestGm("deleteLocation", { name });
    }
    if (name === "create-new") {
      name = await Dialog.prompt({
        title: "Enter New Location Name",
        content: `<div class="thm-root"><p>We are creating a new location, please enter it's name.</p><input type="text" id="new-location-name"></div>`,
        callback: h => h.find("#new-location-name").val()?.trim()
      });
    }
    if (!name) return ui.notifications.error("Location name cannot be empty.");
    requestGm("dock", {
      name,
      mode: "docked",
      sellsIllegal: html.find("#illegal").prop("checked"),
      hasShipyard: html.find("#shipyard").prop("checked"),
      stateOfEmergency: html.find("#market-state").val() === "emergency",
      uninhabited: html.find("#market-state").val() === "uninhabited",
      useIn: html.find("#use-in").prop("checked"),
      clearLastPaid: html.find("#clear").prop("checked"),
      forceProfit: html.find("#profit").prop("checked"),
      playDockSound: html.find("#play-sound").prop("checked")
    });
  }
}

function toggleMarketControls(html) {
  const uninhabited = html.find("#market-state").val() === "uninhabited";
  html.find("#illegal, #shipyard, #profit").prop("disabled", uninhabited);
  if (uninhabited) html.find("#illegal, #shipyard, #profit").prop("checked", false);
}

function toggleDeleteLocationMode(html) {
  const deleting = html.find("#delete-location").prop("checked");
  html.closest(".app").find('button[data-button="dock"]').html(deleting ? "<b>Delete Location</b>" : "<b>Dock / Travel</b>");
  html.find("#market-state, #illegal, #shipyard, #clear, #profit, #play-sound, #use-in").prop("disabled", deleting);
  if (!deleting) toggleMarketControls(html);
}

class ShipyardPage {
  static async showShipyardPage() {
    const state = serviceState();
    if (!state.shipyard) return ui.notifications.error("The shipyard is not available at this location.");
    const ships = (await getShipyardVehicles()).sort((a, b) => shipyardPurchasePrice(itemActorData(a)) - shipyardPurchasePrice(itemActorData(b)) || a.name.localeCompare(b.name));
    const owned = partyShips();
    if (!ships.length) return ui.notifications.error("No shipyard vehicles found in the configured compendium.");
    let index = 0;
    const render = async () => {
      const doc = ships[index];
      const ship = itemActorData(doc);
      const price = shipyardPurchasePrice(ship);
      const vehicleLabel = setting("vehicleLabel") || "Ship";
      const size = shipSizeLabel(ship.system?.traits?.size || "N/A");
      const shipClass = shipClassTier(size);
      const speed = shipSpeedText(ship);
      const cargoCapacity = ship.system?.attributes?.capacity?.cargo ?? "N/A";
      const moduleCapacity = ship.system?.attributes?.capacity?.creature ?? "N/A";
      const description = stripHtml(ship.system?.details?.biography?.value) || "";
      const ownedOptions = owned.map(actor => `<option value="${actor.id}">${actor.name}</option>`).join("");
      const content = `<div class="thm-root thm-compact">
        <h2 class="thm-center">Welcome to ${state.loc.name} Shipyard</h2>
        <div class="thm-shipyard-art"><img src="${ship.img}" data-img="${ship.img}" data-title="${ship.name}"></div>
        <div class="thm-actions"><button id="prev">Prev</button><button id="next">Next</button></div>
        <div class="thm-row thm-shipyard-copy">
          <div class="thm-shipyard-detail-grid">
            <p><b>Model:</b> ${ship.name}</p>
            <p><b>Class:</b> ${shipClass || "N/A"}</p>
            <p><b>Size:</b> ${size}</p>
            <p><b>Speed:</b> ${speed}</p>
            <p><b>Cargo Capacity:</b> ${cargoCapacity} tonnes</p>
            <p><b>Module Capacity:</b> ${moduleCapacity}</p>
          </div>
          <div><p><b>Purchase Price:</b> ${formatGp(price)}</p><p>${description}</p></div>
        </div>
        <hr>
        <div class="thm-shipyard-trade">
          <div class="thm-shipyard-trade-panel thm-shipyard-copy">
            <p><b>Owned ${vehicleLabel}:</b></p>
            <select id="owned">${ownedOptions}</select>
            <label class="thm-check-line"><input type="checkbox" id="trade-ship"> Sell Selected ${vehicleLabel}</label>
            <div class="thm-shipyard-option-box">
              <label class="thm-check-line"><input type="checkbox" id="trade-modules"> Sell Equipment</label>
              <label class="thm-check-line"><input type="checkbox" id="transfer-modules"> Transfer Equipment to New ${vehicleLabel}</label>
            </div>
            <button id="sell-only" disabled>Sell ${vehicleLabel} without Purchase</button>
          </div>
          <div class="thm-shipyard-cost-panel thm-center"><div class="thm-shipyard-cost-summary"><p><b>Trade in:</b> <span id="trade-value">0 GP</span></p><p id="total-cost"></p><p id="bank-after"></p></div><button id="buy">Buy ${vehicleLabel}</button></div>
        </div>
        <button class="thm-full-button" id="cancel">Cancel</button>
      </div>`;
      const dialog = new Dialog({ title: "Shipyard", content, buttons: {}, render: html => this.activate(html, { doc, ship, price, dialog }) }, dialogOptions());
      dialog.render(true);
    };
    this._render = render;
    this._ships = ships;
    this._index = () => index;
    this._setIndex = value => { index = value; };
    render();
  }

  static activate(html, { doc, price, dialog }) {
    const calc = () => {
      const ownedShip = game.actors.get(html.find("#owned").val());
      const shipValue = parseNumber(ownedShip?.system?.traits?.dimensions || 0);
      const moduleValue = parseNumber(ownedShip?.system?.details?.source?.custom || 0);
      let trade = html.find("#trade-ship").prop("checked") ? Math.floor(shipValue * 0.75) : 0;
      if (html.find("#trade-modules").prop("checked")) trade += Math.floor(moduleValue * 0.75);
      const total = price - trade;
      html.find("#trade-value").text(formatGp(trade));
      html.find("#total-cost").html(total < 0 ? `<b>Receiving Credit:</b> ${formatGp(Math.abs(total))}` : `<b>Total Remaining:</b> ${formatGp(total)}`);
      html.find("#bank-after").html(`<b>Balance after:</b> ${formatGp(bankBalance() - total)}`);
      html.find("#buy").prop("disabled", total > bankBalance());
      html.find("#sell-only").prop("disabled", !html.find("#trade-ship").prop("checked") || html.find("#transfer-modules").prop("checked"));
    };
    html.find("#prev").on("click", () => { dialog.close(); this._setIndex((this._index() - 1 + this._ships.length) % this._ships.length); this._render(); });
    html.find("#next").on("click", () => { dialog.close(); this._setIndex((this._index() + 1) % this._ships.length); this._render(); });
    html.find("#cancel").on("click", () => dialog.close());
    html.find("input, select").on("change", calc);
    html.find(".thm-shipyard-art img").on("click", ev => new ImagePopout(ev.currentTarget.dataset.img, { title: ev.currentTarget.dataset.title, shareable: true }).render(true));
    html.find("#trade-modules").on("change", () => {
      if (html.find("#trade-modules").prop("checked")) html.find("#transfer-modules").prop("checked", false);
      calc();
    });
    html.find("#transfer-modules").on("change", () => {
      if (html.find("#transfer-modules").prop("checked")) html.find("#trade-modules").prop("checked", false);
      calc();
    });
    html.find("#buy").on("click", () => requestGm("shipyardBuy", { sourceUuid: doc.uuid, ownedShipId: html.find("#owned").val(), tradeShip: html.find("#trade-ship").prop("checked"), tradeModules: html.find("#trade-modules").prop("checked"), transferModules: html.find("#transfer-modules").prop("checked") }));
    html.find("#sell-only").on("click", () => requestGm("shipyardSell", { shipId: html.find("#owned").val(), sellModules: true }));
    calc();
  }
}

function itemActorData(doc) {
  return duplicateDoc(doc);
}

function shipyardPurchasePrice(ship) {
  return parseNumber(ship?.system?.traits?.dimensions || ship?.system?.details?.source?.custom || 0);
}

function shipSizeLabel(size) {
  const key = String(size || "N/A").toLowerCase();
  const sizes = { tiny: "Tiny", sm: "Small", small: "Small", med: "Medium", medium: "Medium", lg: "Large", large: "Large", huge: "Huge", grg: "Gargantuan", gargantuan: "Gargantuan" };
  return sizes[key] || String(size || "N/A");
}

function shipClassTier(size) {
  const tiers = { Tiny: "D Tier", Small: "C Tier", Medium: "B Tier", Large: "A Tier", Huge: "X Tier", Gargantuan: "X Tier" };
  return tiers[size] || "";
}

function shipSpeedText(ship) {
  const movement = ship?.system?.attributes?.movement || {};
  const speed = movement.fly ?? movement.walk ?? "N/A";
  const units = movement.units || "";
  return `${speed}${units ? ` ${units}` : ""}`;
}

function shipValue(ship) {
  return parseNumber(ship?.system?.traits?.dimensions || 0) + parseNumber(ship?.system?.details?.source?.custom || 0);
}

function upkeepCost(ship) {
  return Math.floor(shipValue(ship) * 0.002);
}

function stringsFromValue(value, depth = 0) {
  if (depth > 4 || value == null) return [];
  if (typeof value === "string" || typeof value === "number") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(entry => stringsFromValue(entry, depth + 1));
  if (typeof value === "object") return Object.values(value).flatMap(entry => stringsFromValue(entry, depth + 1));
  return [];
}

function parseHyperdriveFormula(item) {
  if (!item) return "";
  const customCandidates = [
    item.system?.source?.custom,
    item.system?.details?.source?.custom
  ];
  for (const text of customCandidates) {
    const plain = stripHtml(text);
    const match = plain.match(/^\s*(\d+d\d+(?:\s*[+-]\s*\d+)?)\s*(?:LY|light\s*years?)?\s*$/i);
    if (match) return `${normalizeDiceFormula(match[1])} LY`;
  }
  const candidates = [
    item.system?.formula,
    item.system?.description?.value,
    item.system?.description?.chat,
    item.system?.description?.unidentified,
    ...stringsFromValue(item.system)
  ];
  for (const text of candidates) {
    const plain = stripHtml(text);
    const match = plain.match(/(\d+d\d+(?:\s*[+-]\s*\d+)?)\s*(?:LY|light\s*years?)/i);
    if (match) return `${normalizeDiceFormula(match[1])} LY`;
  }
  return "";
}

function normalizeDiceFormula(formula) {
  return String(formula || "").replace(/\s+/g, " ").replace(/\s*([+-])\s*/g, " $1 ").trim();
}

function hyperdriveFallbackFormula(item) {
  const name = item?.name || "";
  if (/\[S\]/i.test(name)) return "6d4 + 14 LY";
  if (/\[A\]/i.test(name)) return "4d4 + 12 LY";
  if (/\[B\]/i.test(name)) return "3d4 + 10 LY";
  if (/\[C\]/i.test(name)) return "2d4 + 4 LY";
  if (/\[D\]/i.test(name)) return "1d4 + 6 LY";
  return item ? "Unknown HyperDrive" : "No HyperDrive module found";
}

function hyperdriveRange(ship) {
  const hyperdrive = getShipItems(ship).find(item => isEquippedShipModule(item) && /hyperdrive/i.test(item.name));
  if (!hyperdrive) return "No HyperDrive module found";
  return parseHyperdriveFormula(hyperdrive) || hyperdriveFallbackFormula(hyperdrive);
}

function hpBarHtml(ship) {
  const hp = ship?.system?.attributes?.hp || {};
  const value = Number(hp.value || 0);
  const max = Number(hp.max || 0);
  const pct = max ? Math.min(value / max * 100, 100) : 0;
  const color = pct < 35 ? "#f44336" : pct < 65 ? "#ffeb3b" : "#4caf50";
  return `<div class="thm-hp-bar thm-shiptools-hp"><div class="thm-hp-fill" style="width:${pct}%; background:${color};"></div><div class="thm-hp-label">${value} / ${max}</div></div>`;
}

class ShipToolsPage {
  static async show() {
    const ships = accessibleShips().map(ship => game.actors.get(ship.id) || ship).filter(Boolean);
    if (!ships.length) return ui.notifications.info("No owned vehicle actors found.");
    const undocked = ships.find(ship => !ship.name.toLowerCase().includes("[docked]"));
    const initial = game.actors.get(selectedShipId) || undocked || ships[0];
    const options = ships.map(ship => `<option value="${ship.id}" ${ship.id === initial.id ? "selected" : ""}>${ship.name}</option>`).join("");
    const content = `<div class="thm-root thm-compact thm-shiptools">
      <div class="thm-shiptools-art"><img id="thm-tools-image" src="${initial.img || ""}" data-title="${initial.name}"></div>
      <div class="thm-center thm-green">Capital: ${formatGp(bankBalance())}</div>
      <div class="thm-vessel-select-main">
        <div class="thm-vessel-label">Select ${setting("vehicleLabel")}:</div>
        <select id="thm-tools-ship">${options}</select>
      </div>
      <div id="thm-tools-hp">${hpBarHtml(initial)}</div>
      <div class="thm-tools-grid">
        <button type="button" id="thm-loadout"><i class="fas fa-list"></i> View Loadout</button>
        <button type="button" id="thm-cargo"><i class="fas fa-box-open"></i> View Cargo</button>
        <button type="button" id="thm-sheet"><i class="fas fa-id-card"></i> View ${setting("vehicleLabel")} Sheet</button>
        <button type="button" id="thm-rest"><i class="fas fa-bed"></i> Long Rest</button>
        <button type="button" id="thm-register"><i class="fas fa-registered"></i> Registration</button>
        <button type="button" id="thm-fuel"><i class="fas fa-fire"></i> Fuel Release</button>
      </div>
    </div>`;
    new Dialog({
      title: "Ship Tools",
      content,
      buttons: { close: { label: "Close" } },
      render: html => {
        const currentShip = () => game.actors.get(html.find("#thm-tools-ship").val());
        const updateShip = () => {
          const ship = currentShip();
          if (!ship) return;
          html.find("#thm-tools-image").attr("src", ship.img || "").attr("data-title", ship.name);
          html.find("#thm-tools-hp").html(hpBarHtml(ship));
        };
        html.find("#thm-tools-ship").on("change", updateShip);
        html.find("#thm-tools-image").on("click", () => {
          const ship = currentShip();
          if (ship?.img) new ImagePopout(ship.img, { title: `${ship.name} Artwork`, shareable: true, uuid: ship.uuid }).render(true);
        });
        html.find("#thm-loadout").on("click", () => this.showLoadout(currentShip()));
        html.find("#thm-cargo").on("click", () => this.showCargo(currentShip()));
        html.find("#thm-sheet").on("click", () => currentShip()?.sheet?.render(true));
        html.find("#thm-rest").on("click", () => this.confirmLongRest(currentShip()));
        html.find("#thm-register").on("click", () => this.showRegistration(currentShip()));
        html.find("#thm-fuel").on("click", () => this.showFuelRelease(currentShip()));
      }
    }, { ...dialogOptions(), width: 620 }).render(true);
  }

  static showLoadout(ship) {
    if (!ship) return ui.notifications.error("Selected ship not found.");
    const stats = cargoStats(ship);
    const cargoItems = getShipItems(ship).filter(item => ["loot", "consumable"].includes(item.type) && Number(item.system?.quantity || 0) > 0);
    const modules = damageableModules(ship);
    const cargoValue = cargoItems.reduce((total, item) => total + Number(item.system?.price?.value || 0) * Number(item.system?.quantity || 0), 0);
    const shieldHp = modules.filter(module => /shield generator/i.test(module.name)).reduce((total, module) => total + Number(module.system?.hp?.value || 0), 0);
    const fuel = cargoItems.find(item => item.name.toLowerCase() === "hydrogen fuel");
    const content = `<div class="thm-root thm-compact">
      <strong>${ship.name}</strong><br>
      HP: ${ship.system?.attributes?.hp?.value || 0} HP<br>
	      Current Shields: ${shieldHp} HP<br>
	      Max Jump Distance: ${hyperdriveRange(ship)}<br>
	      Ship Value: ${formatGp(shipValue(ship))}<br>
	      Glaxon Insurance: ${isGlaxonInsured(ship) ? `Active (${formatGp(glaxonPremium(ship))} / Long Rest)` : "Not insured"}<br>
	      AC: ${ship.system?.attributes?.ac?.value || 0}<br><br>
      <strong>Modules:</strong><ul>${modules.map(module => `<li>${module.name}</li>`).join("") || "<li>None</li>"}</ul>
      <strong>Cargo:</strong><br>
      Cargo Capacity: ${Math.floor(stats.max).toLocaleString()} lbs<br>
      Current Loadout: ${Math.floor(stats.current).toLocaleString()} lbs<br>
      Cargo Value: ${formatGp(cargoValue)}<br>
      Fuel: Hydrogen x${Number(fuel?.system?.quantity || 0)} tonnes<br>
      ${stats.remaining >= 0 ? `<span class="thm-green">${Math.floor(stats.remaining).toLocaleString()} lbs of cargo space remaining.</span>` : `<span class="thm-red">WARNING: OVER WEIGHT<br>Hyperdrive Disabled</span>`}
    </div>`;
    new Dialog({
      title: `${ship.name} Loadout`,
      content,
      buttons: {
        print: { label: "Print to Chat", callback: () => ChatMessage.create({ user: game.user.id, content }) },
        close: { label: "Close" }
      }
    }, { ...dialogOptions(), width: 560 }).render(true);
  }

  static showCargo(ship) {
    if (!ship) return ui.notifications.error("Selected ship not found.");
    const items = getShipItems(ship).filter(item => ["loot", "consumable"].includes(item.type));
    const stats = cargoStats(ship);
    const rows = items.length ? items.map(item => {
      const qty = Number(item.system?.quantity || 0);
      return `<tr data-id="${item.id}" data-name="${item.name}">
        <td><div class="thm-item-cell"><img src="${item.img || ""}"><span class="thm-item-name">${item.name}</span></div></td>
        <td class="thm-center">${Math.ceil(Number(item.system?.weight || 0))}</td>
        <td class="thm-center">${qty}</td>
        <td class="thm-center"><input class="thm-number thm-qty" type="number" min="0" max="${qty}" value="0"></td>
        <td class="thm-center"><span class="thm-row-actions"><button class="thm-mini-button thm-clear">x</button><button class="thm-max">Max</button><input class="thm-check" type="checkbox" disabled></span></td>
      </tr>`;
    }).join("") : `<tr><td colspan="5" class="thm-center thm-muted">[Cargo Bay Empty]</td></tr>`;
    const content = `<div class="thm-root thm-compact">
      <div class="thm-link-title">Cargo Bay</div>
      ${cargoBar(stats)}
      <table class="thm-table"><thead><tr><th>Cargo Item</th><th>Weight (lb.)</th><th>Qty</th><th>Jettison Qty</th><th>Jettison</th></tr></thead><tbody>${rows}</tbody></table>
      <button class="thm-full-button" id="thm-jettison" disabled>Jettison Selected Items</button>
    </div>`;
    new Dialog({
      title: `${ship.name} Cargo Bay`,
      content,
      buttons: { close: { label: "Close" } },
      render: html => {
        const update = () => {
          let any = false;
          html.find("tbody tr[data-id]").each((_i, tr) => {
            const row = $(tr);
            const max = Number(row.find(".thm-qty").attr("max") || 0);
            const qty = Math.max(0, Math.min(Number(row.find(".thm-qty").val() || 0), max));
            row.find(".thm-qty").val(qty);
            row.find(".thm-check").prop("checked", qty > 0).prop("disabled", qty <= 0);
            any ||= qty > 0;
          });
          html.find("#thm-jettison").prop("disabled", !any);
        };
        html.find(".thm-qty").on("focus", ev => ev.currentTarget.select()).on("input", update);
        html.find(".thm-clear").on("click", ev => { $(ev.currentTarget).closest("tr").find(".thm-qty").val(0); update(); });
        html.find(".thm-max").on("click", ev => { const input = $(ev.currentTarget).closest("tr").find(".thm-qty"); input.val(input.attr("max")); update(); });
        html.find(".thm-item-name").on("click", ev => ship.items.get($(ev.currentTarget).closest("tr").data("id"))?.sheet?.render(true));
        html.find("#thm-jettison").on("click", () => {
          const items = [];
          html.find("tbody tr[data-id]").each((_i, tr) => {
            const row = $(tr);
            const quantity = Number(row.find(".thm-qty").val() || 0);
            if (quantity > 0) items.push({ itemId: row.data("id"), quantity });
          });
          requestGm("shipJettison", { shipId: ship.id, items });
          html.closest(".app").find(".close").click();
        });
      }
    }, { ...dialogOptions(), width: 760 }).render(true);
  }

	  static confirmLongRest(ship) {
	    if (!ship) return ui.notifications.error("Selected ship not found.");
	    const value = shipValue(ship);
	    const cost = upkeepCost(ship);
	    const insured = isGlaxonInsured(ship);
	    const premium = insured ? glaxonPremium(ship) : 0;
	    const totalCost = cost + premium;
	    Dialog.confirm({
	      title: "Long Rest Confirmation",
	      content: `<div class="thm-root thm-compact thm-center">
	        <p>When your ${setting("vehicleLabel").toLowerCase()} takes a Long Rest, shields recharge and crew actions are restored.</p>
	        <p>Equipment condition will not change unless repaired. During this time, the ${setting("vehicleLabel").toLowerCase()} cannot enter combat.</p>
	        <p><strong>Ship Value:</strong> ${formatGp(value)}<br><strong>Upkeep:</strong> ${formatGp(cost)}${insured ? `<br><strong>Glaxon Premium:</strong> ${formatGp(premium)}<br><strong>Total Due:</strong> ${formatGp(totalCost)}` : ""}</p>
	      </div>`,
      yes: () => requestGm("shipLongRest", { shipId: ship.id }),
      no: () => {},
      defaultYes: false
    });
  }

	  static showRegistration(ship) {
	    if (!ship) return ui.notifications.error("Selected ship not found.");
	    const crew = ship.system?.cargo?.crew || [];
	    const wanted = crew.some(member => typeof member.name === "string" && member.name.includes("[Wanted]"));
	    const cost = wanted ? 4000 : 2000;
	    const insured = isGlaxonInsured(ship);
	    const premium = glaxonPremium(ship);
	    const fullValue = fullRepairValue(ship);
	    new Dialog({
	      title: "Ship Registration",
	      content: `<div class="thm-root thm-compact">
	        <p>At any point, you can reregister your ship's designation. If you are <strong>[Wanted]</strong>, the cost is doubled.</p>
	        <label><strong>Enter ${setting("vehicleLabel")} Name:</strong></label>
	        <input type="text" id="vessel-name" value="${ship.name}">
	        <p><strong>Cost:</strong> ${formatGp(cost)}</p>
	        <hr>
	        <p><strong>Glaxon Insurance:</strong> ${insured ? `<span class="thm-green">Active</span>` : "Not insured"}<br>
	        Insure my vehicle at a base premium of 5% total repair value per long rest.<br>
	        <strong>Benefit:</strong> 50% off repair costs while insured.<br>
	        <strong>Full Repair Value:</strong> ${formatGp(fullValue)}<br>
	        <strong>Premium per Long Rest:</strong> ${formatGp(premium)}</p>
	      </div>`,
	      buttons: {
	        pay: { label: "Change Ship Name", callback: html => {
	          const name = html.find("#vessel-name").val()?.trim();
	          if (!name) return ui.notifications.error("You must enter a valid vessel name.");
	          requestGm("shipRegister", { shipId: ship.id, name, cost });
	        } },
        insure: { label: insured ? "Cancel Coverage" : "Insure My Vehicle", callback: () => {
          requestGm("shipInsurance", { shipId: ship.id, insured: !insured });
        } },
	        cancel: { label: "Cancel" }
	      }
	    }, { ...dialogOptions(), width: 460 }).render(true);
	  }

  static showFuelRelease(ship) {
    if (!ship) return ui.notifications.error("Selected ship not found.");
    new Dialog({
      title: "Emergency Hydrogen Fuel Release",
      content: `<div class="thm-root thm-compact">
        <label>Hydrogen (tonnes):</label>
        <input type="number" id="fuel-tonnes" value="1" min="0">
        <p>1 tonne of Hydrogen fuel covers 1 hyperdrive jump, or 1 LY and 1 day of supercruise travel.</p>
      </div>`,
      buttons: {
        warning: { label: "<strong>Purge Hydrogen</strong>", callback: async html => {
          const quantity = Number(html.find("#fuel-tonnes").val() || 0);
          if (quantity < 0) return ui.notifications.error("Invalid value.");
          const confirmed = await Dialog.confirm({
            title: "WARNING: HAZARDOUS OPERATION",
            content: `<div class="thm-red"><strong>WARNING:</strong> DO NOT release hydrogen near heat or open flame. Contents under pressure.</div><p>Are you sure you want to proceed?</p>`,
            yes: () => true,
            no: () => false,
            defaultYes: false
          });
          if (confirmed) requestGm("shipFuelPurge", { shipId: ship.id, quantity });
        } },
        cancel: { label: "Cancel" }
      }
    }, { ...dialogOptions(), width: 460 }).render(true);
  }
}

class CombatDamagePage {
  static show() {
    const actor = canvas?.tokens?.controlled?.[0]?.actor || game.actors.get(selectedShipId);
    if (!actor || actor.type !== "vehicle") return ui.notifications.error(`Select a ${setting("vehicleLabel").toLowerCase()} token or choose one in TradeHub first.`);
    const rolls = lastAttackAndDamageRolls();
    const shield = findShipModule(actor, /shield generator|shield/i);
    const shieldsUp = itemHp(shield) > 0;
    const hull = firstHealthyHullReinforcement(actor);
    const fuelScoop = findShipModule(actor, /fuel scoop/i);
    const refinery = findShipModule(actor, /refinery/i);
    const modules = damageableModules(actor).sort((a, b) => itemAc(a) - itemAc(b) || a.name.localeCompare(b.name));
    const moduleOptions = [`<option value="evenly" ${!hull ? "selected" : ""}>Evenly Among Vulnerable Modules</option>`]
      .concat(modules.map(item => `<option value="${item.id}" ${hull?.id === item.id ? "selected" : ""}>AC ${itemAc(item)} - ${item.name}</option>`))
      .join("");
    const attackModuleOptions = shieldsUp && shield
      ? modules.map(item => {
        const selected = item.id === shield.id ? "selected" : "";
        const suffix = item.id === shield.id ? " (Shields absorb first)" : "";
        return `<option value="${item.id}" ${selected}>AC ${itemAc(item)} - ${item.name}${suffix}</option>`;
      }).join("") || moduleOptions
      : moduleOptions;
    const fuelModuleOptions = modules.map(item => `<option value="${item.id}" ${fuelScoop?.id === item.id ? "selected" : ""}>AC ${itemAc(item)} - ${item.name}</option>`).join("") || moduleOptions;
    const miningDefault = refinery || (shieldsUp ? shield : null) || hull;
    const miningModuleOptions = [`<option value="evenly" ${!miningDefault ? "selected" : ""}>Evenly Among Vulnerable Modules</option>`]
      .concat(modules.map(item => {
        const selected = miningDefault?.id === item.id ? "selected" : "";
        const suffix = refinery?.id === item.id ? " (Refinery takes mining first)" : item.id === shield?.id && !refinery ? " (Shields absorb first)" : item.id === hull?.id && !refinery && !shieldsUp ? " (Hull protection first)" : "";
        return `<option value="${item.id}" ${selected}>AC ${itemAc(item)} - ${item.name}${suffix}</option>`;
      }))
      .join("");
    const repairModuleOptions = [`<option value="evenly" selected>Distribute Across Damaged Modules</option>`]
      .concat(modules.map(item => `<option value="${item.id}">AC ${itemAc(item)} - ${item.name}</option>`))
      .join("");
    const shieldText = shieldsUp
      ? `${actor.name} is being attacked. Shields are up, so damage will hit shields first.`
      : `${actor.name} is being attacked. No shields are active, so damage will go to hull protection before vulnerable modules.`;
    const repairPreview = fullServiceRepairPreview(actor);
    const content = `<div class="thm-root thm-compact thm-damage-tool">
      <nav class="thm-settings-tabs thm-damage-tabs">
        <button type="button" class="active" data-tab="attack">Attack Damage</button>
        <button type="button" data-tab="fuel">Fuel Scooping</button>
        <button type="button" data-tab="mining">Mining Damage</button>
        <button type="button" data-tab="repair">Repair Ship</button>
      </nav>
      <p class="thm-damage-summary"><strong>Target:</strong> ${actor.name}<br><strong>Status:</strong> ${shieldsUp ? "Shields Up" : "Shields Down"}<br>${shieldText}</p>
      <section class="thm-settings-section active" data-tab-panel="attack">
        <p class="notes">Only modules which are lower than the AC of the attack will be hit in the attack.</p>
        <label>Damage Type:</label>
        <select id="damage-type"><option value="thermal" ${shieldsUp ? "selected" : ""}>Thermal / Shield</option><option value="hull" ${!shieldsUp ? "selected" : ""}>Hull</option></select>
        <label>Attack:</label><input type="number" id="attack-input" value="${rolls.attack ?? ""}" placeholder="Attack total">
        <label>Damage:</label><input type="number" id="damage-input" value="${rolls.damage ?? 0}" min="0">
        <label>Channel Damage:</label><select id="target-module">${attackModuleOptions}</select>
      </section>
      <section class="thm-settings-section" data-tab-panel="fuel">
        <p class="notes">Fuel scooping uses a fixed attack total of 25. Damage stays editable and defaults from the last damage roll.</p>
        <label>Damage Type:</label><select id="fuel-damage-type"><option value="thermal">Thermal / Shield</option></select>
        <label>Attack:</label><input type="number" id="fuel-attack-input" value="25">
        <label>Damage:</label><input type="number" id="fuel-damage-input" value="${rolls.damage ?? 0}" min="0">
        <label>Damage Module:</label><select id="fuel-target-module">${fuelModuleOptions}</select>
        <div class="thm-fuel-scoop-grant">
          <label>Hydrogen Fuel Scooped:</label>
          <input type="number" id="fuel-scoop-input" value="${rolls.fuelYield ?? 0}" min="0">
          <button type="button" id="fuel-scoop-add"><i class="fas fa-gas-pump"></i> Add Hydrogen Fuel</button>
        </div>
      </section>
      <section class="thm-settings-section" data-tab-panel="mining">
        <p class="notes">Refinery takes this damage first when installed.<br>Only modules which are lower than the AC of the attack will be hit in the attack.</p>
        <label>Damage Type:</label><select id="mining-damage-type"><option value="hull" ${!shieldsUp ? "selected" : ""}>Hull</option><option value="thermal" ${shieldsUp ? "selected" : ""}>Thermal / Shield</option></select>
        <label>Attack:</label><input type="number" id="mining-attack-input" value="${rolls.attack ?? ""}" placeholder="Attack total">
        <label>Damage:</label><input type="number" id="mining-damage-input" value="${rolls.damage ?? 0}" min="0">
        <label>Damage Module:</label><select id="mining-target-module">${miningModuleOptions}</select>
      </section>
      <section class="thm-settings-section" data-tab-panel="repair">
        <p class="notes">Make Pristine recalculates HP, AC, module value, jump data, and restores all module condition. Full Service Repair can bill TradeHub Capital. Ability Check Repair applies the entered repair HP without billing.</p>
        <label>Repair Action:</label>
        <select id="repair-action">
          <option value="heal" selected>Ability Check Repair</option>
          <option value="full-service">Full Service Repair and Replace</option>
          <option value="pristine">Make Pristine</option>
        </select>
        <div class="thm-repair-hp-row">
          <label>Repair HP:</label><input type="number" id="repair-hp-input" value="${rolls.damage ?? ""}" min="0" placeholder="HP from card or repair roll">
        </div>
        <label class="thm-checkbox-row thm-repair-bill-row" style="display:none;"><span>Bill the TradeHub Capital</span><input class="thm-check" type="checkbox" id="repair-bill-capital" checked></label>
        <label>Repair Module:</label><select id="repair-target-module">${repairModuleOptions}</select>
        <p class="notes"><strong>Full Service Estimate:</strong> ${formatGp(repairPreview.total)}${repairPreview.insured ? `<br><strong>Glaxon Full Value:</strong> ${formatGp(repairPreview.rawTotal)}<br><strong>Glaxon Savings:</strong> ${formatGp(repairPreview.rawTotal - repairPreview.total)}` : ""}<br><strong>TradeHub Capital After:</strong> ${formatGp(bankBalance() - repairPreview.total)}</p>
      </section>
    </div>`;
    new Dialog({
      title: "Apply Damage",
      content,
      buttons: {
        ok: { label: "OK", callback: html => {
          const tab = html.find(".thm-damage-tabs button.active").data("tab") || "attack";
          if (tab === "repair") {
            const action = html.find("#repair-action").val();
	          requestGm("combatRepair", {
	            actorId: actor.id,
	            action,
	            hp: Math.max(0, Number(html.find("#repair-hp-input").val() || 0)),
	            targetModule: html.find("#repair-target-module").val() || "evenly",
	            billCapital: html.find("#repair-bill-capital").prop("checked") !== false
	          });
            return;
          }
          const prefix = tab === "attack" ? "" : `${tab}-`;
          requestGm("applyCombatDamage", {
            actorId: actor.id,
            context: tab,
            damageType: html.find(`#${prefix}damage-type`).val(),
            attack: Number(html.find(`#${prefix}attack-input`).val() || 0),
            damage: Math.max(0, Number(html.find(`#${prefix}damage-input`).val() || 0)),
            targetModule: html.find(`#${prefix}target-module`).val() || "evenly"
          });
        } },
        cancel: { label: "Cancel" }
      },
      render: html => {
	        html.find(".thm-damage-tabs button").on("click", ev => {
	          const tab = ev.currentTarget.dataset.tab;
	          html.find(".thm-damage-tabs button").removeClass("active");
	          $(ev.currentTarget).addClass("active");
	          html.find(".thm-settings-section").removeClass("active");
	          html.find(`.thm-settings-section[data-tab-panel="${tab}"]`).addClass("active");
	        });
	        const syncRepairBillingRow = () => {
	          const isFullService = html.find("#repair-action").val() === "full-service";
	          html.find(".thm-repair-hp-row").toggle(!isFullService);
	          html.find(".thm-repair-bill-row").toggle(isFullService);
	        };
	        html.find("#repair-action").on("change", syncRepairBillingRow);
	        syncRepairBillingRow();
          html.find("#fuel-scoop-add").on("click", () => {
            const quantity = Math.max(0, Number(html.find("#fuel-scoop-input").val() || 0));
            if (!quantity) return ui.notifications.warn("Enter the Hydrogen Fuel amount scooped.");
            requestGm("shipFuelScoop", { shipId: actor.id, quantity });
          });
	      }
    }, { ...dialogOptions(["combat-damage"]), width: 520 }).render(true);
  }
}

function lastAttackAndDamageRolls() {
  const messages = Array.from(game.messages?.contents || []).slice().reverse();
  const rollOf = message => {
    const rolls = message.rolls || (message.roll ? [message.roll] : []);
    return rolls[0] || null;
  };
  const messageText = message => stripHtml(`${message.flavor || ""} ${message.content || ""}`);
  const attackMessage = messages.find(message => rollOf(message)?.formula?.includes("1d20") && !/constitution saving throw/i.test(messageText(message)));
  const fuelYieldMessage = messages.find(message => {
    const roll = rollOf(message);
    return roll && !roll.formula?.includes("1d20") && /other formula/i.test(messageText(message));
  });
  const damageMessage = messages.find(message => {
    const roll = rollOf(message);
    const text = messageText(message);
    return roll && !roll.formula?.includes("1d20") && !/other formula|constitution saving throw/i.test(text);
  });
  return {
    attack: rollOf(attackMessage)?.total ?? null,
    damage: rollOf(damageMessage)?.total ?? 0,
    fuelYield: rollOf(fuelYieldMessage)?.total ?? 0
  };
}

function isEquippedShipModule(item) {
  return ["equipment", "weapon"].includes(item?.type) && item?.system?.equipped === true;
}

function damageableModules(actor) {
  return actor.items.filter(item => isEquippedShipModule(item) && itemMaxHp(item) > 0);
}

function itemMaxHp(item) {
  return Number(item?.system?.hp?.max || 0);
}

function itemHp(item) {
  return Number(item?.system?.hp?.value || 0);
}

function itemAc(item) {
  return Number(item?.system?.armor?.value ?? item?.system?.ac?.value ?? 0);
}

function findShipModule(actor, pattern) {
  return actor?.items?.find(item => isEquippedShipModule(item) && pattern.test(item.name || "") && itemMaxHp(item) > 0);
}

function firstHealthyHullReinforcement(actor) {
  return damageableModules(actor).find(item => /hull reinforcements?/i.test(item.name || "") && itemHp(item) > 0);
}

function heatSinkItem(actor) {
  return actor.items.find(item => /heat sink/i.test(item.name || "") && Number(item.system?.quantity ?? 1) > 0);
}

async function consumeHeatSink(actor) {
  const heatSink = heatSinkItem(actor);
  if (!heatSink) return false;
  const quantity = Number(heatSink.system?.quantity ?? 1);
  if (quantity > 1) await heatSink.update({ "system.quantity": quantity - 1 });
  else await heatSink.delete();
  return true;
}

async function updateModuleHp(item, hp) {
  await item.update({ "system.hp.value": Math.max(0, Number(hp || 0)) });
}

function heatSinkChoiceCard({ actor, amount, reason, extra = "", attack = 0, damageType = "thermal", mode = "carryover" }) {
  const attrs = `data-actor-id="${actor.id}" data-amount="${Number(amount || 0)}" data-reason="${escapeHtml(reason)}" data-extra="${escapeHtml(extra)}" data-attack="${Number(attack || 0)}" data-damage-type="${escapeHtml(damageType)}" data-mode="${escapeHtml(mode)}"`;
  const prompt = mode === "cargo"
    ? `<b>${actor.name}</b> is about to lose cargo because <b>${escapeHtml(reason)}</b> failed.<br>Deploy a Heat Sink to protect the cargo hold?`
    : `<b>${actor.name}</b> is incurring <b>${Number(amount || 0)} Thermal Damage</b> from <b>${escapeHtml(reason)}</b>.<br>Would you like to use a Heat Sink to tank the excess damage and protect the craft?`;
  return `<div class="thm-heat-sink-card">${prompt}${extra}<div class="thm-heat-sink-actions"><button type="button" data-thm-heat-sink ${attrs}>Deploy Heat Sink</button><button type="button" data-thm-heat-sink-no ${attrs}>No</button></div></div>`;
}

async function markHeatSinkChoice(messageId, label) {
  const original = game.messages.get(messageId);
  if (!original?.isOwner) return;
  const content = original.content
    .replace(/<button[^>]*data-thm-heat-sink[^>]*>Deploy Heat Sink<\/button>/g, `<button type="button" disabled>${label}</button>`)
    .replace(/<button[^>]*data-thm-heat-sink-no[^>]*>No<\/button>/g, `<button type="button" disabled>Resolved</button>`);
  await original.update({ content });
}

async function jettisonCargoFromActor(actor) {
  const cargo = actor.items.filter(item => item.type === "loot");
  if (!cargo.length) return [];
  const count = Math.min(cargo.length, Math.floor(Math.random() * 4) + 1);
  const removed = [];
  for (let i = 0; i < count; i++) {
    const index = Math.floor(Math.random() * cargo.length);
    const item = cargo.splice(index, 1)[0];
    const quantity = Number(item.system?.quantity || 1);
    const value = parseNumber(item.system?.price?.value ?? item.system?.price ?? 0) * quantity;
    removed.push(`${item.name} x${quantity}${value ? ` (${formatGp(value)})` : ""}`);
    await item.delete();
  }
  return removed;
}

async function applyQueuedCarryoverDamage(actor, { amount, attack, damageType = "thermal", source = "incoming damage", allowCargoPrompt = true }) {
  let remainingDamage = Math.max(0, Number(amount || 0));
  const details = [];
  const destroyedDetails = [];
  const prompts = [];
  const modules = damageableModules(actor);
  let pool = modules.filter(module => itemHp(module) > 0 && itemAc(module) <= Number(attack || 0) && !/shield generator/i.test(module.name));
  if (!pool.length) {
    details.push(`<span class="thm-muted">No vulnerable modules were hit by AC ${attack || "N/A"}.</span>`);
  } else {
    const hpRemaining = new Map(pool.map(module => [module.id, itemHp(module)]));
    const allocations = new Map();
    while (remainingDamage > 0 && pool.length) {
      const shuffled = shuffleArray(pool);
      const base = Math.floor(remainingDamage / shuffled.length);
      let remainder = remainingDamage % shuffled.length;
      let overflow = 0;
      for (const module of shuffled) {
        const requested = base + (remainder > 0 ? 1 : 0);
        if (remainder > 0) remainder -= 1;
        if (requested <= 0) continue;
        const available = Number(hpRemaining.get(module.id) || 0);
        const dealt = Math.min(available, requested);
        hpRemaining.set(module.id, available - dealt);
        allocations.set(module.id, (allocations.get(module.id) || 0) + dealt);
        overflow += requested - dealt;
      }
      remainingDamage = overflow;
      pool = pool.filter(module => Number(hpRemaining.get(module.id) || 0) > 0);
    }
    for (const module of modules) {
      const dealt = Number(allocations.get(module.id) || 0);
      if (dealt <= 0) continue;
      const before = itemHp(module);
      const after = Math.max(0, before - dealt);
      await updateModuleHp(module, after);
      const line = after <= 0 ? `<b>${module.name} hit for ${dealt} HP and is destroyed!</b>` : `${module.name} hit for ${dealt} HP`;
      (after <= 0 ? destroyedDetails : details).push(line);
      if (before > 0 && after <= 0 && /cargo bay/i.test(module.name || "")) {
        if (allowCargoPrompt && heatSinkItem(actor)) {
          prompts.push(heatSinkChoiceCard({ actor, amount: dealt, reason: module.name, attack, damageType, mode: "cargo", extra: `<br>Status: Cargo hold failure imminent.` }));
        } else {
          const removed = await jettisonCargoFromActor(actor);
          if (removed.length) details.push(`<div class="thm-heat-sink-card thm-heat-sink-danger"><b style="color:red;">Cargo Jettisoned!</b><br>${removed.join("<br>")}</div>`);
        }
      }
    }
  }
  const totalHp = await syncVehicleHpFromModules(actor);
  return {
    details: details.concat(destroyedDetails.length ? ["", ...destroyedDetails] : []),
    prompts,
    totalHp
  };
}

async function syncVehicleHpFromModules(actor) {
  const total = damageableModules(actor).reduce((sum, item) => sum + itemHp(item), 0);
  await actor.update({ "system.attributes.hp.value": total });
  return total;
}

function currentModuleHpTotal(actor) {
  return damageableModules(actor).reduce((sum, item) => sum + Math.max(0, Math.min(itemHp(item), itemMaxHp(item))), 0);
}

function shipHyperdriveFormula(actor) {
  const hyper = damageableModules(actor).find(item => /hyper\s?drive/i.test(item.name || ""));
  if (!hyper) return "No HyperDrive module found";
  return parseHyperdriveFormula(hyper) || hyperdriveFallbackFormula(hyper);
}

function shipStatSummary(actor) {
  const modules = damageableModules(actor);
  const nonShield = modules.filter(item => !isShieldModule(item));
  const totalMaxHp = modules.reduce((sum, item) => sum + itemMaxHp(item), 0);
  const shieldHp = modules.filter(isShieldModule).reduce((sum, item) => sum + itemMaxHp(item), 0);
  const acModules = nonShield.filter(item => itemAc(item) > 0);
  const averageAc = acModules.length ? Math.round(acModules.reduce((sum, item) => sum + itemAc(item), 0) / acModules.length) : 0;
  const moduleValue = modules.reduce((sum, item) => sum + parseNumber(item.system?.price?.value ?? item.system?.price ?? 0), 0);
  const shipCost = parseNumber(actor.system?.traits?.dimensions || 0);
  return { modules, totalMaxHp, shieldHp, averageAc, moduleValue, shipCost, totalValue: shipCost + moduleValue, hyperdrive: shipHyperdriveFormula(actor) };
}

async function makeShipPristine(actor, { chat = true, reason = "Manual pristine refresh", userId = game.user.id } = {}) {
  if (!actor || actor.type !== "vehicle") throw new Error("Selected vehicle not found.");
  const beforeHp = Number(actor.system?.attributes?.hp?.max || 0);
  const summary = shipStatSummary(actor);
  for (const item of summary.modules) {
    await item.update({ "system.hp.value": itemMaxHp(item) });
  }
  const publicBio = [
    `HP Adjusted from ${beforeHp} HP to ${summary.totalMaxHp} HP`,
    `Current Shields: ${summary.shieldHp} HP`,
    `Max Jump Distance: ${summary.hyperdrive}`,
    `Cargo Capacity: ${actor.system?.cargo?.capacity || 0} Tonnes`,
    `Ship Cost: ${summary.totalValue.toLocaleString()} GP`,
    `Average AC: ${summary.averageAc}`
  ].join("<br>");
  await actor.update({
    "system.attributes.hp.max": summary.totalMaxHp,
    "system.attributes.hp.value": summary.totalMaxHp,
    "system.attributes.ac.value": summary.averageAc,
    "system.details.source.custom": `Module Value: ${Math.floor(summary.moduleValue).toLocaleString()} GP`,
    "system.details.biography.public": publicBio
  });
  if (chat) {
    await ChatMessage.create({
      user: userId,
      content: `<b>${actor.name} Made Pristine</b><br>${escapeHtml(reason)}<br>HP Adjusted from ${beforeHp} HP to ${summary.totalMaxHp} HP<br>Current Shields: ${summary.shieldHp} HP<br>Max Jump Distance: ${summary.hyperdrive}<br>Ship Value: ${formatGp(summary.totalValue)}<br>Average AC: ${summary.averageAc}`,
      speaker: { alias: "TradeHub Ship Repair" }
    });
  }
  return summary;
}

async function syncVehicleStatsFromModules(actor, { reason = "Loadout updated", notify = false } = {}) {
  if (!actor || actor.type !== "vehicle") throw new Error("Selected vehicle not found.");
  const summary = shipStatSummary(actor);
  const currentHp = currentModuleHpTotal(actor);
  const publicBio = [
    `HP Adjusted to ${summary.totalMaxHp} HP`,
    `Current Shields: ${summary.shieldHp} HP`,
    `Max Jump Distance: ${summary.hyperdrive}`,
    `Cargo Capacity: ${actor.system?.cargo?.capacity || 0} Tonnes`,
    `Ship Cost: ${summary.totalValue.toLocaleString()} GP`,
    `Average AC: ${summary.averageAc}`
  ].join("<br>");
  await actor.update({
    "system.attributes.hp.max": summary.totalMaxHp,
    "system.attributes.hp.value": currentHp,
    "system.attributes.ac.value": summary.averageAc,
    "system.details.source.custom": `Module Value: ${Math.floor(summary.moduleValue).toLocaleString()} GP`,
    "system.details.biography.public": publicBio
  });
  if (notify) ui.notifications.info(`${actor.name} stats synchronized: ${reason}.`);
  return { ...summary, currentHp };
}

function scheduleVehicleStatSync(actor, reason) {
  if (!actor?.id) return;
  clearTimeout(pristineRefreshTimers.get(actor.id));
  pristineRefreshTimers.set(actor.id, setTimeout(async () => {
    pristineRefreshTimers.delete(actor.id);
    try {
      await syncVehicleStatsFromModules(actor, { reason, notify: false });
      const data = getData();
      syncShipDirectory(data);
      await setSetting("data", data);
      broadcastRefresh();
    } catch (err) {
      console.error(err);
      ui.notifications.warn(`TradeHub could not refresh ${actor.name}: ${err.message}`);
    }
  }, 500));
}

function fullServiceRepairPreview(actor) {
  const repairs = damageableModules(actor).map(item => {
    const missing = Math.max(0, itemMaxHp(item) - itemHp(item));
    const rawCost = missing * repairUnitCost(item);
    return { item, missing, rawCost, cost: repairCostForItem(item, missing, actor) };
  }).filter(entry => entry.missing > 0);
  return {
    repairs,
    rawTotal: repairs.reduce((sum, entry) => sum + entry.rawCost, 0),
    total: repairs.reduce((sum, entry) => sum + entry.cost, 0),
    insured: isGlaxonInsured(actor)
  };
}

async function fullServiceRepair(actor, { billCapital = true } = {}) {
  const preview = fullServiceRepairPreview(actor);
  if (!preview.repairs.length) return { ...preview, totalHp: currentModuleHpTotal(actor), rows: [] };
  if (billCapital && bankBalance() < preview.total) throw new Error(`Not enough TradeHub capital for full service repair. Required: ${formatGp(preview.total)}; Available: ${formatGp(bankBalance())}.`);
  if (billCapital) await updateBank(bankBalance() - preview.total);
  for (const entry of preview.repairs) await updateModuleHp(entry.item, itemMaxHp(entry.item));
  const summary = await syncVehicleStatsFromModules(actor, { reason: "Full Service Repair and Replace", notify: false });
  const rows = preview.repairs
    .sort((a, b) => b.cost - a.cost)
    .map(entry => `${entry.item.name}: ${entry.missing} HP restored (${billCapital ? formatGp(entry.cost) : `${formatGp(entry.cost)} waived`}${preview.insured ? `, Glaxon value ${formatGp(entry.rawCost)}` : ""})`);
  return { ...preview, billed: billCapital ? preview.total : 0, billCapital, totalHp: summary.currentHp, rows };
}

async function abilityRepair(actor, targetModule, hpToAdd) {
  let remaining = Math.max(0, Number(hpToAdd || 0));
  let added = 0;
  const repaired = new Map();
  const addRepairDetail = (item, hp) => {
    if (!item || hp <= 0) return;
    const current = repaired.get(item.id) || { name: item.name, hp: 0 };
    current.hp += hp;
    repaired.set(item.id, current);
  };
  if (remaining <= 0) return { added: 0, details: [] };
  if (targetModule && targetModule !== "evenly") {
    const item = actor.items.get(targetModule);
    if (!item) return { added: 0, details: [] };
    const add = Math.min(remaining, Math.max(0, itemMaxHp(item) - itemHp(item)));
    if (add > 0) {
      await updateModuleHp(item, itemHp(item) + add);
      addRepairDetail(item, add);
      added += add;
    }
    return { added, details: [...repaired.values()].map(entry => `${entry.name}: ${entry.hp} HP repaired`) };
  }
  let pool = damageableModules(actor).filter(item => !isShieldModule(item) && itemHp(item) > 0 && itemHp(item) < itemMaxHp(item));
  while (remaining > 0 && pool.length) {
    for (const item of [...pool]) {
      if (remaining <= 0) break;
      const add = Math.min(1, itemMaxHp(item) - itemHp(item));
      if (add > 0) {
        await updateModuleHp(item, itemHp(item) + add);
        addRepairDetail(item, add);
        remaining -= add;
        added += add;
      }
    }
    pool = pool.filter(item => itemHp(item) > 0 && itemHp(item) < itemMaxHp(item));
  }
  const details = [...repaired.values()]
    .sort((a, b) => b.hp - a.hp || a.name.localeCompare(b.name))
    .map(entry => `${entry.name}: ${entry.hp} HP repaired`);
  return { added, details };
}

class TradeHubSettingsForm extends FormApplication {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "tradehub-markets-settings",
      title: "TradeHub Markets Settings",
      template: `modules/${MODULE_ID}/templates/settings.html`,
      width: 1180,
      height: 820,
      closeOnSubmit: true,
      classes: ["tradehub-markets", "thm-settings-app"]
    });
  }

  getData() {
    const data = getData();
    return {
      packFields: [
        this.packFieldData("tradeGoodsPack", "tradeGoodsFolderPath", "Trade Goods", "Items sold through normal markets."),
        this.packFieldData("ammoRestockPack", "ammoRestockFolderPath", "Ammunition Restock", "Dedicated ammunition/restock source."),
        this.packFieldData("vehicleConsumablesPack", "vehicleConsumablesFolderPath", "Vehicle Consumables", "Vehicle equipment and repair reference items."),
        this.packFieldData("shipyardPack", "shipyardFolderPath", "Shipyard Vehicles", "Purchasable vehicle actor compendium.")
      ],
      settings: {
        marketplaceImage: setting("marketplaceImage") || "",
        adFolder: setting("adFolder") || "",
        dockSoundPath: setting("dockSoundPath") || "",
        starportLoadSoundPath: setting("starportLoadSoundPath") || "",
        vehicleLabel: setting("vehicleLabel") || "Vessel",
        repairCostPerHp: Number(setting("repairCostPerHp") || 0),
        repairCostPerShieldPoint: Number(setting("repairCostPerShieldPoint") || 0),
        stockMin: Number(setting("stockMin") || 0),
        stockMax: Number(setting("stockMax") || 0),
        maxPriceChangePercent: Number(setting("maxPriceChangePercent") || 0),
        maxShortagePriceIncreasePercent: Number(setting("maxShortagePriceIncreasePercent") || 57),
        enableTradeRumours: !!setting("enableTradeRumours"),
        launchOnDock: !!setting("launchOnDock"),
        showGmBar: !!setting("showGmBar"),
        capital: Number(data.capital || 0),
        newsJournalUuid: tradeHubNewsJournal()?.uuid || ""
      }
    };
  }

  packFieldData(packKey, folderKey, label, hint) {
    const selected = setting(packKey) || "";
    const options = [`<option value="">None selected</option>`]
      .concat(game.packs.contents.map(pack => `<option value="${pack.collection}" ${pack.collection === selected ? "selected" : ""}>${pack.collection} (${pack.documentName})</option>`))
      .join("");
    return { packKey, folderKey, label, hint, options, folderValue: setting(folderKey) || "" };
  }

  activateListeners(html) {
    super.activateListeners(html);
    html.find(".thm-settings-tabs button").on("click", ev => {
      const tab = ev.currentTarget.dataset.tab;
      html.find(".thm-settings-tabs button").removeClass("active");
      $(ev.currentTarget).addClass("active");
      html.find(".thm-settings-section").removeClass("active");
      html.find(`.thm-settings-section[data-tab-panel="${tab}"]`).addClass("active");
    });
    const updateFolders = async wrapper => {
      const packKey = wrapper.dataset.packKey;
      const folderKey = wrapper.dataset.folderKey;
      const packId = wrapper.querySelector(`select[name="${packKey}"]`).value;
      const row = wrapper.querySelector(".thm-folder-row");
      const select = wrapper.querySelector(`select[name="${folderKey}"]`);
      const selectedFolder = select.dataset.current || "";
      const folders = await folderPathsForPack(packId);
      select.innerHTML = `<option value="">Whole Compendium</option>${folders.map(path => `<option value="${path}" ${path === selectedFolder ? "selected" : ""}>${path}</option>`).join("")}`;
      row.hidden = folders.length === 0;
    };
    html.find(".thm-pack-field").each((_i, wrapper) => {
      updateFolders(wrapper);
      $(wrapper).find(`select[name="${wrapper.dataset.packKey}"]`).on("change", () => {
        const folderSelect = wrapper.querySelector(`select[name="${wrapper.dataset.folderKey}"]`);
        folderSelect.dataset.current = "";
        updateFolders(wrapper);
      });
      $(wrapper).find(".thm-folder-row select").on("change", ev => {
        ev.currentTarget.dataset.current = ev.currentTarget.value;
      });
    });
    html.find("[data-file-picker]").on("click", ev => {
      const target = ev.currentTarget.dataset.target;
      const input = html.find(`[name="${target}"]`);
      new FilePicker({
        type: "audio",
        current: input.val(),
        callback: path => input.val(path)
      }).render(true);
    });
    html.find("[data-open-news]").on("click", async ev => {
      const doc = await fromUuid(ev.currentTarget.dataset.openNews);
      doc?.sheet?.render(true);
    });
  }

  async _updateObject(_event, formData) {
    const data = getData();
    const keys = [
      "tradeGoodsPack", "tradeGoodsFolderPath",
      "ammoRestockPack", "ammoRestockFolderPath",
      "vehicleConsumablesPack", "vehicleConsumablesFolderPath",
      "shipyardPack", "shipyardFolderPath",
      "marketplaceImage", "adFolder", "dockSoundPath", "starportLoadSoundPath", "vehicleLabel"
    ];
    for (const key of keys) await setSetting(key, formData[key] ?? "");
    await setSetting("repairCostPerHp", Number(formData.repairCostPerHp || 0));
    await setSetting("repairCostPerShieldPoint", Number(formData.repairCostPerShieldPoint || 0));
    await setSetting("stockMin", Number(formData.stockMin || 0));
    await setSetting("stockMax", Number(formData.stockMax || 0));
    await setSetting("maxPriceChangePercent", Number(formData.maxPriceChangePercent || 0));
    await setSetting("maxShortagePriceIncreasePercent", Math.max(0, Number(formData.maxShortagePriceIncreasePercent || 0)));
    await setSetting("enableTradeRumours", !!formData.enableTradeRumours);
    await setSetting("launchOnDock", !!formData.launchOnDock);
    await setSetting("showGmBar", !!formData.showGmBar);
    data.capital = Number(formData.capital || 0);
    syncShipDirectory(data);
    await setSetting("data", data);
    ui.notifications.info("TradeHub settings saved.");
    broadcastRefresh();
  }
}

class ConfigPage {
  static show() {
    new TradeHubSettingsForm().render(true);
  }
}

class BankingPage {
  static show() {
    if (!game.user.isGM) return ui.notifications.error("Only the GM can edit TradeHub capital.");
    const cash = Math.floor(bankBalance());
    const playerActors = game.actors.filter(actor => actor.hasPlayerOwner && actor.type !== "vehicle");
    const playerOptions = playerActors.map(actor => `<option value="${actor.id}">${actor.name}</option>`).join("");
    const content = `<div class="thm-root thm-compact">
      <div class="thm-bank-card">
        <div class="thm-bank-title">TradeHub Capital</div>
        <div class="thm-bank-balance">${formatGp(cash)}</div>
      </div>
      <div class="thm-config-grid">
        <label for="bank-value">Enter Value:</label>
        <input type="number" id="bank-value" name="bank-value" placeholder="+100, -50, etc.">
        <label for="override">Replace total:</label>
        <input type="checkbox" id="override" name="override">
        <label for="player-withdrawal">Player withdrawal:</label>
        <input type="checkbox" id="player-withdrawal" name="player-withdrawal">
        <label for="player-select">Select Player:</label>
        <select id="player-select" name="player-select" disabled>${playerOptions}</select>
      </div>
    </div>`;
    new Dialog({
      title: "TradeHub Banking",
      content,
      buttons: {
        save: {
          label: "Save",
          callback: html => this.save(html, cash)
        },
        cancel: { label: "Cancel" }
      },
      default: "save",
      render: html => {
        html.find("#player-withdrawal").on("change", ev => html.find("#player-select").prop("disabled", !ev.currentTarget.checked));
      }
    }, { ...dialogOptions(), width: 520 }).render(true);
  }

  static async save(html, cash) {
    const raw = String(html.find("#bank-value").val() || "").trim();
    const value = parseInt(raw, 10);
    if (Number.isNaN(value)) return ui.notifications.error("Invalid input. Please enter a valid number.");
    const override = html.find("#override").prop("checked");
    const playerWithdrawal = html.find("#player-withdrawal").prop("checked");
    const selectedPlayerId = html.find("#player-select").val();
    let newValue = override ? value : cash + value;
    if (newValue < 0) return ui.notifications.error("TradeHub capital cannot go below 0.");
    await updateBank(newValue);
    let messageContent;
    if (override) {
      messageContent = `<b>${formatGp(newValue)} has been set as TradeHub Capital.</b><br>TradeHub Capital: ${formatGp(newValue)}`;
    } else {
      const action = value > 0 ? "added to" : "withdrawn from";
      messageContent = `<b>${formatGp(Math.abs(value))} has been ${action} TradeHub Capital.</b><br>TradeHub Capital: ${formatGp(newValue)}`;
      if (playerWithdrawal && value < 0 && selectedPlayerId) {
        const playerActor = game.actors.get(selectedPlayerId);
        if (playerActor) {
          const playerCash = Number(playerActor.system?.currency?.gp || 0) + Math.abs(value);
          await playerActor.update({ "system.currency.gp": playerCash });
          messageContent += `<br><b>Withdrew ${formatGp(Math.abs(value))} from TradeHub Capital to ${playerActor.name}.</b>`;
        }
      }
    }
    await ChatMessage.create({ content: messageContent });
    ui.notifications.info(`TradeHub capital updated to ${formatGp(newValue)}.`);
    broadcastRefresh();
    SplashPage.refreshSplash();
  }
}

function partyActors({ includeVehicles = false } = {}) {
  return game.actors.contents.filter(actor => actor && actor.name !== "Bank of Holding" && (includeVehicles || actor.type !== "vehicle"));
}

function h4hJournal() {
  return game.journal.getName("H4H");
}

function h4hPage(name, required = true) {
  const journal = h4hJournal();
  const page = journal?.pages?.getName(name);
  if (required && !page) ui.notifications.error(`H4H journal page not found: ${name}`);
  return page || null;
}

function pageText(page) {
  return page?.text?.content || "";
}

function plainLinesFromHtml(html) {
  return String(html || "")
    .split(/<\/p>|<br\s*\/?>|\n/i)
    .map(line => stripHtml(line).trim())
    .filter(Boolean);
}

function wantedCleanName(name) {
  return String(name || "")
    .replace(/\[Wanted\]\s*/gi, "")
    .replace(/^(Captain|First Officer|Gunner|Navigator|Sensors|Quartermaster|Engineering|Pilot|Crew|Medic|Cha|Con|Dex|Int|Tec|Str|Wis)\s*:\s*/i, "")
    .replace(/\((Cha|Con|Dex|Int|Tec|Str|Wis|Gunner|Navigator|Sensors|Quartermaster|Engineering|Captain|First Officer)\)/gi, "")
    .trim();
}

function isWantedName(name) {
  return /\[Wanted\]/i.test(String(name || ""));
}

function bountyKey(name) {
  return wantedCleanName(name)
    .replace(/^(Admiral|Archbishop|Captain|Commander|Commodore|Doctor|Dr\.|Emperor|Empress|General|Governor|King|Lady|Lord|Marshal|President|Prince|Princess|Queen|Sergeant|Sir)\s+/i, "")
    .replace(/\s*,\s*.*$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function vehicleBountyValue(vehicle) {
  const value = parseNumber(vehicle?.system?.traits?.dimensions || 0) + parseNumber(vehicle?.system?.details?.source?.custom || 0);
  return Math.floor(value * 0.035);
}

function actorBountyValue(actor) {
  const value = parseNumber(actor?.system?.details?.source?.custom || 0)
    || parseNumber(actor?.system?.traits?.dimensions || 0)
    || parseNumber(actor?.system?.price?.value ?? actor?.system?.price ?? 0);
  return Math.floor(value * 0.035);
}

function fakeCharterCode() {
  return `Chapter ${Math.floor(Math.random() * 20) + 1}-${Math.floor(Math.random() * 10) + 1}`;
}

async function setActorWanted(actor, add) {
  const cleanName = wantedCleanName(actor.name);
  const nextName = add ? `[Wanted] ${cleanName}` : cleanName;
  if (actor.name !== nextName) await actor.update({ name: nextName });
  const vehicles = partyActors({ includeVehicles: true }).filter(entry => entry.type === "vehicle");
  for (const vehicle of vehicles) {
    const crew = clone(vehicle.system?.cargo?.crew || []);
    let changed = false;
    for (const member of crew) {
      if (!member?.name || !wantedCleanName(member.name).includes(cleanName)) continue;
      const colon = member.name.indexOf(":");
      const prefix = colon >= 0 ? `${member.name.slice(0, colon + 1)} ` : "";
      const memberClean = wantedCleanName(colon >= 0 ? member.name.slice(colon + 1) : member.name);
      member.name = `${prefix}${add ? "[Wanted] " : ""}${memberClean}`.trim();
      changed = true;
    }
    if (changed) await vehicle.update({ "system.cargo.crew": crew });
  }
}

async function clearWantedByKey(key) {
  const cleared = [];
  for (const actor of game.actors.contents.filter(actor => actor.type !== "vehicle" && isWantedName(actor.name) && bountyKey(actor.name) === key)) {
    const oldName = actor.name;
    await actor.update({ name: wantedCleanName(actor.name) });
    cleared.push(oldName);
  }
  for (const vehicle of game.actors.contents.filter(actor => actor.type === "vehicle")) {
    const crew = clone(vehicle.system?.cargo?.crew || []);
    let changed = false;
    for (const member of crew) {
      if (!member?.name || !isWantedName(member.name) || bountyKey(member.name) !== key) continue;
      member.name = member.name.replace(/\[Wanted\]\s*/gi, "");
      changed = true;
      cleared.push(`${vehicle.name}: ${member.name}`);
    }
    if (changed) await vehicle.update({ "system.cargo.crew": crew });
  }
  return cleared;
}

function bountyRows() {
  const byName = new Map();
  const ensureRow = (name, actor = null) => {
    const clean = wantedCleanName(name);
    const key = bountyKey(clean);
    if (!key) return null;
    const existing = byName.get(key) || { key, actor: null, name: clean, bounty: 0, vessels: [], sources: [] };
    if (actor && !existing.actor) {
      existing.actor = actor;
      existing.name = wantedCleanName(actor.name);
      existing.bounty = Math.max(existing.bounty, actorBountyValue(actor));
      existing.sources.push(actor.name);
    }
    byName.set(key, existing);
    return existing;
  };
  for (const actor of game.actors.contents.filter(actor => actor.type !== "vehicle" && actor.name !== "Bank of Holding" && isWantedName(actor.name))) {
    ensureRow(actor.name, actor);
  }
  for (const vehicle of game.actors.contents.filter(actor => actor.type === "vehicle")) {
    const crew = vehicle.system?.cargo?.crew || [];
    for (const member of crew) {
      if (!isWantedName(member?.name)) continue;
      const row = ensureRow(member.name);
      if (!row) continue;
      const crewName = wantedCleanName(member.name);
      if (crewName.length > row.name.length) row.name = crewName;
      const bounty = vehicleBountyValue(vehicle);
      row.bounty += bounty;
      row.vessels.push({ name: vehicle.name, bounty });
      row.sources.push(`${vehicle.name}: ${member.name}`);
    }
  }
  return [...byName.values()].sort((a, b) => b.bounty - a.bounty || a.name.localeCompare(b.name));
}

class MeetNpcPage {
  static show() {
    if (!game.user.isGM) return ui.notifications.error("Only the GM can introduce NPCs.");
    const selected = canvas.tokens?.controlled?.[0]?.actor;
    const actorOptions = actors => actors.map(actor => `<option value="${actor.id}" ${selected?.id === actor.id ? "selected" : ""}>${actor.name}</option>`).join("");
    const actors = game.actors.contents.filter(actor => actor.type !== "vehicle").sort((a, b) => a.name.localeCompare(b.name));
    const first = selected || actors[0];
    const content = `<div class="thm-root thm-compact">
      <div class="thm-center"><img id="thm-meet-npc-img" src="${first?.img || ""}" style="width:150px;height:150px;object-fit:cover;"></div>
      <label>Search Actors:</label><input type="text" id="thm-meet-search" placeholder="Type actor name">
      <label>Select Person:</label><select id="thm-meet-actor">${actorOptions(actors)}</select>
      <label class="thm-checkbox-row"><span>Exclude vehicles</span><input class="thm-check" type="checkbox" id="thm-meet-exclude" checked></label>
      <label class="thm-checkbox-row"><span>Give Limited permission to players</span><input class="thm-check" type="checkbox" id="thm-meet-permission" checked></label>
      <div class="thm-center"><strong>Relationship Rating</strong><div id="thm-meet-stars">${[1, 2, 3, 4, 5].map(i => `<button type="button" class="thm-mini-button thm-star" data-value="${i}">•</button>`).join("")}</div></div>
      <div class="thm-actions"><button id="thm-meet-review">Submit Review</button><button id="thm-meet-open-h4h">Open H4H</button><button id="thm-meet-gain">Gain Fans</button><button id="thm-meet-lose">Lose Fans</button></div>
    </div>`;
    new Dialog({
      title: "Meet NPC",
      content,
      buttons: {
        show: { icon: `<i class="fas fa-eye"></i>`, label: "Show to Players", callback: async html => {
          const actor = game.actors.get(html.find("#thm-meet-actor").val());
          if (!actor) return ui.notifications.error("Actor not found.");
          if (html.find("#thm-meet-permission").prop("checked")) await actor.update({ "ownership.default": CONST.DOCUMENT_OWNERSHIP_LEVELS?.LIMITED ?? CONST.DOCUMENT_PERMISSION_LEVELS.LIMITED });
          if (actor.img) {
            const popout = new ImagePopout(actor.img, { title: actor.name, shareable: true, uuid: actor.uuid });
            popout.render(true);
            popout.shareImage?.();
          }
        } },
        close: { label: "Close" }
      },
      render: html => {
        let selectedStars = 0;
        const starText = n => n <= selectedStars ? "★" : "•";
        const updateStars = () => html.find(".thm-star").each((_i, el) => $(el).text(starText(Number(el.dataset.value))).css("color", Number(el.dataset.value) <= selectedStars ? "goldenrod" : ""));
        const populate = () => {
          const term = String(html.find("#thm-meet-search").val() || "").toLowerCase();
          const exclude = html.find("#thm-meet-exclude").prop("checked");
          const filtered = game.actors.contents
            .filter(actor => (!exclude || actor.type !== "vehicle") && actor.name.toLowerCase().includes(term))
            .sort((a, b) => a.name.localeCompare(b.name));
          html.find("#thm-meet-actor").html(actorOptions(filtered));
          updateImage();
        };
        const updateImage = () => {
          const actor = game.actors.get(html.find("#thm-meet-actor").val());
          html.find("#thm-meet-npc-img").attr("src", actor?.img || "");
          const ratingLine = plainLinesFromHtml(pageText(h4hPage("Ratings", false))).find(line => actor && line.includes(actor.name));
          selectedStars = parseNumber(ratingLine?.match(/Rating\s+(\d)/i)?.[1] || 0);
          updateStars();
        };
        html.find("#thm-meet-search, #thm-meet-exclude").on("input change", populate);
        html.find("#thm-meet-actor").on("change", updateImage);
        html.find(".thm-star").on("click", ev => { selectedStars = Number(ev.currentTarget.dataset.value); updateStars(); });
        html.find("#thm-meet-review").on("click", async () => {
          const actor = game.actors.get(html.find("#thm-meet-actor").val());
          const page = h4hPage("Ratings");
          if (!actor || !page || !selectedStars) return ui.notifications.error("Select a person and a rating.");
          const sentiments = {
            1: "is deeply resentful and harbors animosity toward you.",
            2: "is disappointed and keeps their distance.",
            3: "is content with your actions and finds you agreeable.",
            4: "is happy to see you and enjoys your company.",
            5: "believes you to be heroic and trusts you completely."
          };
          const line = `Rating ${selectedStars}: ${actor.name} ${sentiments[selectedStars]}`;
          const lines = plainLinesFromHtml(pageText(page)).filter(entry => !entry.includes(actor.name));
          await page.update({ "text.content": [...lines, line].map(entry => `<p>${escapeHtml(entry)}</p>`).join("") });
          ui.notifications.info(`${actor.name} will remember that.`);
        });
        html.find("#thm-meet-open-h4h").on("click", () => h4hJournal()?.sheet.render(true));
        html.find("#thm-meet-gain").on("click", async () => {
          const page = h4hPage("Fans");
          if (!page) return;
          const current = parseNumber(stripHtml(pageText(page)));
          const next = Math.floor(current * 1.5 + Math.random() * 5 + 1);
          await page.update({ "text.content": next.toLocaleString() });
          ui.notifications.info(`Group now has ${next.toLocaleString()} loyal followers.`);
        });
        html.find("#thm-meet-lose").on("click", () => {
          const page = h4hPage("Fans");
          if (!page) return;
          const current = parseNumber(stripHtml(pageText(page)));
          new Dialog({
            title: "Lose Fans",
            content: `<div class="thm-root thm-compact"><p>Current fans: ${current.toLocaleString()}</p><input type="number" id="fans-lost" min="1" value="1"></div>`,
            buttons: { ok: { label: "Subtract", callback: async inner => {
              const next = Math.max(0, current - Number(inner.find("#fans-lost").val() || 0));
              await page.update({ "text.content": next.toLocaleString() });
              ui.notifications.info(`Group now has ${next.toLocaleString()} loyal followers.`);
            } }, cancel: { label: "Cancel" } }
          }).render(true);
        });
        updateImage();
      }
    }, { ...dialogOptions(), width: 520 }).render(true);
  }
}

class MeetSystemPage {
  static show() {
    if (!game.user.isGM) return ui.notifications.error("Only the GM can grant system postcards.");
    const folder = game.folders.getName("Visited Systems");
    if (!folder) return ui.notifications.error("Visited Systems folder not found.");
    const journals = folder.contents.filter(doc => doc.documentName === "JournalEntry" || doc.pages).sort((a, b) => a.sort - b.sort);
    const content = `<div class="thm-root thm-compact thm-center">
      <label>Select Journal:</label><select id="journal-select">${journals.map(journal => `<option value="${journal.id}">${journal.name}</option>`).join("")}</select>
      <label>Select Page:</label><select id="page-select"></select>
      <button type="button" id="grant-postcard">Give Postcard</button>
    </div>`;
    new Dialog({
      title: "Meet System",
      content,
      buttons: { close: { label: "Close" } },
      render: html => {
        const populatePages = () => {
          const journal = game.journal.get(html.find("#journal-select").val());
          html.find("#page-select").html(journal?.pages?.contents.sort((a, b) => a.sort - b.sort).map(page => `<option value="${page.id}">${page.name}</option>`).join("") || "");
        };
        html.find("#journal-select").on("change", populatePages);
        html.find("#grant-postcard").on("click", async () => {
          const journal = game.journal.get(html.find("#journal-select").val());
          const page = journal?.pages?.get(html.find("#page-select").val());
          if (!journal || !page) return ui.notifications.error("Please select a journal and page.");
          const observer = CONST.DOCUMENT_OWNERSHIP_LEVELS?.OBSERVER ?? CONST.DOCUMENT_PERMISSION_LEVELS.OBSERVER;
          await journal.update({ "ownership.default": observer });
          await page.update({ "ownership.default": observer });
          ui.notifications.info(`Postcard granted: ${journal.name} / ${page.name}`);
          Journal.show?.(page, { force: true });
        });
        populatePages();
      }
    }, { ...dialogOptions(), width: 500 }).render(true);
  }
}

class HeroesForHirePage {
  static show() {
    const journal = h4hJournal();
    if (!journal) return ui.notifications.error("H4H journal not found.");
    const groupName = stripHtml(pageText(h4hPage("Group Name"))) || "[ Enter Group name to sign up! ]";
    const ratings = plainLinesFromHtml(pageText(h4hPage("Ratings")));
    const nums = ratings.map(line => parseNumber(line.match(/Rating\s+(\d)/i)?.[1])).filter(Boolean);
    const average = nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : 0;
    const terms = plainLinesFromHtml(pageText(h4hPage("HeroTerms", false)));
    const notch = terms[Math.max(0, Math.min(terms.length - 1, Math.floor(nums.length / 10)))] || "Virtual Nobodies";
    const fans = parseNumber(stripHtml(pageText(h4hPage("Fans", false)))).toLocaleString();
    const bounties = bountyRows();
    const banner = setting("heroesForHireImage") || "https://assets.forge-vtt.com/62bf9a2b7fa42ce7966f6738/STARPG/Icons/H4H2.webp";
    const content = `<div class="thm-root thm-compact thm-center">
      <div class="thm-green" style="font-size:2em;font-weight:bold;">${escapeHtml(groupName)}</div>
      <div class="thm-h4h-banner">
        <img src="${escapeHtml(banner)}" alt="Heroes for Hire">
        ${game.user.isGM ? `<button type="button" id="h4h-image-picker" title="Set Heroes for Hire image"><i class="fas fa-folder-open"></i></button>` : ""}
      </div>
      <div style="font-size:1.25em;">${escapeHtml(notch)}</div>
      <div class="thm-green">Capital: ${formatGp(bankBalance())}</div>
      <div>${[1, 2, 3, 4, 5].map(i => `<span style="font-size:24px;color:${i <= average ? "goldenrod" : "black"};">${i <= average ? "★" : "•"}</span>`).join("")}</div>
      <div>${nums.length.toLocaleString()} personal bonds</div>
      <div>${fans} loyal followers</div>
      <div class="thm-h4h-actions"><button id="view-ratings">View Relationships</button><button id="mission-board">Mission Board</button><button id="bounty-board">Bounty Board</button>${bounties.length ? `<button id="clear-bounty">Pay Bounty / Clear Name</button>` : ""}</div>
    </div>`;
    new Dialog({
      title: "Heroes for Hire",
      content,
      buttons: { close: { label: "Close" } },
      render: html => {
        html.find("#h4h-image-picker").on("click", () => {
          new FilePicker({
            type: "image",
            current: setting("heroesForHireImage") || "",
            callback: async path => {
              await setSetting("heroesForHireImage", path);
              ui.notifications.info("Heroes for Hire image updated.");
              html.closest(".app").find(".close").click();
              HeroesForHirePage.show();
            }
          }).render(true);
        });
        html.find("#view-ratings").on("click", () => new Dialog({ title: "Relationships", content: `<div class="thm-root thm-compact">${ratings.map(escapeHtml).join("<br><br>") || "No relationships recorded."}</div>`, buttons: { close: { label: "Close" } } }).render(true));
        html.find("#mission-board").on("click", () => this.showMissionBoard());
        html.find("#bounty-board").on("click", () => this.showBountyBoard());
        html.find("#clear-bounty").on("click", () => this.showPayBounties());
      }
    }, { ...dialogOptions(), width: 560 }).render(true);
  }

  static showMissionBoard() {
    const entries = game.journal.contents
      .filter(entry => entry.name.includes("$") && entry.getFlag?.("forien-quest-log", "json")?.status === "available")
      .sort((a, b) => (b.name.match(/\$/g)?.length || 0) - (a.name.match(/\$/g)?.length || 0));
    const rows = entries.map(entry => {
      const pay = entry.name.match(/\[\s*\$+\s*\]/)?.[0] || "";
      const name = entry.name.replace(pay, "").trim();
      const giver = entry.getFlag?.("forien-quest-log", "json")?.giverData?.name || "Unknown";
      return `<div class="thm-mission-row">
        <div class="thm-mission-copy"><strong>${escapeHtml(name)}</strong><br><span>Contact: ${escapeHtml(giver)}</span></div>
        <div class="thm-mission-value">${escapeHtml(pay || "[ $ ]")}</div>
        <button type="button" data-id="${entry.id}">View</button>
      </div>`;
    }).join("") || `<p>No mission entries found.</p>`;
    const content = `<div class="thm-root thm-compact">
      <h2 class="thm-center">Galactic Mission Board</h2>
      <p>Welcome to the mission board! Where gigs are as unpredictable as a Rogue's hands in the dark.</p>
      <p>If you're browsing here, you're either fearless, foolish, or both. Expect sketchy contracts, questionable payouts, and the kind of trust that comes with a big neon "NO REFUNDS" sign.</p>
      <hr>
      ${rows}
    </div>`;
    new Dialog({ title: "Mission Entries", content, buttons: { close: { label: "Close" } }, render: html => html.find("button[data-id]").on("click", ev => game.journal.get(ev.currentTarget.dataset.id)?.sheet.render(true)) }, { ...dialogOptions(), width: 620 }).render(true);
  }

  static showBountyBoard() {
    const rows = bountyRows();
    const html = rows.map(row => {
      const vessels = row.vessels.length
        ? row.vessels.map(vessel => `<div>Vessel: ${escapeHtml(vessel.name)} (${formatGp(vessel.bounty)})</div>`).join("")
        : `<div class="thm-muted">No vessel bounty source detected.</div>`;
      return `<div class="thm-bounty-row">
        <div class="thm-bounty-title"><span>[Wanted]</span> ${escapeHtml(row.name)}</div>
        <div class="thm-bounty-sources">${vessels}</div>
        <div><strong>Total Bounty:</strong> ${formatGp(row.bounty)}</div>
      </div>`;
    }).join("") || `<div class="thm-bounty-row">No active bounties.</div>`;
    new Dialog({ title: "Bounty Board", content: `<div class="thm-root thm-compact"><div class="thm-bounty-list">${html}</div><p class="thm-bounty-note"><i>Bounties are automatically paid upon destroying the target.</i></p></div>`, buttons: { close: { label: "Close" } } }).render(true);
  }

  static showPayBounties() {
    const rows = bountyRows();
    const total = rows.reduce((sum, row) => sum + row.bounty, 0);
    const options = [`<option value="all">Pay All Bounties</option>`].concat(rows.map(row => `<option value="${escapeHtml(row.key)}">${escapeHtml(row.name)}</option>`)).join("");
    new Dialog({
      title: "Crew Bounties",
      content: `<div class="thm-root thm-compact"><p>Clearing your name withdraws funds from TradeHub Capital.</p><select id="bounty-target">${options}</select><p id="bounty-cost"></p></div>`,
      buttons: { pay: { label: "Pay Bounty", callback: html => requestGm("payBounties", { target: html.find("#bounty-target").val() }) }, close: { label: "Close" } },
      render: html => {
        const update = () => {
          const id = html.find("#bounty-target").val();
          const row = rows.find(entry => entry.key === id);
          const cost = id === "all" ? total : Number(row?.bounty || 0);
          html.find("#bounty-cost").html(`<strong>Cost:</strong> ${formatGp(cost)}<br><strong>TradeHub Capital After:</strong> ${formatGp(bankBalance() - cost)}`);
        };
        html.find("#bounty-target").on("change", update);
        update();
      }
    }, { ...dialogOptions(), width: 460 }).render(true);
  }
}

class FinesPage {
  static show() {
    if (!game.user.isGM) return ui.notifications.error("Only the GM can issue fines.");
    const loc = currentLocation()?.name || "Galactic Law";
    const crimes = [
      { crime: "Mark as [Wanted]", section: fakeCharterCode(), fine: 0 },
      { crime: "Remove [Wanted]", section: "Paid Bounty", fine: 0 },
      { crime: "Cursing", section: `Subsection 12-4 of ${loc}`, fine: 50 },
      { crime: "Theft", section: `Article 6-3 of ${loc}`, fine: 500 },
      { crime: "Murder", section: `Chapter 1-1 of ${loc}`, fine: 10000 },
      { crime: "Assault", section: `Section 3-2 of ${loc}`, fine: 1000 },
      { crime: "Vandalism", section: `Clause 14-7 of ${loc}`, fine: 300 },
      { crime: "Bribery", section: `Provision 8-5 of ${loc}`, fine: 800 },
      { crime: "Public Disturbance", section: `Article 7-9 of ${loc}`, fine: 150 },
      { crime: "Trespassing", section: `Rule 5-11 of ${loc}`, fine: 200 },
      { crime: "Smuggling", section: `Decree 10-6 of ${loc}`, fine: 2000 },
      { crime: "Forgery", section: `Statute 2-8 of ${loc}`, fine: 1200 },
      { crime: "Custom", section: "Custom Entry", fine: 0 }
	    ];
	    const selectedActor = canvas.tokens?.controlled?.[0]?.actor;
	    const actors = partyActors().sort((a, b) => a.name.localeCompare(b.name));
	    const ownerLevel = CONST.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? CONST.DOCUMENT_PERMISSION_LEVELS.OWNER;
	    const playerOwned = actors.filter(actor => game.users.contents.some(user => !user.isGM && Number(actor.ownership?.[user.id] || 0) >= ownerLevel));
	    const playerOwnedIds = new Set(playerOwned.map(actor => actor.id));
	    const others = actors.filter(actor => !playerOwnedIds.has(actor.id));
	    const actorOption = actor => `<option value="${actor.id}" ${selectedActor?.id === actor.id ? "selected" : ""}>${escapeHtml(actor.name)}</option>`;
	    const actorOptions = `${playerOwned.length ? `<optgroup label="Player-Owned Tokens">${playerOwned.map(actorOption).join("")}</optgroup>` : ""}${others.length ? `<optgroup label="Other Tokens">${others.map(actorOption).join("")}</optgroup>` : ""}`;
	    const content = `<div class="thm-root thm-compact thm-fines-form">
	      <label for="fine-search">Search:</label><input type="text" id="fine-search" placeholder="Type token name">
	      <label for="fine-player">Token:</label><select id="fine-player">${actorOptions}</select>
	      <label for="fine-crime">Crime:</label><select id="fine-crime">${crimes.map(c => `<option value="${escapeHtml(c.crime)}">${escapeHtml(c.crime)}</option>`).join("")}</select>
	      <label for="fine-description">Crime Description:</label><input type="text" id="fine-description">
	      <label for="fine-amount">Fine Amount (GP):</label><input type="number" id="fine-amount" min="0">
	    </div>`;
    new Dialog({
      title: "Report Crime",
      content,
      buttons: { report: { icon: `<i class="fas fa-check"></i>`, label: "Report", callback: html => this.report(html, crimes, loc) }, cancel: { label: "Cancel" } },
      default: "report",
	      render: html => {
	        const selectMatchingToken = () => {
	          const term = String(html.find("#fine-search").val() || "").trim().toLowerCase();
	          if (!term) return;
	          const match = actors.find(actor => actor.name.toLowerCase().includes(term));
	          if (match) html.find("#fine-player").val(match.id).trigger("change");
	        };
	        const sync = () => {
	          const actor = game.actors.get(html.find("#fine-player").val());
	          const selected = actor?.name.includes("[Wanted]") ? "Remove [Wanted]" : "Mark as [Wanted]";
          if (["Mark as [Wanted]", "Remove [Wanted]"].includes(html.find("#fine-crime").val())) html.find("#fine-crime").val(selected);
          const crime = crimes.find(c => c.crime === html.find("#fine-crime").val()) || crimes[0];
          html.find("#fine-description").val(crime.crime === "Custom" ? "" : crime.crime).prop("readonly", crime.crime !== "Custom");
	          html.find("#fine-amount").val(crime.fine);
	        };
	        html.find("#fine-search").on("input", selectMatchingToken);
	        html.find("#fine-player, #fine-crime").on("change", sync);
	        sync();
	      }
	    }, { ...dialogOptions(), width: 560 }).render(true);
  }

  static async report(html, crimes, loc) {
    const actor = game.actors.get(html.find("#fine-player").val());
    if (!actor) return ui.notifications.error("Selected player not found.");
    const selected = html.find("#fine-crime").val();
    const amount = Math.max(0, Number(html.find("#fine-amount").val() || 0));
    const crime = selected === "Custom" ? html.find("#fine-description").val() || "Custom Infraction" : selected;
    if (selected === "Mark as [Wanted]") {
      await setActorWanted(actor, true);
      await ChatMessage.create({ content: `<b style="color:red;">${actor.name} has violated the law!</b><br>Subsequent to ${fakeCharterCode()}, you have been issued a <b>[Wanted]</b> status.` });
      return;
    }
    if (selected === "Remove [Wanted]") {
      await setActorWanted(actor, false);
      await ChatMessage.create({ content: `<b>NovaNet Bounty Discharge:</b><br>${actor.name} has cleared their bounty and is no longer wanted.` });
      return;
    }
    const gp = Number(actor.system?.currency?.gp || 0);
    if (gp < amount) {
      await setActorWanted(actor, true);
      await ChatMessage.create({ content: `<b style="color:red;">${actor.name} has violated the law!</b><br>Subsequent to ${fakeCharterCode()} of ${escapeHtml(loc)}, you have been charged with <b>${escapeHtml(crime)}</b> and fined ${formatGp(amount)}.<br><br><b>Due to failure to pay, a warrant has been issued.</b>` });
    } else {
      await actor.update({ "system.currency.gp": gp - amount });
      await ChatMessage.create({ content: `<b style="color:red;">${actor.name} has violated the law!</b><br>Subsequent to ${fakeCharterCode()} of ${escapeHtml(loc)}, you have been charged with <b>${escapeHtml(crime)}</b> and fined ${formatGp(amount)}.<br><br><i>Thank you for your cooperation.</i>` });
    }
  }
}

async function folderPathsForPack(packId) {
  const pack = game.packs.get(packId);
  if (!pack) return [];
  const docs = await pack.getDocuments();
  const paths = new Set();
  for (const doc of docs) {
    if (!doc.folder) continue;
    const names = [];
    let folder = doc.folder;
    while (folder) {
      names.unshift(folder.name);
      folder = folder.folder;
    }
    paths.add(names.join(" / "));
  }
  return [...paths].sort((a, b) => a.localeCompare(b));
}

class GmBar {
  static render() {
    if (!game.user.isGM || document.getElementById("tradehub-gm-bar")) return;
    const pos = setting("gmBarPosition") || { left: 12, top: 120 };
    const bar = document.createElement("div");
    bar.id = "tradehub-gm-bar";
    bar.style.left = `${pos.left}px`;
    bar.style.top = `${pos.top}px`;
	    bar.innerHTML = `<strong>TradeHub</strong>
	      <button title="Dock"><i class="fas fa-crosshairs"></i></button>
	      <button title="Meet NPC"><i class="fas fa-user"></i></button>
	      <button title="Meet System"><i class="fas fa-globe"></i></button>
	      <button title="Market"><i class="fas fa-list"></i></button>
	      <button title="Heroes for Hire"><i class="fas fa-users"></i></button>
	      <button title="Ship Tools"><i class="fas fa-rocket"></i></button>
	      <button title="Combat Damage"><i class="fas fa-bomb"></i></button>
	      <button title="Banking"><i class="fas fa-wallet"></i></button>
	      <button title="Settings"><i class="fas fa-cog"></i></button>
	      <button title="Fines"><i class="fas fa-ticket-alt"></i></button>`;
	    document.body.appendChild(bar);
	    const [dock, meetNpc, meetSystem, market, heroes, tools, damage, bank, config, fines] = bar.querySelectorAll("button");
	    dock.addEventListener("click", () => DockingPage.showDockingPage());
	    meetNpc.addEventListener("click", () => MeetNpcPage.show());
	    meetSystem.addEventListener("click", () => MeetSystemPage.show());
	    market.addEventListener("click", () => SplashPage.showSplash());
	    heroes.addEventListener("click", () => HeroesForHirePage.show());
	    tools.addEventListener("click", () => ShipToolsPage.show());
	    damage.addEventListener("click", () => CombatDamagePage.show());
	    bank.addEventListener("click", () => BankingPage.show());
	    config.addEventListener("click", () => ConfigPage.show());
	    fines.addEventListener("click", () => FinesPage.show());
    let dragging = null;
    bar.addEventListener("mousedown", ev => {
      if (ev.target.tagName === "BUTTON") return;
      dragging = { x: ev.clientX - bar.offsetLeft, y: ev.clientY - bar.offsetTop };
    });
    window.addEventListener("mousemove", ev => {
      if (!dragging) return;
      bar.style.left = `${Math.max(0, ev.clientX - dragging.x)}px`;
      bar.style.top = `${Math.max(0, ev.clientY - dragging.y)}px`;
    });
    window.addEventListener("mouseup", () => {
      if (!dragging) return;
      dragging = null;
      setSetting("gmBarPosition", { left: bar.offsetLeft, top: bar.offsetTop });
    });
  }

  static close() {
    document.getElementById("tradehub-gm-bar")?.remove();
  }
}

class Transactions {
  static async buyGoods({ shipId, location, items }, userId) {
    const ship = game.actors.get(shipId);
    const rows = await marketRows(location);
    const data = getData();
    let total = 0;
    let addedWeight = 0;
    const receipt = [];
    for (const entry of items) {
      const row = rows.find(r => r.name === entry.name);
      if (!row || row.emrg) continue;
      const qty = Math.min(Number(entry.quantity), data.markets[location]?.[row.name]?.stock || 0);
      total += qty * row.price;
      addedWeight += qty * row.weight;
      receipt.push(`${row.name} x ${qty} @ ${row.price.toFixed(2)} GP each.`);
    }
    if (bankBalance() < total) throw new Error("Not enough capital.");
    if (cargoStats(ship).current + addedWeight > cargoStats(ship).max) throw new Error("Insufficient cargo capacity.");
    for (const entry of items) {
      const row = rows.find(r => r.name === entry.name);
      if (!row || row.emrg) continue;
      const qty = Math.min(Number(entry.quantity), data.markets[location][row.name].stock);
      const existing = ship.items.getName(row.name);
      if (existing) await existing.update({ "system.quantity": Number(existing.system.quantity || 0) + qty });
      else {
        const doc = await fromUuid(row.uuid);
        const itemData = duplicateDoc(doc);
        foundry.utils.setProperty(itemData, "system.quantity", qty);
        await ship.createEmbeddedDocuments("Item", [itemData]);
      }
      data.markets[location][row.name].stock = Math.max(0, data.markets[location][row.name].stock - qty);
      data.markets[location][row.name].lastPaid = row.price;
    }
    await updateBank(bankBalance() - total);
    syncShipDirectory(data);
    await setSetting("data", data);
    await chatReceipt("Cargo Purchased by", userId, receipt, `Total Cost of Goods: ${formatGp(total)}`, `TradeHub Capital: ${formatGp(bankBalance())}`, "Funds transferred from TradeHub capital, thank you for shopping with TradeHub(TM)");
    broadcastRefresh();
    SplashPage.refreshSplash();
  }

  static async sellGoods({ shipId, location, items }, userId) {
    const ship = game.actors.get(shipId);
    const rows = await marketRows(location);
    const data = getData();
    let total = 0;
    const receipt = [];
    for (const entry of items) {
      const row = rows.find(r => r.name === entry.name);
      const item = ship.items.getName(entry.name);
      if (!row || !item) continue;
      const qty = Math.min(Number(entry.quantity), Number(item.system.quantity || 0));
      total += qty * row.price;
      receipt.push(`${row.name} x ${qty} @ ${row.price.toFixed(2)} GP each.`);
      const remaining = Number(item.system.quantity || 0) - qty;
      if (remaining <= 0 && row.name.toLowerCase() !== "hydrogen fuel") await item.delete();
      else await item.update({ "system.quantity": Math.max(0, remaining) });
      data.markets[location][row.name].stock = Number(data.markets[location][row.name].stock || 0) + qty;
      data.markets[location][row.name].lastPaid = row.price;
    }
    await updateBank(bankBalance() + total);
    syncShipDirectory(data);
    await setSetting("data", data);
    await chatReceipt("Cargo Sold by", userId, receipt, `Total Gain of Goods: ${formatGp(total)}`, `TradeHub Capital: ${formatGp(bankBalance())}`, "Funds added to TradeHub capital, thank you for trading with TradeHub(TM)");
    broadcastRefresh();
  }

  static async restock({ shipId, items }, userId) {
    const ship = game.actors.get(shipId);
    const stock = await getVehicleConsumables();
    let total = 0;
    const receipt = [];
    for (const entry of items) {
      const row = stock.find(i => i.name === entry.name);
      if (!row) continue;
      total += Number(entry.quantity) * row.price;
      receipt.push(`${row.name} x ${entry.quantity} @ ${row.price} GP each.`);
    }
    if (bankBalance() < total) throw new Error("Not enough capital.");
    for (const entry of items) {
      const row = stock.find(i => i.name === entry.name);
      const existing = ship.items.getName(row.name);
      if (existing) await existing.update({ "system.quantity": Number(existing.system.quantity || 0) + Number(entry.quantity) });
      else {
        const doc = await fromUuid(row.uuid);
        const itemData = duplicateDoc(doc);
        foundry.utils.setProperty(itemData, "system.quantity", Number(entry.quantity));
        await ship.createEmbeddedDocuments("Item", [itemData]);
      }
    }
    await updateBank(bankBalance() - total);
    await chatReceipt("Ammunition Restocked by", userId, receipt, `Total Cost: ${formatGp(total)}`, `TradeHub Capital: ${formatGp(bankBalance())}`, "Ammunition restock complete.");
    const data = getData();
    syncShipDirectory(data);
    await setSetting("data", data);
    broadcastRefresh();
  }

  static async repair({ shipId, itemId, itemIds }, userId) {
    const ship = game.actors.get(shipId);
    const ids = itemIds?.length ? itemIds : [itemId];
	    const repairs = ids.map(id => ship.items.get(id)).filter(Boolean).map(item => {
	      const hp = item.system?.hp;
	      const missing = Math.max(0, Number(hp?.max || 0) - Number(hp?.value || 0));
	      const rawCost = missing * repairUnitCost(item);
	      return { item, hp, missing, rawCost, cost: repairCostForItem(item, missing, ship) };
	    }).filter(entry => entry.hp && entry.missing > 0);
    if (!repairs.length) throw new Error("No damaged equipment was selected for repair.");
    const total = repairs.reduce((sum, entry) => sum + entry.cost, 0);
    if (bankBalance() < total) throw new Error("Not enough capital for those repairs.");
    await updateBank(bankBalance() - total);
    for (const entry of repairs) await entry.item.update({ "system.hp.value": Number(entry.hp.max || entry.hp.value || 0) });
    const actorHp = await syncVehicleHpFromModules(ship);
	    const rows = repairs.map(entry => `${entry.item.name}: ${entry.missing} HP restored (${formatGp(entry.cost)}${isGlaxonInsured(ship) ? `, Glaxon value ${formatGp(entry.rawCost)}` : ""})`).join("<br>");
	    const rawTotal = repairs.reduce((sum, entry) => sum + entry.rawCost, 0);
	    const insuranceLine = isGlaxonInsured(ship) ? `<br><strong>Glaxon Insurance:</strong> Active, savings ${formatGp(rawTotal - total)}` : "";
	    await ChatMessage.create({ content: `<strong>${game.users.get(userId)?.name || "A player"}</strong> repaired <strong>${ship.name}</strong>.<br>${rows}<br><strong>${setting("vehicleLabel")} HP:</strong> ${actorHp}<br><strong>Full Repair Value:</strong> ${formatGp(rawTotal)}<br><strong>Total Repair Cost:</strong> ${formatGp(total)}${insuranceLine}<br><strong>TradeHub Capital:</strong> ${formatGp(bankBalance())}` });
    const data = getData();
    syncShipDirectory(data);
    await setSetting("data", data);
    broadcastRefresh();
  }

  static async dock(payload, userId) {
    const data = getData();
    data.locations[payload.name] = {
      name: payload.name,
      mode: payload.mode,
      sellsIllegal: payload.sellsIllegal,
      hasShipyard: payload.hasShipyard,
      stateOfEmergency: payload.stateOfEmergency,
      uninhabited: payload.uninhabited,
      useIn: !!payload.useIn
    };
    data.currentLocation = payload.name;
    await maintainTradeRumours(data);
    await refreshTickerSelection(data, payload.name, 6);
    syncShipDirectory(data);
    await setSetting("data", data);
    if (!payload.uninhabited) await ensureMarket(payload.name, { regenerate: true, clearLastPaid: payload.clearLastPaid, forceProfit: payload.forceProfit });
    const services = payload.uninhabited ? [`<span style="color: gray;"><b>UNINHABITED: Markets unavailable</b></span>`] : [`+ Markets`];
    if (payload.sellsIllegal) services.push(`<span style="color: purple;"><b>+ BlackMarket</b></span>`);
    if (payload.hasShipyard) services.push(`<span style="color: green;"><b>+ Shipyard</b></span>`);
    if (payload.stateOfEmergency) services.push(`<span style="color: red;"><b>WARNING: STATE OF EMERGENCY DECLARED</b></span>`);
    await ChatMessage.create({ content: `<p style="color:green; font-weight:bold;">SUCCESS: Docked ${locationPhrase(data.locations[payload.name])}</p><p style="font-weight:bold;">TradeHub Markets Updated!</p>${services.join("<br>")}` });
    if (payload.playDockSound) {
      const soundPath = setting("dockSoundPath");
      if (soundPath) AudioHelper.play({ src: soundPath, volume: 0.8, autoplay: true, loop: false }, true);
      else ui.notifications.warn("TradeHub dock sound was requested, but no Dock / Travel sound file is configured.");
    }
    broadcastRefresh(setting("launchOnDock"));
  }

  static async deleteLocation(payload, userId) {
    const name = payload?.name;
    if (!name || name === "create-new") throw new Error("Select an existing location to delete.");
    const data = getData();
    if (!data.locations?.[name]) throw new Error(`${name} is not a saved TradeHub location.`);
    delete data.locations[name];
    delete data.tickerSelections?.[name];
    if (data.currentLocation === name) data.currentLocation = "";
    syncShipDirectory(data);
    await setSetting("data", data);
    await ChatMessage.create({ content: `<p style="color:#9c1f1f; font-weight:bold;">TradeHub location deleted: ${name}</p><p>Party location cleared. Market last-paid data was retained for future recreation.</p>` });
    broadcastRefresh();
  }

  static async applyCombatDamage(payload, userId) {
    const actor = game.actors.get(payload.actorId);
    if (!actor) throw new Error("Selected vehicle not found.");
    const attack = Number(payload.attack || 0);
    const damage = Math.max(0, Number(payload.damage || 0));
    const damageType = payload.damageType || "hull";
    const thermal = damageType === "thermal";
    const modules = damageableModules(actor);
    const details = [];
    const destroyedDetails = [];
    const heatSinkPrompts = [];

    const offerHeatSink = async (amount, reason, extra = "") => {
      if (amount <= 0) return false;
      if (!(thermal || /shield generator|hull reinforcements?|cargo bay|fuel scoop|stealth camouflage/i.test(reason))) return false;
      if (!heatSinkItem(actor)) {
        heatSinkPrompts.push(`<b style="color:red;">WARNING: NO HEAT SINK</b><br><b>${amount} Thermal Damage cannot be collected.</b>`);
        return false;
      }
      heatSinkPrompts.push(heatSinkChoiceCard({ actor, amount, reason, extra, attack, damageType, mode: "carryover" }));
      return true;
    };

    const applyToModule = async (module, amount) => {
      if (!module || amount <= 0 || itemHp(module) <= 0) return amount;
      const before = itemHp(module);
      const dealt = Math.min(before, amount);
      const after = before - dealt;
      await updateModuleHp(module, after);
      const line = after <= 0 ? `<b>${module.name} hit for ${dealt} HP and is destroyed!</b>` : `${module.name} hit for ${dealt} HP`;
      (after <= 0 ? destroyedDetails : details).push(line);
      return amount - dealt;
    };

    const jettisonCargo = async () => {
      const removed = await jettisonCargoFromActor(actor);
      return removed.length ? `<div class="thm-heat-sink-card thm-heat-sink-danger"><b style="color:red;">Cargo Jettisoned!</b><br>${removed.join("<br>")}</div>` : "";
    };

    const applyCarryover = async (amount, source = "") => {
      if (amount <= 0) return;
      if (await offerHeatSink(amount, source)) return;
      let remainingDamage = amount;
      let pool = modules.filter(module => itemHp(module) > 0 && itemAc(module) <= attack && !/shield generator/i.test(module.name));
      if (!pool.length) {
        details.push(`<span class="thm-muted">No vulnerable modules were hit by AC ${attack || "N/A"}.</span>`);
        return;
      }
      const hpRemaining = new Map(pool.map(module => [module.id, itemHp(module)]));
      const allocations = new Map();
      while (remainingDamage > 0 && pool.length) {
        const shuffled = shuffleArray(pool);
        const base = Math.floor(remainingDamage / shuffled.length);
        let remainder = remainingDamage % shuffled.length;
        let overflow = 0;
        for (const module of shuffled) {
          const requested = base + (remainder > 0 ? 1 : 0);
          if (remainder > 0) remainder -= 1;
          if (requested <= 0) continue;
          const available = Number(hpRemaining.get(module.id) || 0);
          const dealt = Math.min(available, requested);
          hpRemaining.set(module.id, available - dealt);
          allocations.set(module.id, (allocations.get(module.id) || 0) + dealt);
          overflow += requested - dealt;
        }
        remainingDamage = overflow;
        pool = pool.filter(module => Number(hpRemaining.get(module.id) || 0) > 0);
      }
      for (const module of modules) {
        const dealt = Number(allocations.get(module.id) || 0);
        if (dealt <= 0) continue;
        const before = itemHp(module);
        const after = Math.max(0, before - dealt);
        await updateModuleHp(module, after);
        const line = after <= 0 ? `<b>${module.name} hit for ${dealt} HP and is destroyed!</b>` : `${module.name} hit for ${dealt} HP`;
        (after <= 0 ? destroyedDetails : details).push(line);
        const destroyed = before > 0 && after <= 0;
        if (destroyed) {
          const name = module.name || "";
          if (/cargo bay/i.test(name)) {
            if (heatSinkItem(actor)) {
              heatSinkPrompts.push(heatSinkChoiceCard({ actor, amount: Math.max(remainingDamage, dealt), reason: name, attack, damageType, mode: "cargo", extra: `<br>Status: Cargo hold failure imminent.` }));
            } else {
              const msg = await jettisonCargo();
              if (msg) details.push(msg);
            }
          } else if (/fuel scoop|stealth camouflage|hull reinforcements?/i.test(name)) {
            if (remainingDamage > 0 && await offerHeatSink(remainingDamage, name)) return;
          }
        }
      }
    };

    let remaining = damage;
    if (payload.context === "fuel") {
      const fuelScoop = actor.items.get(payload.targetModule) || findShipModule(actor, /fuel scoop/i);
      if (!fuelScoop) throw new Error("No Fuel Scoop module found for fuel scooping damage.");
      const carry = await applyToModule(fuelScoop, remaining);
      if (carry > 0) await applyCarryover(carry, fuelScoop.name);
    } else if (payload.context === "mining") {
      const shield = findShipModule(actor, /shield generator|shield/i);
      const hull = firstHealthyHullReinforcement(actor);
      const selected = payload.targetModule && payload.targetModule !== "evenly" ? actor.items.get(payload.targetModule) : null;
      const target = selected || findShipModule(actor, /refinery/i) || (itemHp(shield) > 0 ? shield : null) || hull;
      if (target) {
        const carry = await applyToModule(target, remaining);
        if (carry > 0) await applyCarryover(carry, target.name);
      } else {
        await applyCarryover(remaining, "asteroid debris impact");
      }
    } else {
      const shield = findShipModule(actor, /shield generator|shield/i);
      if (itemHp(shield) > 0) {
        const before = itemHp(shield);
        const dealt = Math.min(before, remaining);
        await updateModuleHp(shield, before - dealt);
        details.push(`${shield.name} hit for ${dealt} HP`);
        remaining -= dealt;
        if (itemHp(shield) <= 0) details.push(`<b>${shield.name} is depleted! Shields are down!</b>`);
        if (remaining > 0) await applyCarryover(remaining, shield.name);
      } else {
        const selected = payload.targetModule && payload.targetModule !== "evenly" ? actor.items.get(payload.targetModule) : null;
        const hull = firstHealthyHullReinforcement(actor);
        if (selected) {
          const carry = await applyToModule(selected, remaining);
          if (carry > 0) await applyCarryover(carry, selected.name);
        } else if (hull) {
          const carry = await applyToModule(hull, remaining);
          if (carry > 0) await applyCarryover(carry, hull.name);
        } else {
          await applyCarryover(remaining, "incoming damage");
        }
      }
    }

    const totalHp = await syncVehicleHpFromModules(actor);
    if (totalHp <= 0) destroyedDetails.push(`<b style="color:red;">${actor.name} explodes into a ball of fiery force!</b>`);
    const label = thermal ? "Thermal" : "Hull";
    const damageLines = details
      .concat(destroyedDetails.length ? ["", ...destroyedDetails] : [])
      .join("<br>");
    await ChatMessage.create({
      content: `<b style="color:red;">${actor.name} suffers ${damage} ${label} Damage!</b><br><b>Attack was AC: ${attack || "N/A"}</b><br>${damageLines}${heatSinkPrompts.length ? `<br><br>${heatSinkPrompts.join("<br>")}` : ""}`,
      speaker: { alias: "TradeHub Combat Damage" }
    });
    const data = getData();
    syncShipDirectory(data);
    await setSetting("data", data);
    broadcastRefresh();
  }

  static async combatRepair(payload, userId) {
    const actor = game.actors.get(payload.actorId);
    if (!actor || actor.type !== "vehicle") throw new Error("Selected vehicle not found.");
    const action = payload.action || "heal";
	    if (action === "pristine") {
	      await makeShipPristine(actor, { chat: true, reason: "Manual GM repair tab refresh", userId });
	    } else if (["service", "full-service", "fullService"].includes(action)) {
	      const result = await fullServiceRepair(actor, { billCapital: payload.billCapital !== false });
	      if (!result.repairs.length) throw new Error(`${actor.name} has no damaged modules to repair.`);
	      const insuranceLine = result.insured
	        ? `<br><b>Glaxon Insurance:</b> Active, 50% repair discount applied. Savings: ${formatGp(result.rawTotal - result.total)}`
	        : `<br><b>With Glaxon Insurance you would have paid:</b> ${formatGp(Math.floor(result.rawTotal * 0.5))}<br><i>Ask us how today!</i>`;
	      await ChatMessage.create({
	        user: userId,
	        content: `<b>Full Service Repair and Replace: ${actor.name}</b><br>${result.rows.join("<br>")}<br><br><b>Full Repair Value:</b> ${formatGp(result.rawTotal)}<br><b>Total Repair Cost:</b> ${formatGp(result.total)}<br><b>TradeHub Capital Billed:</b> ${result.billCapital ? formatGp(result.billed) : "No, repair waived"}<br><b>${setting("vehicleLabel")} HP:</b> ${result.totalHp}<br><b>TradeHub Capital:</b> ${formatGp(bankBalance())}<br><br><b>Repair Rate:</b> ${formatGp(setting("repairCostPerHp"))} / HP, ${formatGp(setting("repairCostPerShieldPoint"))} / Shield HP${insuranceLine}`,
	        speaker: { alias: "TradeHub Ship Repair" }
	      });
    } else {
      const result = await abilityRepair(actor, payload.targetModule, payload.hp);
      if (result.added <= 0) {
        await ChatMessage.create({
          user: userId,
          content: `<b style="color:green;">ERROR: HP FULL</b><br><b>${actor.name} has no repairable module damage for that selection.</b>`,
          speaker: { alias: "TradeHub Ship Repair" }
        });
      } else {
        const totalHp = await syncVehicleHpFromModules(actor);
        await ChatMessage.create({
          user: userId,
          content: `<b style="color:green;">SUCCESS: MODULES REPAIRED!</b><br><b>${actor.name}</b><br><b>Modules Repaired:</b><br>${result.details.join("<br>")}<br><b>Total HP Restored:</b> ${result.added}<br><b>${setting("vehicleLabel")} HP:</b> ${totalHp}`,
          speaker: { alias: "TradeHub Ship Repair" }
        });
      }
    }
    const data = getData();
    syncShipDirectory(data);
    await setSetting("data", data);
    broadcastRefresh();
  }

  static async deployHeatSink(payload, userId) {
    const actor = game.actors.get(payload.actorId);
    if (!actor) throw new Error("Selected vehicle not found.");
    const amount = Math.max(0, Number(payload.amount || 0));
    const reason = payload.reason || "thermal carryover";
    const extra = payload.extra || "";
    const used = await consumeHeatSink(actor);
    if (!used) throw new Error("No Heat Sink is available to deploy.");
    const cargoMode = payload.mode === "cargo";
    await ChatMessage.create({
      content: cargoMode
        ? `<b style="color:green;">Heat Sink Ejected!</b><br><b style="color:green;">Cargo Secured</b>${extra}<br><span class="thm-muted">${actor.name}: ${escapeHtml(reason)}</span>`
        : `<b style="color:green;">Heat Sink Ejected!</b><br><b style="color:green;">${amount} Thermal Damage Avoided</b>${extra}<br><span class="thm-muted">${actor.name}: ${escapeHtml(reason)}</span>`,
      speaker: { alias: "TradeHub Combat Damage" }
    });
    await markHeatSinkChoice(payload.messageId, "Heat Sink Deployed");
    const data = getData();
    syncShipDirectory(data);
    await setSetting("data", data);
    broadcastRefresh();
  }

  static async declineHeatSink(payload, userId) {
    const actor = game.actors.get(payload.actorId);
    if (!actor) throw new Error("Selected vehicle not found.");
    const mode = payload.mode || "carryover";
    const reason = payload.reason || "thermal carryover";
    const amount = Math.max(0, Number(payload.amount || 0));
    const attack = Number(payload.attack || 0);
    const damageType = payload.damageType || "thermal";
    await markHeatSinkChoice(payload.messageId, "Heat Sink Spared");
    if (mode === "cargo") {
      const removed = await jettisonCargoFromActor(actor);
      await ChatMessage.create({
        content: `<div class="thm-heat-sink-card thm-heat-sink-danger"><b style="color:red;">Cargo Jettisoned!</b><br>${removed.length ? removed.join("<br>") : "No cargo was available to jettison."}<br><span class="thm-muted">${actor.name}: ${escapeHtml(reason)}</span></div>`,
        speaker: { alias: "TradeHub Combat Damage" }
      });
    } else {
      const result = await applyQueuedCarryoverDamage(actor, { amount, attack, damageType, source: reason, allowCargoPrompt: true });
      const label = damageType === "thermal" ? "Thermal" : "Hull";
      await ChatMessage.create({
        content: `<b style="color:red;">Heat Sink Spared: ${actor.name} takes ${amount} ${label} carryover.</b><br><b>Attack was AC: ${attack || "N/A"}</b><br>${result.details.join("<br>")}${result.prompts?.length ? `<br><br>${result.prompts.join("<br>")}` : ""}`,
        speaker: { alias: "TradeHub Combat Damage" }
      });
    }
    const data = getData();
    syncShipDirectory(data);
    await setSetting("data", data);
    broadcastRefresh();
  }

  static async shipyardBuy(payload, userId) {
    const source = await fromUuid(payload.sourceUuid);
    const selected = game.actors.get(payload.ownedShipId);
    const partyFolder = game.folders.find(f => f.type === "Actor" && f.name.toLowerCase() === "party");
    const newData = duplicateDoc(source);
    newData.folder = partyFolder?.id || null;
    newData.ownership = { default: CONST.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? CONST.DOCUMENT_PERMISSION_LEVELS.OWNER };
    const price = parseNumber(newData.system?.traits?.dimensions || newData.system?.details?.source?.custom || 0);
    let trade = 0;
    if (selected && payload.tradeShip) trade += Math.floor(parseNumber(selected.system?.traits?.dimensions || 0) * 0.75);
    if (selected && payload.tradeModules) trade += Math.floor(parseNumber(selected.system?.details?.source?.custom || 0) * 0.75);
    const total = price - trade;
    if (total > bankBalance()) throw new Error("Not enough capital.");
    await updateBank(bankBalance() - total);
    const newShip = await Actor.create(newData);
    if (selected && (payload.transferModules || payload.tradeModules)) await transferShipItems(selected, newShip, payload.tradeModules);
    if (selected && payload.tradeShip) await selected.delete();
    await ChatMessage.create({ content: `<strong>${game.users.get(userId)?.name || "A player"}</strong> purchased <strong>${newShip.name}</strong>.<br><strong>TradeHub Capital:</strong> ${formatGp(bankBalance())}` });
    const data = getData();
    syncShipDirectory(data);
    await setSetting("data", data);
    broadcastRefresh();
  }

  static async shipyardSell({ shipId }, userId) {
    const ship = game.actors.get(shipId);
    const value = Math.floor(parseNumber(ship.system?.traits?.dimensions || 0) * 0.75) + Math.floor(parseNumber(ship.system?.details?.source?.custom || 0) * 0.75);
    await updateBank(bankBalance() + value);
    await ship.delete();
    await ChatMessage.create({ content: `<strong>${game.users.get(userId)?.name || "A player"}</strong> sold <strong>${ship.name}</strong> for ${formatGp(value)}.<br><strong>TradeHub Capital:</strong> ${formatGp(bankBalance())}` });
    const data = getData();
    syncShipDirectory(data);
    await setSetting("data", data);
    broadcastRefresh();
  }

	  static async shipLongRest({ shipId }, userId) {
	    const ship = game.actors.get(shipId);
	    if (!ship) throw new Error("Selected ship not found.");
	    const value = shipValue(ship);
	    const cost = upkeepCost(ship);
	    const insured = isGlaxonInsured(ship);
	    const premium = insured ? glaxonPremium(ship) : 0;
	    const totalCost = cost + premium;
	    const currentCapital = bankBalance();
	    const remaining = Math.max(0, currentCapital - totalCost);
	    const unpaid = Math.max(0, totalCost - currentCapital);
	    await updateBank(remaining);
    for (const item of ship.items) {
      const uses = item.system?.uses;
      if (uses?.max) await item.update({ "system.uses.value": uses.max });
      if (isEquippedShipModule(item) && /shield generator/i.test(item.name)) {
        await item.update({ "system.hp.value": Number(item.system?.hp?.max || item.system?.hp?.value || 0) });
      }
    }
    const modules = damageableModules(ship).filter(item => !/shield generator/i.test(item.name));
    const totalModuleHp = modules.reduce((total, item) => total + Number(item.system?.hp?.value || 0), 0);
    await ship.update({ "system.attributes.hp.min": totalModuleHp });
    if (unpaid > 0) {
      await ChatMessage.create({
	      content: `Long rest costs of ${formatGp(unpaid)} were not fully paid. During the next adventuring day, equipment or insurance service may fail unexpectedly at the GM's discretion.`,
	      whisper: ChatMessage.getWhisperRecipients("GM")
	    });
    }
    await ChatMessage.create({
      content: `<strong style="color:green;">SHIP MAINTENANCE</strong><br>
        Each long rest, the ship handles air filtration, water purification, waste management, sanitation, upkeep, laundry, and diagnostics.<br><br>
	        <strong>Ship Name:</strong> ${ship.name}<br>
	        <strong>Ship Value:</strong> ${formatGp(value)}<br>
	        <strong>Upkeep Cost:</strong> ${formatGp(cost)}<br>
	        ${insured ? `<strong>Glaxon Premium:</strong> ${formatGp(premium)}<br><strong>Total Long Rest Cost:</strong> ${formatGp(totalCost)}<br>` : ""}
	        <strong>TradeHub Capital:</strong> ${formatGp(bankBalance())}<br>
	        <em>Shields and item uses restored. Vessel HP minimum now reflects equipment condition.</em>`
	    });
    const data = getData();
    syncShipDirectory(data);
    await setSetting("data", data);
    broadcastRefresh();
  }

	  static async shipRegister({ shipId, name, cost }, userId) {
    const ship = game.actors.get(shipId);
    if (!ship) throw new Error("Selected ship not found.");
    const price = Number(cost || 0);
    if (bankBalance() < price) throw new Error("Not enough TradeHub capital.");
    const oldName = ship.name;
    await updateBank(bankBalance() - price);
    await ship.update({ name });
    await ChatMessage.create({
      content: `<strong>${game.users.get(userId)?.name || "A player"}</strong> updated the registration for <strong>${oldName}</strong>.<br>New designation: <strong>${name}</strong><br><strong>Cost:</strong> ${formatGp(price)}<br><strong>TradeHub Capital:</strong> ${formatGp(bankBalance())}`
    });
    const data = getData();
    syncShipDirectory(data);
    await setSetting("data", data);
	    broadcastRefresh();
	  }

	  static async shipInsurance({ shipId, insured }, userId) {
	    const ship = game.actors.get(shipId);
	    if (!ship) throw new Error("Selected ship not found.");
	    const active = insured !== false;
	    if (active) await ship.setFlag(MODULE_ID, "glaxonInsured", true);
	    else await ship.unsetFlag(MODULE_ID, "glaxonInsured");
	    await ChatMessage.create({
	      user: userId,
	      content: active
	        ? `<strong>Glaxon Insurance Activated</strong><br><strong>${ship.name}</strong> now receives 50% off repair costs while insured.<br><strong>Premium per Long Rest:</strong> ${formatGp(glaxonPremium(ship))}<br><strong>Full Repair Value:</strong> ${formatGp(fullRepairValue(ship))}<br><em>Premiums are billed when the Long Rest button is used.</em>`
	        : `<strong>Glaxon Insurance Cancelled</strong><br><strong>${ship.name}</strong> no longer receives the Glaxon repair discount and will not be billed a Glaxon premium on Long Rest.`,
	      speaker: { alias: "Glaxon Insurance" }
	    });
	    const data = getData();
	    syncShipDirectory(data);
	    await setSetting("data", data);
	    broadcastRefresh();
	  }

	  static async payBounties({ target }, userId) {
	    const rows = bountyRows();
	    const total = rows.reduce((sum, row) => sum + row.bounty, 0);
	    const selected = rows.find(row => row.key === target);
	    const cost = target === "all" ? total : Number(selected?.bounty || 0);
	    if (cost > bankBalance()) throw new Error("Not enough TradeHub capital to clear that bounty.");
	    await updateBank(bankBalance() - cost);
	    if (target === "all") {
	      for (const row of rows) await clearWantedByKey(row.key);
	    } else {
	      if (!selected) throw new Error("Selected wanted bounty not found.");
	      await clearWantedByKey(selected.key);
	    }
	    await ChatMessage.create({
	      user: userId,
	      content: `<strong>NovaNet Bounty Discharge</strong><br>${target === "all" ? "All bounty tags cleared." : "Selected bounty cleared."}<br><strong>Cost:</strong> ${formatGp(cost)}<br><strong>TradeHub Capital:</strong> ${formatGp(bankBalance())}`
	    });
	    const data = getData();
	    syncShipDirectory(data);
	    await setSetting("data", data);
	    broadcastRefresh();
	  }

	  static async shipJettison({ shipId, items }, userId) {
    const ship = game.actors.get(shipId);
    if (!ship) throw new Error("Selected ship not found.");
    const jettisoned = [];
    for (const entry of items || []) {
      const item = ship.items.get(entry.itemId);
      if (!item) continue;
      const quantity = Math.max(0, Math.min(Number(entry.quantity || 0), Number(item.system?.quantity || 0)));
      if (!quantity) continue;
      const remaining = Number(item.system.quantity || 0) - quantity;
      const value = Number(item.system?.price?.value || 0) * quantity;
      if (remaining <= 0) await item.delete();
      else await item.update({ "system.quantity": remaining });
      jettisoned.push(`${item.name} x${quantity} (valued at ${formatGp(value)})`);
    }
    if (jettisoned.length) {
      await ChatMessage.create({
        user: userId,
        content: `<strong>${game.users.get(userId)?.name || "A player"} has updated ${ship.name} loadout:</strong><br><br><strong>Cargo Jettisoned:</strong><br>${jettisoned.join("<br>")}`
      });
    }
    const data = getData();
    syncShipDirectory(data);
    await setSetting("data", data);
    broadcastRefresh();
  }

  static async shipFuelPurge({ shipId, quantity }, userId) {
    const ship = game.actors.get(shipId);
    if (!ship) throw new Error("Selected ship not found.");
    const item = ship.items.find(i => i.name.toLowerCase() === "hydrogen fuel" && ["loot", "consumable"].includes(i.type));
    if (!item) throw new Error("Hydrogen Fuel item not found.");
    const amount = Math.max(0, Number(quantity || 0));
    const remaining = Math.max(0, Number(item.system?.quantity || 0) - amount);
    await item.update({ "system.quantity": remaining });
    await ChatMessage.create({
      user: userId,
      content: `<strong>${ship.name}</strong><br>${amount} tonnes of Hydrogen purged.${remaining <= 0 ? `<br><span style="color:red;font-weight:bold;">WARNING: OUT OF FUEL</span>` : ""}`
    });
    const data = getData();
    syncShipDirectory(data);
    await setSetting("data", data);
    broadcastRefresh();
  }

  static async shipFuelScoop({ shipId, quantity }, userId) {
    const ship = game.actors.get(shipId);
    if (!ship) throw new Error("Selected ship not found.");
    const amount = Math.floor(Math.max(0, Number(quantity || 0)));
    if (!amount) throw new Error("Enter the Hydrogen Fuel amount scooped.");
    const hydrogen = (await getTradeGoods()).find(item => item.name.toLowerCase() === "hydrogen fuel");
    if (!hydrogen) throw new Error("Hydrogen Fuel was not found in the configured Trade Goods compendium and folder.");
    const addedWeight = amount * Number(hydrogen.weight || 0);
    const stats = cargoStats(ship);
    if (stats.current + addedWeight > stats.max) throw new Error("Insufficient cargo capacity for the scooped Hydrogen Fuel.");
    const existing = ship.items.find(item => item.name.toLowerCase() === "hydrogen fuel" && ["loot", "consumable"].includes(item.type));
    if (existing) await existing.update({ "system.quantity": Number(existing.system?.quantity || 0) + amount });
    else {
      const source = await fromUuid(hydrogen.uuid);
      const itemData = duplicateDoc(source);
      foundry.utils.setProperty(itemData, "system.quantity", amount);
      await ship.createEmbeddedDocuments("Item", [itemData]);
    }
    await ChatMessage.create({
      user: userId,
      content: `<strong>Fuel Scooping Complete</strong><br><strong>${ship.name}</strong> gained Hydrogen Fuel x${amount}.<br><span class="thm-muted">Constitution save results are not applied by TradeHub.</span>`
    });
    const data = getData();
    syncShipDirectory(data);
    await setSetting("data", data);
    broadcastRefresh();
  }
}

async function transferShipItems(oldShip, newShip, sellModules) {
  for (const item of oldShip.items) {
    if (!["loot", "equipment", "weapon", "consumable"].includes(item.type)) continue;
    if (sellModules && ["equipment", "weapon"].includes(item.type)) {
      await item.delete();
      continue;
    }
    await newShip.createEmbeddedDocuments("Item", [duplicateDoc(item)]);
  }
  await newShip.update({
    "system.cargo.crew": clone(oldShip.system?.cargo?.crew || []),
    "system.cargo.passengers": clone(oldShip.system?.cargo?.passengers || [])
  });
}

async function chatReceipt(title, userId, lines, total, balance, footer) {
  if (!lines.length) return;
  await ChatMessage.create({
    content: `<strong>${title}:</strong><br>${game.users.get(userId)?.name || "A player"}<br><br><strong>Receipt:</strong><br>${lines.join("<br>")}<br><br><strong>${total}</strong><br>(Rounded Down)<br><br><strong>${balance}</strong><br><em>${footer}</em>`
  });
}
