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
  tickerSelections: {},
  marketDiscounts: {}
};

const REST_CONSUMABLE_MESSAGES = [
  "{actor} consumes {item} during a {restType}. The snack economy survives another day.",
  "{actor} enjoys {item} and enters a {restType}. Science says this helps. Probably.",
  "{actor} takes a {restType}, deploys {item}, and achieves peak tiny comfort.",
  "{actor} eats {item}. The {restType} immediately becomes 37% more legitimate.",
  "{actor} savors {item} during the {restType}. Somewhere, a nutritionist gives up.",
  "{actor} consumes {item}, rests, and briefly stops being a liability.",
  "{actor} takes a {restType} with {item}. This is either medicine or dessert. Hard to tell.",
  "{actor} enjoys {item}. The {restType} gains emotional structural integrity.",
  "{actor} eats {item} with grim heroic focus during the {restType}.",
  "{actor} cracks into {item} and lets the {restType} hit like a warm blanket.",
  "{actor} consumes {item}. Morale restored. Dignity pending.",
  "{actor} spends the {restType} enjoying {item}. No one asks what it is made of.",
  "{actor} eats {item} and begins the {restType}. The vibes stabilize.",
  "{actor} enjoys {item} so intensely the {restType} files a report.",
  "{actor} consumes {item}. The body recovers. The soul negotiates.",
  "{actor} rests with {item}. It is not elegant, but it works.",
  "{actor} devours {item} during the {restType}. The silence afterward is respectful.",
  "{actor} enjoys {item}. For a moment, even the ship sounds less cursed.",
  "{actor} takes a {restType}, eats {item}, and becomes marginally less doomed.",
  "{actor} consumes {item}. The {restType} is now officially underway."
];

let selectedShipId = null;
let selectedShipName = "";
const openWindows = new Set();
const pendingGmRequests = new Map();

const clone = value => foundry.utils.deepClone(value);
const duplicateDoc = doc => doc.toObject ? doc.toObject() : clone(doc);
const setting = key => game.settings.get(MODULE_ID, key);
const setSetting = (key, value) => game.settings.set(MODULE_ID, key, value);
const formatGp = value => `${Number(Math.floor(value || 0)).toLocaleString()} GP`;
const stripHtml = html => String(html || "").replace(/<[^>]*>/g, "").trim();
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const sleep = ms => new Promise(resolve => window.setTimeout(resolve, ms));
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
  game.tradehub.ShipOutfittingPage = ShipOutfittingPage;
  game.tradehub.ShipToolsPage = ShipToolsPage;
  game.tradehub.CombatDamagePage = CharacterStatusPage;
  game.tradehub.CharacterStatusPage = CharacterStatusPage;
  game.tradehub.MeetNpcPage = MeetNpcPage;
  game.tradehub.MeetSystemPage = MeetSystemPage;
  game.tradehub.HeroesForHirePage = HeroesForHirePage;
  game.tradehub.FinesPage = FinesPage;
  game.tradehub.DockingPage = DockingPage;
  game.tradehub.BankingPage = BankingPage;
  game.tradehub.ConfigPage = ConfigPage;
  game.tradehub.refresh = refreshOpenWindows;
  game.tradehub.getCapital = bankBalance;
  game.tradehub.capital = bankBalance;
  game.tradehub.setCapital = updateBank;
  game.tradehub.updateBank = updateBank;
  game.tradehub.getShipUpkeepPercent = shipUpkeepPercent;
  game.tradehub.calculateShipUpkeep = calculateShipUpkeep;
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
  installForienShowSoundHook();
  installRestConsumableHook();
});

function installForienShowSoundHook() {
  if (!game.user.isGM || window.__tradeHubForienShowSoundHook) return;
  window.__tradeHubForienShowSoundHook = true;
  let lastPlayed = 0;
  document.addEventListener("click", event => {
    const control = event.target?.closest?.("a, button");
    if (!control || !setting("forienShowSoundEnabled")) return;
    const text = `${control.title || ""} ${control.getAttribute("aria-label") || ""} ${control.textContent || ""}`;
    if (!/show\s*to\s*players/i.test(text)) return;
    const app = control.closest(".app");
    const title = app?.querySelector(".window-title")?.textContent || app?.textContent || "";
    const isQuestWindow = /quest\s*details|quest/i.test(title) || /forien/i.test(app?.className || "");
    if (!isQuestWindow) return;
    const path = setting("forienShowSoundPath");
    if (!path) return;
    const now = Date.now();
    if (now - lastPlayed < 1200) return;
    lastPlayed = now;
    const volume = Math.max(0, Math.min(1, Number(setting("forienShowSoundVolume") ?? 0.8)));
    AudioHelper.play({ src: path, volume, autoplay: true, loop: false }, true);
  }, true);
}

function installRestConsumableHook() {
  if (window.__tradeHubRestConsumableHook) return;
  const proto = CONFIG.Actor?.documentClass?.prototype || Actor.prototype;
  if (!proto) return;
  window.__tradeHubRestConsumableHook = true;
  for (const method of ["shortRest", "longRest", "rest"]) {
    if (typeof proto[method] !== "function") continue;
    const original = proto[method];
    proto[method] = async function tradeHubRestConsumableWrapper(...args) {
      const actor = this;
      const restLabel = restLabelForMethod(method, args);
      if (restLabel && !actor.__tradeHubRestConsumablePrompting && await requiresRestConsumable(actor)) {
        actor.__tradeHubRestConsumablePrompting = true;
        let consumed = false;
        try {
          consumed = await promptRestConsumable(actor, restLabel);
        } finally {
          actor.__tradeHubRestConsumablePrompting = false;
        }
        if (!consumed) return false;
      }
      return original.apply(this, args);
    };
  }
}

function restLabelForMethod(method, args = []) {
  if (method === "shortRest") return "Short Rest";
  if (method === "longRest") return "Long Rest";
  const first = args[0] || {};
  const type = String(first.type || first.restType || first.rest || "").toLowerCase();
  if (type.includes("short")) return "Short Rest";
  if (type.includes("long")) return "Long Rest";
  if (first.shortRest === true || first.isShortRest === true) return "Short Rest";
  if (first.longRest === true || first.isLongRest === true) return "Long Rest";
  const serialized = args.map(arg => typeof arg === "string" ? arg : JSON.stringify(arg || {})).join(" ").toLowerCase();
  if (serialized.includes("short")) return "Short Rest";
  if (serialized.includes("long")) return "Long Rest";
  return null;
}

async function requiresRestConsumable(actor) {
  if (!setting("requireConsumableForPlayerRest")) return false;
  if (game.user.isGM) return false;
  if (!actor || actor.type !== "character") return false;
  if ((setting("restConsumableExcludedUsers") || []).includes(actor.id)) return false;
  if (!actor.isOwner) return false;
  return true;
}

function restConsumables(actor) {
  return actor.items
    .filter(item => item.type === "consumable" && isRestConsumableType(item) && Number(item.system?.quantity ?? 0) > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function isRestConsumableType(item) {
  const type = String(item.system?.type?.value || item.system?.type || item.system?.consumableType || "").toLowerCase();
  return ["food", "potion", "poison"].includes(type);
}

async function promptRestConsumable(actor, restLabel) {
  const consumables = restConsumables(actor);
  if (!consumables.length) {
    ui.notifications.warn(`${actor.name} needs food, a potion, or a poison before taking a ${restLabel}.`);
    return false;
  }
  const options = consumables
    .map(item => `<option value="${item.id}">${escapeHtml(item.name)} (${Number(item.system?.quantity ?? 0)})</option>`)
    .join("");
  const content = `<div class="thm-root thm-compact">
    <p><strong>${escapeHtml(actor.name)}</strong> must consume something before taking a ${escapeHtml(restLabel)}.</p>
    <label for="thm-rest-consumable">Which consumable are you going to eat?</label>
    <select id="thm-rest-consumable" style="width:100%; margin-top: 6px;">${options}</select>
  </div>`;
  const itemId = await new Promise(resolve => {
    new Dialog({
      title: `TradeHub ${restLabel} Supplies`,
      content,
      buttons: {
        consume: {
          icon: "<i class='fas fa-utensils'></i>",
          label: "Consume and Rest",
          callback: html => resolve(html.find("#thm-rest-consumable").val())
        },
        cancel: {
          icon: "<i class='fas fa-times'></i>",
          label: "Cancel",
          callback: () => resolve(null)
        }
      },
      default: "consume",
      close: () => resolve(null)
    }).render(true);
  });
  if (!itemId) return false;
  const item = actor.items.get(itemId);
  const quantity = Number(item?.system?.quantity ?? 0);
  if (!item || quantity <= 0) {
    ui.notifications.warn("That consumable is no longer available.");
    return false;
  }
  await useRestConsumableItem(item, quantity);
  await createRestConsumableMessage(actor, item, restLabel.toLowerCase());
  ui.notifications.info(`${actor.name} consumed ${item.name} for a ${restLabel}.`);
  return true;
}

async function useRestConsumableItem(item, quantityBefore = Number(item.system?.quantity ?? 0)) {
  try {
    if (typeof item.use === "function") {
      await item.use({ configureDialog: false }, { createMessage: true });
    } else if (typeof item.roll === "function") {
      await item.roll();
    }
  } catch (err) {
    console.warn(`${MODULE_ID} | Failed to use rest consumable item card for ${item.name}`, err);
  }
  const fresh = item.actor?.items?.get(item.id) || item;
  const quantityAfterUse = Number(fresh.system?.quantity ?? 0);
  if (quantityAfterUse >= quantityBefore) {
    await fresh.update({ "system.quantity": Math.max(0, quantityBefore - 1) });
  }
}

async function createRestConsumableMessage(actor, item, restType) {
  const template = REST_CONSUMABLE_MESSAGES[Math.floor(Math.random() * REST_CONSUMABLE_MESSAGES.length)];
  const text = template
    .replaceAll("{actor}", escapeHtml(actor.name))
    .replaceAll("{item}", escapeHtml(item.name))
    .replaceAll("{restType}", escapeHtml(restType));
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="thm-chat-card"><strong>TradeHub Rest Supplies</strong><br>${text}</div>`
  });
}

Hooks.on("renderSceneControls", () => {
  if (game.user.isGM && setting("showGmBar")) GmBar.render();
});

Hooks.on("renderActorSheet", injectVehicleSheetTools);
Hooks.on("renderTidy5eActorSheet", injectVehicleSheetTools);
Hooks.on("renderTidy5eSheet", injectVehicleSheetTools);

Hooks.on("updateToken", async (tokenDoc, changes) => {
  if (!game.user.isGM || !foundry.utils.hasProperty(changes, "x") && !foundry.utils.hasProperty(changes, "y")) return;
  const actor = tokenDoc?.actor;
  if (!actor || actor.type === "vehicle") return;
  const poison = actor.getFlag(MODULE_ID, "poisonedMovement");
  if (!poison?.active || Number(poison.damage || 0) <= 0) return;
  await handlePoisonMovement(actor, tokenDoc, poison);
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
  register("shipyardModulesPack", {
    name: "Shipyard Modules Compendium",
    hint: "Item compendium containing equipment and weapon modules sold through Ship Outfitting.",
    scope: "world",
    config: false,
    type: String,
    default: ""
  });
  register("shipyardModulesFolderPath", {
    name: "Shipyard Modules Folder",
    hint: "Optional folder or subfolder inside the shipyard module compendium. The selected folder and its descendants are shown.",
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
  register("forienShowSoundEnabled", {
    name: "Forien Show to Players Sound",
    hint: "Play a configured sound for all players when a Forien quest is shown to players.",
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });
  register("forienShowSoundPath", {
    name: "Forien Show to Players Sound File",
    hint: "Audio file or URL played when the Forien quest log Show to Players control is clicked.",
    scope: "world",
    config: false,
    type: String,
    default: ""
  });
  register("forienShowSoundVolume", {
    name: "Forien Show to Players Sound Volume",
    hint: "Volume for the Forien Show to Players sound, from 0 to 1.",
    scope: "world",
    config: false,
    type: Number,
    default: 0.8
  });
  register("poisonMovementSoundPath", {
    name: "Poison Movement Sound File",
    hint: "Optional audio file or URL played for all players when TradeHub poison movement damage triggers.",
    scope: "world",
    config: false,
    type: String,
    default: ""
  });
  register("poisonMovementSoundVolume", {
    name: "Poison Movement Sound Volume",
    hint: "Volume for the TradeHub poison movement damage sound, from 0 to 1.",
    scope: "world",
    config: false,
    type: Number,
    default: 0.8
  });
  register("warezMarketHackEnabled", {
    name: "Warez Hacking Markets Active",
    hint: "When Warez [Illegal] is sold, TradeHub asks for a TEC check and can temporarily crash buy prices at that market.",
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });
  register("warezTecDc", {
    name: "Warez TEC DC",
    hint: "Base DC for Warez market hacking. Discount tiers apply at this DC, then DC+1, DC+2, DC+3, and DC+4 or better.",
    scope: "world",
    config: false,
    type: Number,
    default: 16
  });
  register("warezDiscountTier0", { name: "Warez Discount at DC", scope: "world", config: false, type: Number, default: 25 });
  register("warezDiscountTier1", { name: "Warez Discount at DC+1", scope: "world", config: false, type: Number, default: 50 });
  register("warezDiscountTier2", { name: "Warez Discount at DC+2", scope: "world", config: false, type: Number, default: 75 });
  register("warezDiscountTier3", { name: "Warez Discount at DC+3", scope: "world", config: false, type: Number, default: 90 });
  register("warezDiscountTier4", { name: "Warez Discount at DC+4 or Better", scope: "world", config: false, type: Number, default: 100 });
  register("illegalCargoStealthChecksEnabled", {
    name: "Require Stealth Checks to Sell Illegal Cargo",
    hint: "All [Illegal] cargo, including Warez, requires a Stealth check when sold. Failed checks sell the goods, forfeit illegal proceeds, and take a 35% smuggling fine from TradeHub capital.",
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });
  register("illegalCargoStealthDc", {
    name: "Illegal Cargo Stealth DC",
    hint: "DC for selling [Illegal] cargo without being caught.",
    scope: "world",
    config: false,
    type: Number,
    default: 14
  });
  register("warezHackSoundPath", {
    name: "Warez Market Hack Sound File",
    hint: "Audio file or URL played locally when the Warez market hack effect triggers.",
    scope: "world",
    config: false,
    type: String,
    default: ""
  });
  register("warezHackSoundVolume", {
    name: "Warez Market Hack Sound Volume",
    hint: "Volume for the Warez market hack sound, from 0 to 1.",
    scope: "world",
    config: false,
    type: Number,
    default: 0.8
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
  register("shipUpkeepPercent", {
    name: "Ship Long Rest Upkeep Percentage",
    hint: "Percentage of total ship cost charged as upkeep for each vehicle long rest. Enter 0.2 for 0.2%.",
    scope: "world",
    config: false,
    type: Number,
    default: 0.2
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
  register("showVehicleSheetTools", {
    name: "Show TradeHub Markets and Cargo on Vehicle Sheets",
    hint: "Adds TradeHub capital, the current location's market, and cargo access to dnd5e and Tidy5e vehicle sheets.",
    scope: "world",
    config: false,
    type: Boolean,
    default: true
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
  register("requireConsumableForPlayerRest", {
    name: "Players Must Consume a Consumable to Rest",
    hint: "When enabled, player-owned character actors must consume one food, potion, or poison consumable before taking a short or long rest. Vehicles are ignored.",
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });
  register("restConsumableExcludedUsers", {
    name: "Rest Consumable Excluded Characters",
    hint: "Character actor ids that are exempt from TradeHub rest supply prompts.",
    scope: "world",
    config: false,
    type: Object,
    default: []
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
    if (loc.supplyRestock == null) loc.supplyRestock = true;
    loc.useIn = !!loc.useIn;
  }
  data.marketDiscounts ||= {};
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
  return docs.filter(doc => !isHiddenStoreDocument(doc) && ["loot", "consumable", "equipment"].includes(doc.type)).map(itemFromDocument);
}

async function getVehicleConsumables() {
  const docs = await getPackDocs(setting("vehicleConsumablesPack"), setting("vehicleConsumablesFolderPath"));
  return docs.filter(doc => !isHiddenStoreDocument(doc) && ["loot", "consumable", "equipment", "weapon"].includes(doc.type)).map(itemFromDocument);
}

async function getAmmoRestockItems() {
  const pack = setting("ammoRestockPack") || setting("vehicleConsumablesPack");
  const folder = setting("ammoRestockFolderPath") || setting("vehicleConsumablesFolderPath");
  const docs = await getPackDocs(pack, folder);
  return docs.filter(doc => !isHiddenStoreDocument(doc) && ["loot", "consumable", "equipment", "weapon"].includes(doc.type)).map(itemFromDocument);
}

async function getShipyardVehicles() {
  const docs = await getPackDocs(setting("shipyardPack"), setting("shipyardFolderPath"));
  return docs.filter(doc => !isHiddenStoreDocument(doc) && doc.type === "vehicle");
}

function isHiddenStoreDocument(doc) {
  return /\[\s*hidden\s*\]/i.test(doc?.name || "");
}

function documentFolderPath(doc) {
  const names = [];
  let folder = doc.folder;
  while (folder) {
    names.unshift(folder.name);
    folder = folder.folder;
  }
  return names.join(" / ");
}

function pathIncludesFolder(path, selected) {
  const actual = String(path || "").trim().toLowerCase();
  const root = String(selected || "").trim().toLowerCase();
  return !root || actual === root || actual.startsWith(`${root} / `);
}

async function getShipyardModules() {
  const packId = setting("shipyardModulesPack");
  if (!packId) return [];
  const docs = await getPackDocs(packId);
  const folderPath = setting("shipyardModulesFolderPath");
  return docs
    .filter(doc => !isHiddenStoreDocument(doc) && ["equipment", "weapon"].includes(doc.type))
    .filter(doc => pathIncludesFolder(documentFolderPath(doc), folderPath))
    .map(doc => ({ ...itemFromDocument(doc), folderPath: documentFolderPath(doc) || "Unfiled" }))
    .sort((a, b) => a.folderPath.localeCompare(b.folderPath) || compareShipyardModuleNames(a, b) || a.price - b.price);
}

function shipyardModuleNameParts(module) {
  const name = String(module?.name || "");
  const match = name.match(/^(.*?)\s*\[(Prismatic|S|A|B|C|D|E)\]\s*$/i);
  if (!match) return { base: name, tier: "", rank: 99 };
  const tier = match[2].toUpperCase();
  const ranks = { PRISMATIC: 0, S: 1, A: 2, B: 3, C: 4, D: 5, E: 6 };
  return { base: match[1].trim(), tier, rank: ranks[tier] };
}

function compareShipyardModuleNames(a, b) {
  const left = shipyardModuleNameParts(a);
  const right = shipyardModuleNameParts(b);
  return left.base.localeCompare(right.base) || left.rank - right.rank || String(a.name).localeCompare(String(b.name));
}

function shipyardWeaponDetails(row) {
  if (row.type !== "weapon") return "";
  const system = row.system || {};
  const range = system.range || {};
  const units = range.units ? ` ${range.units}` : "";
  const shortRange = range.value ?? range.normal ?? "-";
  const longRange = range.long ?? "-";
  const shortText = shortRange === "-" ? "-" : `${shortRange}${units}`;
  const longText = longRange === "-" ? "-" : `${longRange}${units}`;
  const damageParts = Array.isArray(system.damage?.parts) ? system.damage.parts : [];
  const damage = damageParts.map(part => {
    if (Array.isArray(part)) return `${part[0] || "-"}${part[1] ? ` ${part[1]}` : ""}`;
    return `${part?.formula || part?.value || "-"}${part?.type ? ` ${part.type}` : ""}`;
  }).filter(Boolean).join(", ") || system.damage?.formula || system.damage?.base?.formula || "-";
  return `<small class="thm-outfit-weapon-details"><b>Damage:</b> ${escapeHtml(damage)} <span>|</span> <b>Short:</b> ${escapeHtml(shortText)} <span>|</span> <b>Long:</b> ${escapeHtml(longText)}</small>`;
}

function shipyardOutfitRow(row) {
  return `<div class="thm-outfit-row" data-uuid="${row.uuid}" data-price="${row.price}" data-module-type="${row.type}">
    <input class="thm-outfit-purchase" type="checkbox" aria-label="Purchase ${escapeHtml(row.name)}">
    <button type="button" class="thm-outfit-item" data-open-item="${row.uuid}">
      <img src="${row.img}"><span class="thm-outfit-item-copy"><span class="thm-outfit-item-name">${escapeHtml(row.name)}</span>${shipyardWeaponDetails(row)}</span>
    </button>
    <span class="thm-outfit-price">${formatGp(row.price)}</span>
  </div>`;
}

function shipyardOutfitRows(rows) {
  const families = new Map();
  for (const row of rows) {
    const parts = shipyardModuleNameParts(row);
    const key = parts.tier ? parts.base.toLowerCase() : `uuid:${row.uuid}`;
    if (!families.has(key)) families.set(key, { base: parts.base, rows: [] });
    families.get(key).rows.push(row);
  }
  return [...families.values()].map(family => {
    family.rows.sort(compareShipyardModuleNames);
    if (family.rows.length === 1) return shipyardOutfitRow(family.rows[0]);
    return `<details class="thm-outfit-family">
      <summary>${escapeHtml(family.base)} <span>${family.rows.length} classes</span></summary>
      ${family.rows.map(shipyardOutfitRow).join("")}
    </details>`;
  }).join("");
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
  return data.locations[name] || { name: name || "No Location", mode: "", sellsIllegal: false, hasShipyard: false, supplyRestock: true, stateOfEmergency: false, uninhabited: true, useIn: false };
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
    restock: docked && !emergency && !uninhabited && loc.supplyRestock !== false,
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

async function marketRows(locationName, { buyDiscount = false } = {}) {
  const goods = await getTradeGoods();
  const market = await ensureMarket(locationName);
  const loc = getData().locations[locationName] || {};
  const discount = buyDiscount ? activeMarketDiscount(locationName) : null;
  return goods
    .filter(good => loc.sellsIllegal || loc.stateOfEmergency || !isIllegalGood(good.name))
    .map(good => {
      const state = market[good.name] || { stock: 0, direction: "None", percent: 0, lastPaid: 0 };
      const pct = Number(state.percent || 0) / 100;
      const priceInc = good.price * (1 + pct);
      const priceDec = good.price * Math.max(0, 1 - pct);
      const basePrice = state.direction === "Higher" ? priceInc : state.direction === "Lower" ? priceDec : good.price;
      const price = discount ? Math.max(0, basePrice * (1 - discount.percent / 100)) : basePrice;
      return { ...good, stock: state.stock || 0, direction: state.direction, percent: state.percent || 0, lastPaid: state.lastPaid || 0, price, priceInc, priceDec, emrg: !!loc.stateOfEmergency && !isIllegalGood(good.name), marketDiscount: discount?.percent || 0 };
    })
    .sort((a, b) => changeSort(a) - changeSort(b) || a.name.localeCompare(b.name));
}

function isIllegalGood(name) {
  return /\[illegal\]|illegal/i.test(name);
}

function isWarezGood(name) {
  return /\bwarez\b/i.test(String(name || ""));
}

function activeMarketDiscount(locationName) {
  const data = getData();
  const discount = data.marketDiscounts?.[locationName];
  if (!discount) return null;
  if (Number(discount.expiresAt || 0) <= Date.now()) return null;
  return { percent: Math.max(0, Math.min(100, Number(discount.percent || 0))), expiresAt: Number(discount.expiresAt || 0), userId: discount.userId || "" };
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Number(value || 0)));
}

function warezTecDc() {
  return Math.max(1, Math.floor(Number(setting("warezTecDc") || 16)));
}

function illegalCargoStealthDc() {
  return Math.max(1, Math.floor(Number(setting("illegalCargoStealthDc") || 14)));
}

function warezDiscountTiers() {
  return [
    clampPercent(setting("warezDiscountTier0") ?? 25),
    clampPercent(setting("warezDiscountTier1") ?? 50),
    clampPercent(setting("warezDiscountTier2") ?? 75),
    clampPercent(setting("warezDiscountTier3") ?? 90),
    clampPercent(setting("warezDiscountTier4") ?? 100)
  ];
}

function warezDiscountForRoll(total, dc = warezTecDc()) {
  const roll = Math.floor(Number(total || 0));
  const tier = roll - Number(dc || 16);
  if (tier < 0) return 0;
  const tiers = warezDiscountTiers();
  return tiers[Math.min(tiers.length - 1, tier)] || 0;
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

function shipUpkeepPercent() {
  return Math.max(0, Number(setting("shipUpkeepPercent") ?? 0.2));
}

function calculateShipUpkeep(totalShipCost) {
  return Math.floor(Math.max(0, Number(totalShipCost || 0)) * shipUpkeepPercent() / 100);
}

async function updateBank(gp) {
  const data = getData();
  data.capital = Math.max(0, Number(gp || 0));
  syncShipDirectory(data);
  await setSetting("data", data);
  refreshVehicleSheetCapital();
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
  refreshVehicleSheetCapital();
  SplashPage.refreshSplash();
}

function broadcastRefresh(openSplash = false) {
  game.socket.emit(SOCKET, { type: "refresh", openSplash });
  refreshOpenWindows();
}

function requestGm(action, payload, { awaitResponse = false } = {}) {
  if (game.user.isGM) return processGmRequest({ action, payload, userId: game.user.id }, { rethrow: awaitResponse });
  if (awaitResponse) {
    const requestId = foundry.utils.randomID();
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        pendingGmRequests.delete(requestId);
        reject(new Error("The GM did not complete the TradeHub request in time."));
      }, 30000);
      pendingGmRequests.set(requestId, {
        resolve: value => {
          window.clearTimeout(timeout);
          resolve(value);
        },
        reject: error => {
          window.clearTimeout(timeout);
          reject(error);
        }
      });
      game.socket.emit(SOCKET, { type: "request", action, payload, userId: game.user.id, requestId });
    });
  }
  game.socket.emit(SOCKET, { type: "request", action, payload, userId: game.user.id });
  ui.notifications.info("TradeHub request sent to the GM client.");
  return true;
}

async function handleSocket(message) {
  if (message.type === "request" && game.user.isGM) {
    if (!message.requestId) return processGmRequest(message);
    try {
      await processGmRequest(message, { rethrow: true });
      game.socket.emit(SOCKET, { type: "response", requestId: message.requestId, userId: message.userId, success: true });
    } catch (error) {
      game.socket.emit(SOCKET, { type: "response", requestId: message.requestId, userId: message.userId, success: false, error: error.message || "TradeHub transaction failed." });
    }
    return;
  }
  if (message.type === "response" && message.userId === game.user.id) {
    const pending = pendingGmRequests.get(message.requestId);
    if (!pending) return;
    pendingGmRequests.delete(message.requestId);
    if (message.success) pending.resolve(true);
    else pending.reject(new Error(message.error || "TradeHub transaction failed."));
    return;
  }
  if (message.type === "refresh") {
    refreshOpenWindows();
    if (message.openSplash) SplashPage.showSplash();
  }
  if (message.type === "warezGlitch") playWarezHackEffects();
}

async function processGmRequest(message, { rethrow = false } = {}) {
  try {
    if (message.action === "buyGoods") return Transactions.buyGoods(message.payload, message.userId);
    if (message.action === "sellGoods") return Transactions.sellGoods(message.payload, message.userId);
    if (message.action === "restock") return Transactions.restock(message.payload, message.userId);
    if (message.action === "repair") return Transactions.repair(message.payload, message.userId);
    if (message.action === "dock") return Transactions.dock(message.payload, message.userId);
    if (message.action === "deleteLocation") return Transactions.deleteLocation(message.payload, message.userId);
    if (message.action === "shipyardBuy") return Transactions.shipyardBuy(message.payload, message.userId);
    if (message.action === "shipyardSell") return Transactions.shipyardSell(message.payload, message.userId);
    if (message.action === "outfitShip") return Transactions.outfitShip(message.payload, message.userId);
    if (message.action === "payBounties") return Transactions.payBounties(message.payload, message.userId);
    if (message.action === "shipJettison") return Transactions.shipJettison(message.payload, message.userId);
    if (message.action === "saveData") return saveData(message.payload.data);
  } catch (err) {
    console.error(err);
    ui.notifications.error(err.message || "TradeHub transaction failed.");
    if (rethrow) throw err;
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
      <button class="thm-full-button" id="thm-restock" ${state.restock ? "" : "disabled"}>${state.loc.stateOfEmergency ? "Supply Restock - Emergency Only" : (state.loc.supplyRestock === false ? "No Supply Restock" : "Supply Restock")}</button>
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
        html.find("#thm-shipyard").on("click", () => ShipyardServicesPage.show());
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

function playerSkillActor() {
  const assigned = game.user.character;
  if (assigned?.type !== "vehicle") return assigned;
  const controlled = canvas.tokens?.controlled?.find(token => token.actor && token.actor.type !== "vehicle")?.actor;
  return controlled || game.actors.contents.find(actor => actor.type !== "vehicle" && actor.testUserPermission?.(game.user, "OWNER"));
}

function actorNameForUser(userId, fallback = "A player") {
  const user = game.users.get(userId);
  const actor = user?.character;
  return actor?.type !== "vehicle" ? actor?.name || user?.name || fallback : user?.name || fallback;
}

function marketCheckActorFromChecks(checks = {}, userId = game.user.id) {
  return game.actors.get(checks.actorId) || game.users.get(userId)?.character || null;
}

async function marketCheckResultCard({ title, actor, total, dc, location = "", successText, failureText }) {
  const pass = Number(total || 0) >= Number(dc || 0);
  await ChatMessage.create({
    speaker: actor ? ChatMessage.getSpeaker({ actor }) : undefined,
    content: `<div class="thm-chat-card"><strong>${escapeHtml(title)}</strong><br>${escapeHtml(actor?.name || game.user.name || "Acting Character")} rolled <strong>${Number(total || 0)}</strong> against DC ${Number(dc || 0)}${location ? ` at ${escapeHtml(location)}` : ""}.<br><strong class="${pass ? "thm-green" : "thm-red"}">${pass ? successText : failureText}</strong></div>`
  });
  return pass;
}

function normalizeMarketRollLabel(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function dnd5eConfigLabels(kind) {
  const labels = game.dnd5e?.config?.[kind] || globalThis.CONFIG?.DND5E?.[kind] || {};
  return Object.fromEntries(Object.entries(labels).map(([key, value]) => [
    key,
    game.i18n?.localize?.(typeof value === "string" ? value : value?.label || value?.name || key) || key
  ]));
}

function customAbilitiesSkillsSettings() {
  try {
    return game.settings.get("dnd5e-custom-skills", "settings") || {};
  } catch {
    return {};
  }
}

function customListLabels(list = {}) {
  return Object.fromEntries(
    Object.entries(list)
      .filter(([, value]) => value?.applied !== false)
      .map(([key, value]) => [key, value?.label])
      .filter(([, value]) => value)
  );
}

function customRollLabels(kind) {
  const settings = customAbilitiesSkillsSettings();
  const custom = kind === "abilities" ? settings.customAbilitiesList : settings.customSkillList;
  return {
    ...dnd5eConfigLabels(kind),
    ...customListLabels(custom)
  };
}

function actorRollEntries(actor, kind) {
  const collection = kind === "abilities" ? actor?.system?.abilities : actor?.system?.skills;
  if (!collection || typeof collection !== "object") return [];
  const labels = customRollLabels(kind);
  return Object.entries(collection).map(([key, value]) => ({
    kind,
    key,
    value,
    label: String(value?.label || labels[key] || key)
  }));
}

function resolveMarketRollTarget(actor, candidates = [], kinds = ["skill"]) {
  if (!actor) return null;
  const wanted = new Set(candidates.map(normalizeMarketRollLabel).filter(Boolean));
  const entries = [];
  for (const kind of kinds) {
    if (kind === "skill") entries.push(...actorRollEntries(actor, "skills"));
    if (kind === "ability") entries.push(...actorRollEntries(actor, "abilities"));
  }
  return entries.find(entry => wanted.has(normalizeMarketRollLabel(entry.key)) || wanted.has(normalizeMarketRollLabel(entry.label))) || null;
}

function extractRollTotal(result) {
  if (result == null) return null;
  if (typeof result === "number") return result;
  if (Array.isArray(result)) return extractRollTotal(result[0]);
  if (typeof result.total === "number") return result.total;
  if (typeof result.roll?.total === "number") return result.roll.total;
  if (Array.isArray(result.rolls)) return extractRollTotal(result.rolls[0]);
  return null;
}

function numericRollValue(...values) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function customSkillConfig(key) {
  return customAbilitiesSkillsSettings()?.customSkillList?.[key] || {};
}

function marketTargetModifier(actor, target) {
  const value = target?.value || {};
  const direct = numericRollValue(value.total, value.mod, value.modifier, value.bonus);
  if (direct != null) return direct;
  const abilityKey = value.ability || value.defaultAbility || customSkillConfig(target.key)?.ability || customSkillConfig(target.key)?.defaultAbility;
  const ability = abilityKey ? actor?.system?.abilities?.[abilityKey] : null;
  const abilityMod = numericRollValue(ability?.mod, ability?.total);
  if (abilityMod != null) return abilityMod;
  return 0;
}

async function fallbackMarketSkillRoll(actor, target, label, dc, err) {
  console.warn(`${MODULE_ID} | Falling back to TradeHub ${label} roll after actor roll failed.`, err);
  const mod = marketTargetModifier(actor, target);
  const formula = `1d20 ${mod < 0 ? "-" : "+"} ${Math.abs(mod)}`;
  const roll = new Roll(formula);
  await roll.evaluate({ async: true });
  const total = Number(roll.total || 0);
  await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    type: CONST.CHAT_MESSAGE_TYPES.ROLL,
    rolls: [roll],
    content: `<div class="thm-chat-card"><strong>${escapeHtml(label)} Check</strong><br>${escapeHtml(actor.name)} rolls ${escapeHtml(formula)}.</div>`
  });
  return total;
}

function waitForActorRollTotal(actor, timeoutMs = 60000) {
  let onCreate;
  let timer;
  const promise = new Promise(resolve => {
    let done = false;
    const finish = total => {
      if (done) return;
      done = true;
      Hooks.off("createChatMessage", onCreate);
      window.clearTimeout(timer);
      resolve(total);
    };
    onCreate = message => {
      const speaker = message?.speaker || {};
      if (speaker.actor && speaker.actor !== actor.id) return;
      const total = extractRollTotal(message);
      if (total != null) finish(total);
    };
    timer = window.setTimeout(() => finish(null), timeoutMs);
    Hooks.on("createChatMessage", onCreate);
  });
  return {
    promise,
    cancel: () => {
      Hooks.off("createChatMessage", onCreate);
      window.clearTimeout(timer);
    }
  };
}

function marketSkillPromptHtml({ actor, label, dc, reason, manual = false, target = null }) {
  const rollLabel = target?.label ? `${target.label} ${target.kind === "ability" ? "ability" : "skill"}` : label;
  return `<div class="thm-root thm-compact">
    <div class="thm-skill-check-actor">
      ${actor?.img ? `<img src="${actor.img}" alt="">` : ""}
      <div>
        <strong>${escapeHtml(actor?.name || game.user.name || "Acting Character")}</strong>
        <p>${escapeHtml(reason || `${label} check required.`)}</p>
      </div>
    </div>
    ${manual ? `<label>${escapeHtml(label)} Total (DC ${dc})<input type="number" id="thm-skill-total" value="0"></label>` : `<p class="notes">Click Roll to make a DC ${dc} ${escapeHtml(rollLabel)} check using this character.</p>`}
  </div>`;
}

async function requestMarketSkillCheck({ label, dc, skillIds, abilityIds = [], reason, kinds = ["skill"] }) {
  const actor = playerSkillActor();
  const target = resolveMarketRollTarget(actor, [...(skillIds || []), ...(abilityIds || []), label], kinds);
  if (!actor) {
    ui.notifications.error(`No assigned character found for the ${label} check.`);
    return null;
  }
  if (!target || (target.kind === "skill" && !actor.rollSkill) || (target.kind === "ability" && !actor.rollAbilityTest)) {
    ui.notifications.error(`${actor.name} does not have a ${label} skill or ability available for TradeHub to roll.`);
    return null;
  }
  const confirmed = await new Promise(resolve => {
    new Dialog({
      title: `${label} Check`,
      content: marketSkillPromptHtml({ actor, label, dc, reason, target }),
      buttons: {
        roll: { label: `Roll ${label}`, callback: () => resolve(true) },
        cancel: { label: "Cancel", callback: () => resolve(false) }
      },
      default: "roll",
      close: () => resolve(false)
    }, { ...dialogOptions(["market-skill-check"]), width: 460 }).render(true);
  });
  if (!confirmed) return null;
  const chatRoll = waitForActorRollTotal(actor);
  let result;
  try {
    result = target.kind === "ability"
      ? await actor.rollAbilityTest(target.key, { fastForward: false, chatMessage: true })
      : await actor.rollSkill(target.key, { fastForward: false, chatMessage: true });
  } catch (err) {
    chatRoll.cancel();
    return fallbackMarketSkillRoll(actor, target, label, dc, err);
  }
  const total = extractRollTotal(result);
  if (total != null) {
    chatRoll.cancel();
    return total;
  }
  const chatTotal = await chatRoll.promise;
  if (chatTotal != null) return chatTotal;
  ui.notifications.error(`TradeHub could not read the ${label} roll total.`);
  return null;
}

function playWarezHackEffects() {
  const path = setting("warezHackSoundPath");
  if (path) AudioHelper.play({ src: path, volume: Math.max(0, Math.min(1, Number(setting("warezHackSoundVolume") ?? 0.8))), autoplay: true, loop: false }, false);
  const overlay = document.createElement("div");
  overlay.className = "thm-warez-glitch";
  overlay.innerHTML = `<div></div><div></div><div></div>`;
  document.body.appendChild(overlay);
  setTimeout(() => overlay.remove(), 1900);
}

function broadcastWarezHackEffects() {
  playWarezHackEffects();
  game.socket.emit(SOCKET, { type: "warezGlitch" });
}

async function prepareSellChecks(items) {
  const selected = items.map(item => item.name);
  const hasWarez = selected.some(isWarezGood);
  const hasIllegal = selected.some(isIllegalGood);
  const checks = {};
  const actor = playerSkillActor();
  checks.actorId = actor?.id || "";
  checks.actorName = actor?.name || game.user.character?.name || game.user.name || "A player";
  checks.location = currentLocation().name;
  if (hasIllegal && setting("illegalCargoStealthChecksEnabled")) {
    const dc = illegalCargoStealthDc();
    const total = await requestMarketSkillCheck({
      label: "Stealth",
      dc,
      skillIds: ["ste", "stealth"],
      reason: "To sell this illegal content, this character must make a Stealth check."
    });
    if (total == null) return null;
    checks.illegalStealthTotal = total;
    checks.illegalStealthDc = dc;
    await marketCheckResultCard({
      title: "Illegal Cargo Stealth Check",
      actor,
      total,
      dc,
      location: checks.location,
      successText: "PASS: Illegal cargo sold quietly.",
      failureText: "FAIL: Smuggling detected."
    });
  }
  if (hasWarez && setting("warezMarketHackEnabled")) {
    broadcastWarezHackEffects();
    await sleep(1900);
    const dc = warezTecDc();
    const total = await requestMarketSkillCheck({
      label: "TEC",
      dc,
      abilityIds: ["tec", "technology", "tech"],
      skillIds: ["tec", "technology", "tech"],
      kinds: ["ability", "skill"],
      reason: "To hack the market with Warez [Illegal], this character must make a TEC check."
    });
    if (total == null) return null;
    checks.warezTecTotal = total;
    checks.warezTecDc = dc;
    const discount = warezDiscountForRoll(total, dc);
    await marketCheckResultCard({
      title: "Warez Market Hack",
      actor,
      total,
      dc,
      location: checks.location,
      successText: `PASS: Market prices destabilized by ${discount}%.`,
      failureText: "FAIL: No market discount applied."
    });
  }
  return checks;
}

class MarketDialog {
  static rowInputName(row) { return row.name.replace(/[^a-zA-Z0-9-_]/g, ""); }

  static async render(type) {
    const state = serviceState();
    if (type === "buy" && !state.markets) return ui.notifications.error("Markets are not available at this location.");
    if (type === "sell" && !state.sell) return ui.notifications.error("Selling cargo is not available at this location.");
    const ship = selectedShip();
    if (!ship) return ui.notifications.error(`No ${setting("vehicleLabel").toLowerCase()} selected.`);
    const rows = await marketRows(state.loc.name, { buyDiscount: type === "buy" });
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
      const hacked = !sellMode && Number(row.marketDiscount || 0) > 0;
      const priceDisplay = !sellMode && row.emrg
        ? "EMRG"
        : hacked
          ? `<span class="thm-hacked-price">${row.price.toFixed(2)}<br>[HACKED - ${Number(row.marketDiscount || 0)}% OFF]</span>`
          : row.price.toFixed(2);
      return `<tr data-key="${key}" data-name="${row.name}" data-price="${row.price}" data-weight="${row.weight}" data-max="${max}">
        <td><div class="thm-item-cell"><img src="${row.img}" data-uuid="${row.uuid}"><span class="thm-item-name" data-uuid="${row.uuid}">${row.name}</span></div></td>
        <td class="thm-center ${hacked ? "thm-hacked-cell" : ""}">${priceDisplay}</td>
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
      let anyQty = false;
      let cargo = stats.current;
      html.find("tbody tr[data-key]").each((_i, tr) => {
      const row = $(tr);
        const qty = Math.max(0, Math.min(Number(row.find(".thm-qty").val() || 0), Number(row.data("max"))));
        row.find(".thm-qty").val(qty);
        const active = qty > 0;
        anyQty ||= active;
        row.find(".thm-check").prop("disabled", !active).prop("checked", active);
        total += qty * Number(row.data("price"));
        cargo += (sellMode ? -1 : 1) * qty * Number(row.data("weight"));
      });
      const remainingBank = sellMode ? bankBalance() + total : bankBalance() - total;
      html.find("#thm-total").text(`${sellMode ? "Cart" : "Purchase"} Total: ${formatGp(total)}`);
      html.find("#thm-bank").text(`Capital: ${formatGp(remainingBank)}`).toggleClass("thm-red", remainingBank < 0);
      html.find("#thm-cargo").html(cargoBar({ ...stats, current: cargo, remaining: stats.max - cargo, pct: stats.max ? Math.min(cargo / stats.max * 100, 100) : 0 }));
      html.find("#thm-final").prop("disabled", !anyQty || remainingBank < 0 || (!sellMode && cargo > stats.max));
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
    html.find("#thm-final").on("click", async () => {
      const items = [];
      html.find("tbody tr[data-key]").each((_i, tr) => {
        const row = $(tr);
        const quantity = Number(row.find(".thm-qty").val() || 0);
        if (quantity > 0) items.push({ name: row.data("name"), quantity });
      });
      const checks = sellMode ? await prepareSellChecks(items) : {};
      if (checks === null) return;
      requestGm(sellMode ? "sellGoods" : "buyGoods", { shipId: ship.id, location: currentLocation().name, items, checks });
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
    const modules = repairableModules(ship).sort((a, b) => hpPct(a) - hpPct(b));
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
        <label><span>Supply Restock Available</span><input type="checkbox" id="supply-restock"></label>
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
          html.find("#supply-restock").prop("checked", loc.supplyRestock !== false);
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
      supplyRestock: html.find("#supply-restock").prop("checked"),
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
  html.find("#illegal, #shipyard, #supply-restock, #profit").prop("disabled", uninhabited);
  if (uninhabited) html.find("#illegal, #shipyard, #supply-restock, #profit").prop("checked", false);
}

function toggleDeleteLocationMode(html) {
  const deleting = html.find("#delete-location").prop("checked");
  html.closest(".app").find('button[data-button="dock"]').html(deleting ? "<b>Delete Location</b>" : "<b>Dock / Travel</b>");
  html.find("#market-state, #illegal, #shipyard, #supply-restock, #clear, #profit, #play-sound, #use-in").prop("disabled", deleting);
  if (!deleting) toggleMarketControls(html);
}

class ShipyardServicesPage {
  static show() {
    const state = serviceState();
    if (!state.shipyard) return ui.notifications.error("The shipyard is not available at this location.");
    const dialog = new Dialog({
      title: `${state.loc.name} Shipyard Services`,
      content: `<div class="thm-root thm-shipyard-services">
        <button id="thm-open-outfitting"><i class="fas fa-tools"></i><span><b>Ship Outfitting</b><small>Purchase modules for your selected craft.</small></span></button>
        <button id="thm-open-shipyard"><i class="fas fa-rocket"></i><span><b>Shipyard</b><small>Browse, purchase, or trade craft.</small></span></button>
      </div>`,
      buttons: { close: { label: "Close" } },
      render: html => {
        html.find("#thm-open-outfitting").on("click", async () => {
          await dialog.close();
          ShipOutfittingPage.show();
        });
        html.find("#thm-open-shipyard").on("click", async () => {
          await dialog.close();
          ShipyardPage.showShipyardPage();
        });
      }
    }, { ...dialogOptions(), width: 520 });
    dialog.render(true);
  }
}

class ShipOutfittingPage {
  static async show() {
    const state = serviceState();
    if (!state.shipyard) return ui.notifications.error("Ship Outfitting is not available at this location.");
    const modules = await getShipyardModules();
    const ships = accessibleShips();
    if (!setting("shipyardModulesPack")) return ui.notifications.error("Configure a Shipyard Modules Compendium in TradeHub settings.");
    if (!modules.length) return ui.notifications.error("No equipment or weapon modules were found in the configured Shipyard Modules source.");
    if (!ships.length) return ui.notifications.error("No owned vehicle actors are available for outfitting.");
    if (!selectedShipId || !ships.some(ship => ship.id === selectedShipId)) selectedShipId = ships[0].id;
    const groups = new Map();
    for (const module of modules) {
      if (!groups.has(module.folderPath)) groups.set(module.folderPath, []);
      groups.get(module.folderPath).push(module);
    }
    const shipOptions = ships.map(ship => `<option value="${ship.id}" ${ship.id === selectedShipId ? "selected" : ""}>${escapeHtml(ship.name)}</option>`).join("");
    const sections = [...groups.entries()].map(([folder, rows]) => `<details class="thm-outfit-group">
      <summary>${escapeHtml(folder)} <span>${rows.length} module${rows.length === 1 ? "" : "s"}</span></summary>
      <div class="thm-outfit-header"><span>Qty</span><span aria-hidden="true"></span><span>Price</span></div>
      ${shipyardOutfitRows(rows)}
    </details>`).join("");
    const content = `<div class="thm-root thm-outfitting">
      <div class="thm-outfit-summary">
        <label><b>Outfit Craft</b><select id="thm-outfit-ship">${shipOptions}</select></label>
        <div><b>TradeHub Capital:</b> <span id="thm-outfit-capital">${formatGp(bankBalance())}</span></div>
      </div>
      <details class="thm-outfit-trade">
        <summary><b>Trade In Installed Modules</b> <span id="thm-outfit-trade-summary">0 GP credit</span></summary>
        <p>Select only the installed modules to sell. TradeHub credits 75% of each module's listed value.</p>
        <div class="thm-cargo-bay-warning" id="thm-outfit-cargo-warning" hidden><i class="fas fa-exclamation-triangle"></i> Warning: Selling a Cargo Bay will discard all cargo. This cannot be undone.</div>
        <div id="thm-outfit-trade-items"></div>
      </details>
      <div class="thm-outfit-catalog">${sections}</div>
      <div class="thm-outfit-footer">
        <div><b>Purchase Total:</b> <span id="thm-outfit-total">0 GP</span></div>
        <div><b>Trade-In Credit:</b> <span id="thm-outfit-credit">0 GP</span></div>
        <div><b>Net Transaction:</b> <span id="thm-outfit-net">0 GP</span></div>
        <div><b>Balance After:</b> <span id="thm-outfit-after">${formatGp(bankBalance())}</span></div>
        <button id="thm-outfit-buy" disabled><i class="fas fa-exchange-alt"></i> Complete Outfitting</button>
      </div>
    </div>`;
    const dialog = new Dialog({
      title: `${state.loc.name} Ship Outfitting`,
      content,
      buttons: { close: { label: "Close" } },
      render: html => {
        const selectedTradeIds = () => html.find(".thm-outfit-trade-item:checked").toArray().map(input => input.value);
        const tradeCredit = () => shipyardModuleTradeValue(game.actors.get(html.find("#thm-outfit-ship").val()), selectedTradeIds());
        const renderTradeIns = () => {
          const ship = game.actors.get(html.find("#thm-outfit-ship").val());
          const items = shipyardEquipmentItems(ship);
          html.find("#thm-outfit-trade-items").html(items.length ? items.map(item => {
            const value = shipyardEquipmentValue(item);
            const credit = Math.floor(value * 0.75);
            return `<label class="thm-outfit-trade-row">
              <input type="checkbox" class="thm-outfit-trade-item" value="${item.id}" data-cargo-bay="${isCargoBayModule(item)}">
              <img src="${item.img}">
              <span>${escapeHtml(item.name)}</span>
              <small>Value ${formatGp(value)} | Credit ${formatGp(credit)}</small>
            </label>`;
          }).join("") : `<div class="thm-equipment-empty">No installed equipment or weapons available to trade.</div>`);
        };
        const enforceCapacity = (changedInput = null, notify = false) => {
          const ship = game.actors.get(html.find("#thm-outfit-ship").val());
          const capacity = shipyardModuleCapacity(ship);
          if (!capacity) return true;
          const traded = new Set(selectedTradeIds());
          const retained = shipyardEquipmentItems(ship).filter(item => !traded.has(item.id));
          let equipment = retained.filter(item => item.type === "equipment").reduce((sum, item) => sum + shipyardModuleSlotCount(item), 0);
          let weapons = retained.filter(item => item.type === "weapon").reduce((sum, item) => sum + shipyardModuleSlotCount(item), 0);
          for (const element of html.find(".thm-outfit-row").toArray()) {
            const row = $(element);
            if (!row.find(".thm-outfit-purchase").prop("checked")) continue;
            if (row.data("moduleType") === "weapon") weapons += 1;
            else equipment += 1;
          }
          if (equipment <= capacity.equipment && weapons <= capacity.weapon) return true;
          if (changedInput) $(changedInput).prop("checked", false);
          if (notify) ui.notifications.error(`You cannot buy this module, as your vehicle only supports ${capacity.label} Modules`);
          return false;
        };
        const recalc = (changedInput = null, notifyCapacity = false) => {
          enforceCapacity(changedInput, notifyCapacity);
          const credit = tradeCredit();
          let remaining = bankBalance() + credit;
          let total = 0;
          html.find(".thm-outfit-row").each((_i, element) => {
            const row = $(element);
            const price = Math.max(0, Number(row.data("price") || 0));
            const input = row.find(".thm-outfit-purchase");
            if (!input.prop("checked")) return;
            if (price > remaining) {
              input.prop("checked", false);
              return;
            }
            total += price;
            remaining -= price;
          });
          const net = total - credit;
          html.find("#thm-outfit-total").text(formatGp(total));
          html.find("#thm-outfit-credit").text(formatGp(credit));
          html.find("#thm-outfit-trade-summary").text(`${formatGp(credit)} credit`);
          html.find("#thm-outfit-net").text(net < 0 ? `${formatGp(Math.abs(net))} received` : `${formatGp(net)} due`);
          html.find("#thm-outfit-after").text(formatGp(bankBalance() - net));
          html.find("#thm-outfit-cargo-warning").prop("hidden", html.find(".thm-outfit-trade-item:checked[data-cargo-bay='true']").length === 0);
          const hasPurchases = html.find(".thm-outfit-purchase:checked").length > 0;
          html.find("#thm-outfit-buy").prop("disabled", !hasPurchases && credit <= 0);
        };
        html.find("#thm-outfit-ship").on("change", ev => {
          selectedShipId = ev.currentTarget.value;
          selectedShipName = selectedShip()?.name || "";
          html.find(".thm-outfit-purchase").prop("checked", false);
          renderTradeIns();
          recalc();
        });
        html.find(".thm-outfit-purchase").on("change", ev => recalc(ev.currentTarget, ev.currentTarget.checked));
        html.find("#thm-outfit-trade-items").on("change", ".thm-outfit-trade-item", ev => {
          const input = ev.currentTarget;
          if (!input.checked && !enforceCapacity()) {
            input.checked = true;
            const capacity = shipyardModuleCapacity(game.actors.get(html.find("#thm-outfit-ship").val()));
            ui.notifications.error(`You cannot remove this trade-in while purchasing these modules, as your vehicle only supports ${capacity.label} Modules`);
          }
          recalc();
        });
        html.find("[data-open-item]").on("click", async ev => (await fromUuid(ev.currentTarget.dataset.openItem))?.sheet?.render(true));
        html.find("#thm-outfit-buy").on("click", async () => {
          const button = html.find("#thm-outfit-buy");
          const items = html.find(".thm-outfit-row").toArray()
            .filter(element => $(element).find(".thm-outfit-purchase").prop("checked"))
            .map(element => ({ uuid: element.dataset.uuid, quantity: 1 }));
          const tradeModuleIds = selectedTradeIds();
          if (!items.length && !tradeModuleIds.length) return;
          button.prop("disabled", true).html('<i class="fas fa-spinner fa-spin"></i> Completing Outfitting');
          try {
            await requestGm("outfitShip", { shipId: html.find("#thm-outfit-ship").val(), items, tradeModuleIds }, { awaitResponse: true });
            await dialog.close();
          } catch (error) {
            ui.notifications.error(error.message || "Ship Outfitting could not be completed.");
            button.html('<i class="fas fa-exchange-alt"></i> Complete Outfitting');
            recalc();
          }
        });
        renderTradeIns();
        recalc();
      }
    }, { ...dialogOptions(), width: 820, height: Math.min(820, Number(globalThis.innerHeight || 900) * 0.82) });
    attachWindow(dialog);
    dialog.render(true);
  }
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
      const initialOwned = owned[0];
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
	              <div class="thm-shipyard-equipment-control">
	                <label class="thm-check-line"><input type="checkbox" id="trade-modules"> Sell Equipment</label>
	                <button type="button" class="thm-shipyard-equipment-picker"><span class="thm-equipment-summary">Choose Equipment</span><i class="fas fa-list-check"></i></button>
	              </div>
	              <div class="thm-cargo-bay-warning" hidden><i class="fas fa-exclamation-triangle"></i> Warning: Selling a Cargo Bay will discard all cargo. This cannot be undone.</div>
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
    const moduleSelections = new Set();
    const selectedModuleIds = () => [...moduleSelections];
    const refreshEquipmentPicker = ({ selectAll = false } = {}) => {
      const ownedShip = game.actors.get(html.find("#owned").val());
      moduleSelections.clear();
      if (selectAll) for (const item of shipyardEquipmentItems(ownedShip)) moduleSelections.add(item.id);
      updateEquipmentSummary();
    };
    const updateEquipmentSummary = () => {
      const items = shipyardEquipmentItems(game.actors.get(html.find("#owned").val()));
      const total = items.length;
      const selected = items.filter(item => moduleSelections.has(item.id)).length;
      html.find(".thm-equipment-summary").text(total ? `${selected} of ${total} Selected` : "No Equipment");
      html.find(".thm-shipyard-equipment-picker").toggleClass("disabled", !total);
      const cargoBaySelected = items.some(item => moduleSelections.has(item.id) && isCargoBayModule(item));
      html.find(".thm-cargo-bay-warning").prop("hidden", !cargoBaySelected);
    };
    const calc = () => {
      const ownedShip = game.actors.get(html.find("#owned").val());
      const shipValue = parseNumber(ownedShip?.system?.traits?.dimensions || 0);
      let trade = html.find("#trade-ship").prop("checked") ? Math.floor(shipValue * 0.75) : 0;
      if (html.find("#trade-modules").prop("checked")) {
        trade += shipyardModuleTradeValue(ownedShip, selectedModuleIds());
      }
      const total = price - trade;
      updateEquipmentSummary();
      html.find("#trade-value").text(formatGp(trade));
      html.find("#total-cost").html(total < 0 ? `<b>Receiving Credit:</b> ${formatGp(Math.abs(total))}` : `<b>Total Remaining:</b> ${formatGp(total)}`);
      html.find("#bank-after").html(`<b>Balance after:</b> ${formatGp(bankBalance() - total)}`);
      html.find("#buy").prop("disabled", total > bankBalance());
      html.find("#sell-only").prop("disabled", !html.find("#trade-ship").prop("checked") || html.find("#transfer-modules").prop("checked"));
    };
    html.find("#prev").on("click", () => { dialog.close(); this._setIndex((this._index() - 1 + this._ships.length) % this._ships.length); this._render(); });
    html.find("#next").on("click", () => { dialog.close(); this._setIndex((this._index() + 1) % this._ships.length); this._render(); });
    html.find("#cancel").on("click", () => dialog.close());
    html.find("#owned").on("change", () => {
      refreshEquipmentPicker({ selectAll: html.find("#trade-modules").prop("checked") });
      calc();
    });
    html.find("#trade-ship").on("change", calc);
    html.find(".thm-shipyard-equipment-picker").on("click", () => {
      const ownedShip = game.actors.get(html.find("#owned").val());
      const items = shipyardEquipmentItems(ownedShip);
      if (!items.length) return;
      const optionRows = shipyardEquipmentOptions(ownedShip, { selectedIds: moduleSelections });
      const pickerDialog = new Dialog({
        title: "Select Equipment to Sell",
        content: `<div class="thm-root thm-equipment-picker-dialog">
          <p>Choose the installed modules included in this transaction. Trade credit is 75% of listed value.</p>
          <div class="thm-equipment-options">${optionRows}</div>
          <div class="thm-cargo-bay-warning" hidden><i class="fas fa-exclamation-triangle"></i> Warning: Selling a Cargo Bay will discard all cargo. This cannot be undone.</div>
        </div>`,
        buttons: {
          apply: {
            icon: `<i class="fas fa-check"></i>`,
            label: "Apply Selection",
            callback: pickerHtml => {
              moduleSelections.clear();
              pickerHtml.find(".thm-equipment-item:checked").each((_i, input) => moduleSelections.add(input.value));
              const anySelected = moduleSelections.size > 0;
              html.find("#trade-modules").prop("checked", anySelected);
              if (anySelected) html.find("#transfer-modules").prop("checked", false);
              calc();
            }
          },
          cancel: { label: "Cancel" }
        },
        default: "apply",
        render: pickerHtml => {
          const updateWarning = () => {
            const selectedCargoBay = pickerHtml.find(".thm-equipment-item:checked[data-cargo-bay='true']").length > 0;
            pickerHtml.find(".thm-cargo-bay-warning").prop("hidden", !selectedCargoBay);
          };
          pickerHtml.find(".thm-equipment-item").on("change", updateWarning);
          updateWarning();
          const closeOnOutsideClick = event => {
            const element = pickerDialog.element?.[0];
            if (!pickerDialog.rendered || !element?.isConnected) {
              document.removeEventListener("pointerdown", closeOnOutsideClick, true);
              return;
            }
            if (!element.contains(event.target)) {
              event.preventDefault();
              event.stopPropagation();
              pickerDialog.close();
            }
          };
          window.setTimeout(() => document.addEventListener("pointerdown", closeOnOutsideClick, true), 0);
        }
      }, { ...dialogOptions(), width: 520 });
      pickerDialog.render(true);
    });
    html.find(".thm-shipyard-art img").on("click", ev => new ImagePopout(ev.currentTarget.dataset.img, { title: ev.currentTarget.dataset.title, shareable: true }).render(true));
    html.find("#trade-modules").on("change", () => {
      const checked = html.find("#trade-modules").prop("checked");
      if (checked) {
        html.find("#transfer-modules").prop("checked", false);
        moduleSelections.clear();
        for (const item of shipyardEquipmentItems(game.actors.get(html.find("#owned").val()))) moduleSelections.add(item.id);
      } else {
        moduleSelections.clear();
      }
      calc();
    });
    html.find("#transfer-modules").on("change", () => {
      if (html.find("#transfer-modules").prop("checked")) {
        html.find("#trade-modules").prop("checked", false);
        moduleSelections.clear();
      }
      calc();
    });
    html.find("#buy").on("click", () => requestGm("shipyardBuy", {
      sourceUuid: doc.uuid,
      ownedShipId: html.find("#owned").val(),
      tradeShip: html.find("#trade-ship").prop("checked"),
      tradeModules: html.find("#trade-modules").prop("checked"),
      tradeModuleIds: selectedModuleIds(),
      transferModules: html.find("#transfer-modules").prop("checked")
    }));
    html.find("#sell-only").on("click", () => requestGm("shipyardSell", {
      shipId: html.find("#owned").val(),
      tradeModules: html.find("#trade-modules").prop("checked"),
      tradeModuleIds: selectedModuleIds()
    }));
    calc();
  }
}

function shipyardEquipmentItems(ship) {
  if (!ship) return [];
  return Array.from(ship.items || [])
    .filter(item => ["equipment", "weapon"].includes(item.type))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function shipyardModuleSlotCount(item) {
  return Math.max(1, Math.floor(Number(item?.system?.quantity || 1)));
}

function shipyardModuleCapacity(ship) {
  const label = String(ship?.system?.attributes?.capacity?.creature ?? "").trim();
  const equipment = label.match(/(\d+)\s*Equipment/i);
  const weapon = label.match(/(\d+)\s*Weapon/i);
  if (!equipment || !weapon) return null;
  return {
    equipment: Number(equipment[1]),
    weapon: Number(weapon[1]),
    label
  };
}

function shipyardEquipmentValue(item) {
  const unitValue = Math.max(0, parseNumber(item?.system?.price?.value ?? item?.system?.price ?? 0));
  const quantity = Math.max(1, Number(item?.system?.quantity || 1));
  return unitValue * quantity;
}

function shipyardModuleTradeValue(ship, itemIds) {
  const selected = new Set(itemIds || []);
  return shipyardEquipmentItems(ship)
    .filter(item => selected.has(item.id))
    .reduce((total, item) => total + Math.floor(shipyardEquipmentValue(item) * 0.75), 0);
}

function shipyardEquipmentOptions(ship, { checked = false, selectedIds = null } = {}) {
  const items = shipyardEquipmentItems(ship);
  if (!items.length) return `<div class="thm-equipment-empty">No equipment installed.</div>`;
  return items.map(item => {
    const value = shipyardEquipmentValue(item);
    const credit = Math.floor(value * 0.75);
    const quantity = Math.max(1, Number(item?.system?.quantity || 1));
    const name = quantity > 1 ? `${item.name} x${quantity}` : item.name;
    const selected = selectedIds ? selectedIds.has(item.id) : checked;
    return `<label class="thm-equipment-option">
      <input type="checkbox" class="thm-equipment-item" value="${item.id}" data-cargo-bay="${isCargoBayModule(item)}" ${selected ? "checked" : ""}>
      <span class="thm-equipment-option-name">${escapeHtml(name)}</span>
      <span class="thm-equipment-option-value">${formatGp(value)} <small>(${formatGp(credit)} credit)</small></span>
    </label>`;
  }).join("");
}

function isCargoBayModule(item) {
  return /\bcargo\s*bay\b/i.test(item?.name || "");
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

function hpBarHtml(ship) {
  const hp = ship?.system?.attributes?.hp || {};
  const value = Number(hp.value || 0);
  const max = Number(hp.max || 0);
  const pct = max ? Math.min(value / max * 100, 100) : 0;
  const color = pct < 35 ? "#f44336" : pct < 65 ? "#ffeb3b" : "#4caf50";
  return `<div class="thm-hp-bar thm-shiptools-hp"><div class="thm-hp-fill" style="width:${pct}%; background:${color};"></div><div class="thm-hp-label">${value} / ${max}</div></div>`;
}

function injectVehicleSheetTools(app, html) {
  const actor = app?.actor || app?.document;
  if (!setting("showVehicleSheetTools") || !actor || actor.type !== "vehicle") return;
  if (!actor.testUserPermission?.(game.user, "OWNER")) return;
  const root = html?.jquery ? html : $(html);
  if (!root?.length) return;
  placeVehicleSheetTools(root, actor);
  window.setTimeout(() => placeVehicleSheetTools(root, actor), 100);
}

function placeVehicleSheetTools(root, actor) {
  let panel = root.find(".thm-sheet-shiptools").first();
  if (!panel.length) panel = $(vehicleSheetToolsHtml(actor));
  const target = findConditionImmunityInsertion(root);
  if (target?.length) target.after(panel);
  else {
    const fallback = root.find(".traits, .attributes, .sheet-sidebar, .sidebar, .left-pane, .left-column").first();
    if (fallback.length) fallback.append(panel);
    else root.find("form").first().prepend(panel);
  }
  if (panel.attr("data-thm-bound") !== "true") {
    panel.attr("data-thm-bound", "true");
    bindVehicleSheetTools(panel, actor);
  }
}

function vehicleSheetToolsHtml(_actor) {
  const tradeHubActive = game.modules.get(MODULE_ID)?.active === true;
  const state = serviceState();
  const docked = tradeHubActive && state.any;
  const locationName = getData().currentLocation || "";
  const marketLabel = locationName ? `${locationName} Markets` : "TradeHub Markets";
  const marketButton = tradeHubActive
    ? `<button type="button" data-thm-sheet-tool="market" ${docked ? "" : "disabled"} title="${docked ? `Open ${escapeHtml(marketLabel)}` : "TradeHub Markets is unavailable while undocked"}"><i class="fas fa-store"></i> ${escapeHtml(marketLabel)}</button>`
    : "";
  return `<div class="tradehub-markets thm-sheet-shiptools">
    <div class="thm-sheet-shiptools-capital">TradeHub Capital: ${formatGp(bankBalance())}</div>
    ${marketButton}
    <button type="button" data-thm-sheet-tool="cargo"><i class="fas fa-box-open"></i> View Cargo</button>
  </div>`;
}

function refreshVehicleSheetCapital() {
  $(".thm-sheet-shiptools-capital").text(`TradeHub Capital: ${formatGp(bankBalance())}`);
}

function findConditionImmunityInsertion(root) {
  const conditionLabel = game.i18n.localize("DND5E.ConImm");
  const tidyTrait = root.find('[data-tidy-sheet-part="actor-trait"]').filter((_i, el) => {
    const trait = $(el);
    const icon = trait.find(".trait-icon").first();
    const label = icon.attr("title") || icon.attr("aria-label") || "";
    return label === conditionLabel || /^Condition Immunities\b/i.test(trait.text().trim());
  }).first();
  if (tidyTrait.length) return tidyTrait;

  const regularTrait = root.find(".traits .form-group").filter((_i, el) => {
    const label = $(el).children("label").first().text().trim();
    return label === conditionLabel || /^Condition Immunities\b/i.test(label);
  }).first();
  if (regularTrait.length) return regularTrait;

  const labels = root.find("*").filter((_i, el) => {
    const label = $(el).clone().children().remove().end().text().trim();
    return label === conditionLabel || /^Condition Immunities\b/i.test(label);
  });
  for (const el of labels.toArray().reverse()) {
    const preferred = $(el).closest('[data-tidy-sheet-part="actor-trait"], .trait-form-group, .form-group, .trait, .attribute, .card, li, section');
    if (preferred.length && !preferred.is(root)) return preferred.first();
    const fallback = $(el).closest("div");
    if (fallback.length && !fallback.is(root)) return fallback.first();
  }
  return $();
}

function bindVehicleSheetTools(panel, actor) {
  panel.find("[data-thm-sheet-tool]").on("click", ev => {
    ev.preventDefault();
    ev.stopPropagation();
    selectedShipId = actor.id;
    selectedShipName = actor.name;
    const tool = ev.currentTarget.dataset.thmSheetTool;
    if (tool === "market") return SplashPage.showSplash();
    if (tool === "cargo") return ShipToolsPage.showCargo(actor);
  });
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
        <button type="button" id="thm-cargo"><i class="fas fa-box-open"></i> View Cargo</button>
        <button type="button" id="thm-sheet"><i class="fas fa-id-card"></i> View ${setting("vehicleLabel")} Sheet</button>
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
        html.find("#thm-cargo").on("click", () => this.showCargo(currentShip()));
        html.find("#thm-sheet").on("click", () => currentShip()?.sheet?.render(true));
      }
    }, { ...dialogOptions(), width: 620 }).render(true);
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

}

class CharacterStatusPage {
  static show() {
    const selectedToken = Array.from(game.user?.targets || [])[0] || canvas?.tokens?.controlled?.[0];
    const actor = selectedToken?.actor;
    if (!actor) return ui.notifications.error("Target or select a character token first.");
    if (actor.type === "vehicle") {
      return ui.notifications.warn("Vessel combat, scans, and combat repairs are handled by Full Speed Ahead.");
    }
    return PoisonStatusPage.show(actor, selectedToken);
  }
}

class PoisonStatusPage {
  static show(actor, token) {
    if (!game.user.isGM) return ui.notifications.error("Only the GM can assign TradeHub poison damage.");
    if (!actor || actor.type === "vehicle") return ui.notifications.error("Select a player or NPC token.");
    const lastDamage = lastDamageRollTotal();
    const poison = actor.getFlag(MODULE_ID, "poisonedMovement") || {};
    const necrotic = actor.getFlag(MODULE_ID, "necroticHp") || {};
    const hp = actor.system?.attributes?.hp || {};
    const activeStatuses = activeStatusLabels(actor);
    const statusOptions = statusEffectOptions("poisoned");
    const necroticOriginal = Number(necrotic.originalMax ?? hp.max ?? 0);
    const necroticCurrent = Number(necrotic.currentMax ?? hp.max ?? 0);
    const content = `<div class="thm-root thm-compact thm-status-tool">
      <nav class="thm-settings-tabs thm-damage-tabs">
        <button type="button" class="active" data-tab="poison">Poison</button>
        <button type="button" data-tab="foundry-status">Foundry Status</button>
        <button type="button" data-tab="necrotic">Necrotic</button>
      </nav>
      <div class="thm-link-title">Status: ${escapeHtml(actor.name)}</div>
      <section class="thm-settings-section active" data-tab-panel="poison">
        <p class="notes">TradeHub poison deals damage when this token completes movement equal to its full speed. The damage defaults from the last damage card when found.</p>
        <label>Poison Movement Damage:</label>
        <input type="number" id="thm-poison-damage" min="0" value="${Number(poison.damage ?? lastDamage)}">
        <div class="thm-actions">
          <button type="button" id="thm-apply-poison"><i class="fas fa-skull-crossbones"></i> Apply / Update Poison</button>
          <button type="button" id="thm-clear-poison"><i class="fas fa-times"></i> Clear Poison</button>
        </div>
      </section>
      <section class="thm-settings-section" data-tab-panel="foundry-status">
        <p><strong>Active Foundry Statuses:</strong><br>${activeStatuses.length ? activeStatuses.map(escapeHtml).join(", ") : "<span class='thm-muted'>None detected</span>"}</p>
        <label>Foundry Status:</label>
        <select id="thm-status-effect">${statusOptions}</select>
        <div class="thm-actions">
          <button type="button" id="thm-add-status"><i class="fas fa-plus"></i> Add Status</button>
          <button type="button" id="thm-remove-status"><i class="fas fa-minus"></i> Remove Status</button>
        </div>
      </section>
      <section class="thm-settings-section" data-tab-panel="necrotic">
        <p class="notes">Necrotic damage reduces max HP. TradeHub stores the original max HP before the first reduction, then restores that stored value when cured.</p>
        <p><strong>Current HP:</strong> ${Number(hp.value ?? 0)} / ${Number(hp.max ?? 0)}<br><strong>Stored Baseline:</strong> ${necrotic.active ? `${necroticOriginal} HP` : "<span class='thm-muted'>None saved yet</span>"}<br><strong>Necrotic Current Max:</strong> ${necroticCurrent}</p>
        <label>Necrotic Max HP Reduction:</label>
        <input type="number" id="thm-necrotic-damage" min="0" value="${lastDamage}">
        <div class="thm-actions">
          <button type="button" id="thm-apply-necrotic"><i class="fas fa-hand-holding-medical"></i> Apply Necrotic</button>
          <button type="button" id="thm-cure-necrotic"><i class="fas fa-heart"></i> Cure / Restore HP Max</button>
        </div>
      </section>
    </div>`;
    new Dialog({
      title: "TradeHub Status",
      content,
      buttons: { close: { label: "Close" } },
      render: html => {
        html.find(".thm-damage-tabs button").on("click", ev => {
          const tab = ev.currentTarget.dataset.tab;
          html.find(".thm-damage-tabs button").removeClass("active");
          $(ev.currentTarget).addClass("active");
          html.find(".thm-settings-section").removeClass("active");
          html.find(`.thm-settings-section[data-tab-panel="${tab}"]`).addClass("active");
        });
        html.find("#thm-apply-poison").on("click", async () => {
          const damage = Math.max(0, Number(html.find("#thm-poison-damage").val() || 0));
          if (!damage) return ui.notifications.warn("Enter poison movement damage.");
          await applyTradeHubPoison(actor, damage);
          ui.notifications.info(`${actor.name} is poisoned for ${damage} movement damage.`);
          html.closest(".app").find(".close").click();
        });
        html.find("#thm-clear-poison").on("click", async () => {
          await clearTradeHubPoison(actor);
          ui.notifications.info(`${actor.name} poison cleared.`);
          html.closest(".app").find(".close").click();
        });
        html.find("#thm-add-status").on("click", async () => {
          const status = html.find("#thm-status-effect").val();
          if (status) await setActorStatus(actor, status, true);
        });
        html.find("#thm-remove-status").on("click", async () => {
          const status = html.find("#thm-status-effect").val();
          if (status) await setActorStatus(actor, status, false);
        });
        html.find("#thm-apply-necrotic").on("click", async () => {
          const damage = Math.max(0, Number(html.find("#thm-necrotic-damage").val() || 0));
          if (!damage) return ui.notifications.warn("Enter necrotic max HP reduction.");
          await applyTradeHubNecrotic(actor, damage);
          ui.notifications.info(`${actor.name}'s max HP was reduced by ${damage}.`);
          html.closest(".app").find(".close").click();
        });
        html.find("#thm-cure-necrotic").on("click", async () => {
          await cureTradeHubNecrotic(actor);
          ui.notifications.info(`${actor.name}'s necrotic HP record was restored.`);
          html.closest(".app").find(".close").click();
        });
      }
    }, { ...dialogOptions(["poison-status"]), width: 520 }).render(true);
  }
}

async function applyTradeHubNecrotic(actor, damage) {
  const hp = actor?.system?.attributes?.hp;
  const amount = Math.max(0, Number(damage || 0));
  if (!actor || !hp || !amount) return;
  const record = actor.getFlag(MODULE_ID, "necroticHp") || {};
  const originalMax = Number(record.originalMax ?? hp.max ?? 0);
  const currentMax = Number(hp.max ?? 0);
  const nextMax = Math.max(0, currentMax - amount);
  const nextValue = Math.min(Number(hp.value ?? 0), nextMax);
  await actor.update({
    "system.attributes.hp.max": nextMax,
    "system.attributes.hp.value": nextValue
  });
  await actor.setFlag(MODULE_ID, "necroticHp", {
    active: true,
    originalMax,
    currentMax: nextMax,
    actorName: actor.name,
    updatedAt: Date.now()
  });
  await setActorStatus(actor, "necrotic", true);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="thm-chat-card"><strong style="color:#6a1b9a;">${escapeHtml(actor.name)} suffers necrotic HP reduction.</strong><br>Max HP reduced by <strong>${amount}</strong>: ${currentMax} → ${nextMax}</div>`
  });
}

async function cureTradeHubNecrotic(actor) {
  const hp = actor?.system?.attributes?.hp;
  if (!actor || !hp) return;
  const record = actor.getFlag(MODULE_ID, "necroticHp") || {};
  const originalMax = Number(record.originalMax ?? hp.max ?? 0);
  await actor.update({
    "system.attributes.hp.max": originalMax,
    "system.attributes.hp.value": Math.min(Number(hp.value ?? 0), originalMax)
  });
  await actor.unsetFlag(MODULE_ID, "necroticHp");
  await setActorStatus(actor, "necrotic", false);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="thm-chat-card"><strong>${escapeHtml(actor.name)} is cured of necrotic HP reduction.</strong><br>Max HP restored to <strong>${originalMax}</strong>.</div>`
  });
}

function statusEffectsList() {
  return Array.from(CONFIG.statusEffects || [])
    .map(effect => ({
      id: effect.id || effect._id || effect.name,
      label: game.i18n?.localize?.(effect.label || effect.name || effect.id || "") || effect.name || effect.id || ""
    }))
    .filter(effect => effect.id)
    .sort((a, b) => a.label.localeCompare(b.label));
}

function statusEffectOptions(selected = "") {
  const effects = statusEffectsList();
  return effects.map(effect => `<option value="${escapeHtml(effect.id)}" ${effect.id === selected ? "selected" : ""}>${escapeHtml(effect.label)}</option>`).join("");
}

function activeStatusLabels(actor) {
  const ids = new Set(Array.from(actor?.statuses || []));
  const byId = new Map(statusEffectsList().map(effect => [effect.id, effect.label]));
  return Array.from(ids).map(id => byId.get(id) || id).sort((a, b) => a.localeCompare(b));
}

function statusEffectDefinition(statusId) {
  return (CONFIG.statusEffects || []).find(entry => (entry.id || entry._id || entry.name) === statusId);
}

async function setActorStatus(actor, statusId, active) {
  if (!actor || !statusId) return;
  const effect = statusEffectDefinition(statusId);
  if (!effect) return;
  if (typeof actor.toggleStatusEffect === "function") {
    await actor.toggleStatusEffect(statusId, { active });
    return;
  }
  const token = actorSceneTokens(actor)[0];
  if (typeof token?.toggleEffect === "function") {
    await token.toggleEffect(effect, { active });
  }
}

function tokenPositionMap(actor) {
  const positions = {};
  for (const token of actorSceneTokens(actor)) {
    positions[token.document.id] = { x: Number(token.document.x || 0), y: Number(token.document.y || 0), distance: 0 };
  }
  return positions;
}

async function applyTradeHubPoison(actor, damage) {
  await actor.setFlag(MODULE_ID, "poisonedMovement", {
    active: true,
    damage: Math.max(0, Number(damage || 0)),
    positions: tokenPositionMap(actor)
  });
  await setActorStatus(actor, "poisoned", true);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="thm-chat-card"><strong>${escapeHtml(actor.name)} is poisoned.</strong><br>Movement will deal <strong>${Math.max(0, Number(damage || 0))} poison damage</strong> each time they move their full speed.</div>`
  });
}

async function clearTradeHubPoison(actor) {
  await actor.unsetFlag(MODULE_ID, "poisonedMovement");
  await setActorStatus(actor, "poisoned", false);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="thm-chat-card"><strong>${escapeHtml(actor.name)} is no longer poisoned.</strong></div>`
  });
}

async function applyPoisonMovementDamage(actor, tokenDoc, damage) {
  const hp = actor.system?.attributes?.hp || {};
  const current = Number(hp.value || 0);
  const next = await applyActorDamage(actor, damage);
  await showTokenDamageText(tokenDoc, damage);
  await poisonTokenFlash(actor);
  const soundPath = setting("poisonMovementSoundPath");
  if (soundPath) {
    const volume = Math.max(0, Math.min(1, Number(setting("poisonMovementSoundVolume") ?? 0.8)));
    AudioHelper.play({ src: soundPath, volume, autoplay: true, loop: false }, true);
  }
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="thm-chat-card"><strong style="color:purple;">${escapeHtml(actor.name)} suffers ${damage} poison damage while moving.</strong><br>HP: ${current} → ${next}</div>`
  });
}

async function applyActorDamage(actor, damage) {
  const amount = Math.max(0, Number(damage || 0));
  const before = Number(actor.system?.attributes?.hp?.value || 0);
  if (typeof actor.applyDamage === "function") {
    try {
      await actor.applyDamage(amount);
      return Number(actor.system?.attributes?.hp?.value ?? Math.max(0, before - amount));
    } catch (err) {
      console.warn(`${MODULE_ID} | actor.applyDamage failed; falling back to direct HP update.`, err);
    }
  }
  const next = Math.max(0, before - amount);
  await actor.update({ "system.attributes.hp.value": next });
  return next;
}

async function showTokenDamageText(tokenDoc, damage) {
  try {
    const token = tokenDoc?.object || canvas?.tokens?.get(tokenDoc?.id);
    const center = token?.center || { x: Number(tokenDoc?.x || 0), y: Number(tokenDoc?.y || 0) };
    if (!canvas?.interface?.createScrollingText) return;
    await canvas.interface.createScrollingText(center, `-${Math.max(0, Number(damage || 0))}`, {
      anchor: CONST.TEXT_ANCHOR_POINTS?.CENTER,
      direction: CONST.TEXT_ANCHOR_POINTS?.TOP,
      distance: Math.max(40, Number(canvas?.grid?.size || canvas?.scene?.grid?.size || 100) * 0.75),
      fontSize: 32,
      fill: "#c05cff",
      stroke: "#000000",
      strokeThickness: 4,
      jitter: 0.25
    });
  } catch (err) {
    console.warn(`${MODULE_ID} | Failed to show poison damage text.`, err);
  }
}

function actorMovementSpeed(actor) {
  const movement = actor.system?.attributes?.movement || {};
  const values = Object.entries(movement)
    .filter(([key]) => !["units", "hover"].includes(key))
    .map(([_key, value]) => Number(value || 0))
    .filter(value => value > 0);
  return values.length ? Math.max(...values) : 30;
}

function tokenTravelDistance(previous, tokenDoc) {
  if (!previous) return 0;
  const dx = Number(tokenDoc.x || 0) - Number(previous.x || 0);
  const dy = Number(tokenDoc.y || 0) - Number(previous.y || 0);
  const gridSize = Number(canvas?.scene?.grid?.size || canvas?.grid?.size || 100) || 100;
  const gridDistance = Number(canvas?.scene?.grid?.distance || 5) || 5;
  return Math.hypot(dx, dy) / gridSize * gridDistance;
}

async function handlePoisonMovement(actor, tokenDoc, poison) {
  const speed = Math.max(1, actorMovementSpeed(actor));
  const positions = foundry.utils.deepClone(poison.positions || {});
  const id = tokenDoc.id;
  const previous = positions[id] || { x: Number(tokenDoc.x || 0), y: Number(tokenDoc.y || 0), distance: 0 };
  const traveled = tokenTravelDistance(previous, tokenDoc);
  const accumulated = Math.max(0, Number(previous.distance || 0) + traveled);
  const triggers = Math.min(5, Math.floor(accumulated / speed));
  positions[id] = {
    x: Number(tokenDoc.x || 0),
    y: Number(tokenDoc.y || 0),
    distance: triggers ? accumulated - (triggers * speed) : accumulated
  };
  await actor.setFlag(MODULE_ID, "poisonedMovement", { ...poison, positions });
  if (triggers > 0) await applyPoisonMovementDamage(actor, tokenDoc, Number(poison.damage || 0) * triggers);
}

async function poisonTokenFlash(actor) {
  if (!game.modules?.get("tokenmagic")?.active || !globalThis.TokenMagic) return;
  const params = [{
    filterType: "adjustment",
    filterId: "thmPoisonBlackWhite",
    saturation: 0,
    brightness: 0.65,
    contrast: 1.2,
    gamma: 1,
    red: 1,
    green: 1,
    blue: 1,
    alpha: 1
  }];
  const add = () => withActorTokensSelected(actor, async () => {
    await TokenMagic.addUpdateFiltersOnSelected(params);
  });
  const remove = () => withActorTokensSelected(actor, async () => {
    await TokenMagic.deleteFiltersOnSelected?.("thmPoisonBlackWhite");
  });
  await add();
  window.setTimeout(remove, 220);
  window.setTimeout(add, 300);
  window.setTimeout(remove, 520);
}

function lastDamageRollTotal() {
  const messages = Array.from(game.messages?.contents || []).slice().reverse();
  const rollOf = message => {
    if (!message) return null;
    const rolls = message.rolls || (message.roll ? [message.roll] : []);
    return rolls[0] || null;
  };
  const messageText = message => message ? stripHtml(`${message.flavor || ""} ${message.content || ""}`) : "";
  const damageMessage = messages.find(message => {
    const roll = rollOf(message);
    const text = messageText(message);
    return roll && !roll.formula?.includes("1d20") && !/other formula|constitution saving throw/i.test(text);
  });
  return Number(rollOf(damageMessage)?.total ?? 0);
}

function isEquippedShipModule(item) {
  return ["equipment", "weapon"].includes(item?.type) && item?.system?.equipped === true;
}

function isShipModuleItem(item) {
  return ["equipment", "weapon"].includes(item?.type) && itemMaxHp(item) > 0;
}

function wasTradeHubDestroyed(item) {
  return !!item?.getFlag?.(MODULE_ID, "destroyedUnequipped");
}

function damageableModules(actor) {
  return actor.items.filter(item => isEquippedShipModule(item) && itemMaxHp(item) > 0);
}

function repairableModules(actor) {
  return actor.items.filter(item => isShipModuleItem(item) && (isEquippedShipModule(item) || wasTradeHubDestroyed(item)));
}

function itemMaxHp(item) {
  return Number(item?.system?.hp?.max || 0);
}

function itemHp(item) {
  return Number(item?.system?.hp?.value || 0);
}

function findShipModule(actor, pattern) {
  return actor?.items?.find(item => isEquippedShipModule(item) && pattern.test(item.name || "") && itemMaxHp(item) > 0);
}

async function restoreModuleHp(item, hp = itemMaxHp(item)) {
  const value = Math.max(0, Number(hp || 0));
  const update = { "system.hp.value": value };
  if (value > 0 && wasTradeHubDestroyed(item)) {
    update["system.equipped"] = true;
    update[`flags.${MODULE_ID}.destroyedUnequipped`] = false;
  }
  await item.update(update);
}

function actorSceneTokens(actor) {
  if (!actor || !canvas?.tokens?.placeables) return [];
  return canvas.tokens.placeables.filter(token => token?.actor?.id === actor.id || token?.document?.actorId === actor.id);
}

async function withActorTokensSelected(actor, callback) {
  if (!game.modules?.get("tokenmagic")?.active || !globalThis.TokenMagic || !canvas?.tokens) return false;
  const tokens = actorSceneTokens(actor);
  if (!tokens.length) return false;
  const previouslyControlled = [...(canvas.tokens.controlled || [])];
  canvas.tokens.releaseAll();
  for (const token of tokens) token.control({ releaseOthers: false });
  try {
    await callback(tokens);
  } finally {
    canvas.tokens.releaseAll();
    for (const token of previouslyControlled) {
      if (token?.scene === canvas.scene) token.control({ releaseOthers: false });
    }
  }
  return true;
}

function shieldEffectColors(shield) {
  const type = String((shield?.name || "").match(/\[(.*?)\]/)?.[1] || "").trim().toUpperCase();
  if (type === "A") return { val1: 0xe60000, val2: 0xff5050 };
  if (type === "B") return { val1: 0x5099DD, val2: 0x90EEFF };
  if (type === "C") return { val1: 0x00cc66, val2: 0x99ff33 };
  if (type === "D") return { val1: 0xffff00, val2: 0xffff99 };
  if (type === "PRISMATIC") return { val1: 0x9999ff, val2: 0xff00ff };
  return { val1: 0x5099DD, val2: 0x90EEFF };
}

async function activateShieldTokenEffect(actor) {
  const shield = findShipModule(actor, /shield generator|shield/i);
  if (!shield || itemHp(shield) <= 0) return;
  const colorParams = shieldEffectColors(shield);
  const params = [{
    filterType: "glow",
    filterId: "superSpookyGlow",
    outerStrength: 6,
    innerStrength: 0,
    color: 0x5099DD,
    quality: 0.5,
    padding: 10,
    animated: {
      color: {
        active: "active",
        loopDuration: 3000,
        animType: "colorOscillation",
        val1: colorParams.val1,
        val2: colorParams.val2
      }
    }
  }];
  await withActorTokensSelected(actor, async () => {
    await TokenMagic.addUpdateFiltersOnSelected(params);
  });
}

async function clearShipTokenEffects(actor) {
  const astrumFolder = "https://assets.forge-vtt.com/62bf9a2b7fa42ce7966f6738/STARPG/CharTokens/AstrumKnights/";
  const playersFolder = "https://assets.forge-vtt.com/62bf9a2b7fa42ce7966f6738/STARPG/CharTokens/Players/";
  const tokens = actorSceneTokens(actor);
  for (const token of tokens) {
    await token.document.update({ "light.alpha": 0 });
    const currentImg = token.document.texture?.src || "";
    if (currentImg.startsWith(astrumFolder)) {
      const extension = currentImg.split(".").pop();
      const sanitizedName = actor.name.replace(/\s+/g, "");
      await token.document.update({ img: `${playersFolder}${sanitizedName}.${extension}` });
    }
  }
  await withActorTokensSelected(actor, async () => {
    await TokenMagic.deleteFiltersOnSelected();
  });
}

async function refreshShipTokenEffects(actor) {
  await clearShipTokenEffects(actor);
  await activateShieldTokenEffect(actor);
}

async function syncVehicleHpFromModules(actor) {
  const total = damageableModules(actor).reduce((sum, item) => sum + itemHp(item), 0);
  await actor.update({ "system.attributes.hp.value": total });
  return total;
}

class TradeHubSettingsForm extends FormApplication {
  static get defaultOptions() {
    const viewportWidth = Number(globalThis.innerWidth || 1280);
    const viewportHeight = Number(globalThis.innerHeight || 900);
    const width = Math.round(Math.min(1180, Math.max(760, viewportWidth * 0.74)));
    const height = Math.round(Math.min(820, Math.max(620, viewportHeight * 0.78)));
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "tradehub-markets-settings",
      title: "TradeHub Markets Settings",
      template: `modules/${MODULE_ID}/templates/settings.html`,
      width,
      height,
      closeOnSubmit: true,
      classes: ["tradehub-markets", "thm-settings-app"]
    });
  }

  getData() {
    const data = getData();
    const excludedRestActors = new Set(setting("restConsumableExcludedUsers") || []);
    const ownerLevel = CONST.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? CONST.DOCUMENT_PERMISSION_LEVELS?.OWNER ?? 3;
    const restSupplyActors = game.actors.contents
      .filter(actor => actor.type === "character")
      .filter(actor => game.users.contents.some(user => !user.isGM && Number(actor.ownership?.[user.id] || 0) >= ownerLevel))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(actor => ({ id: actor.id, name: actor.name, excluded: excludedRestActors.has(actor.id) }));
    return {
      packFields: [
        this.packFieldData("tradeGoodsPack", "tradeGoodsFolderPath", "Trade Goods", "Items sold through normal markets."),
        this.packFieldData("ammoRestockPack", "ammoRestockFolderPath", "Ammunition Restock", "Dedicated ammunition/restock source."),
        this.packFieldData("vehicleConsumablesPack", "vehicleConsumablesFolderPath", "Vehicle Consumables", "Vehicle equipment and repair reference items."),
        this.packFieldData("shipyardPack", "shipyardFolderPath", "Shipyard Vehicles", "Purchasable vehicle actor compendium."),
        this.packFieldData("shipyardModulesPack", "shipyardModulesFolderPath", "Shipyard Modules", "Equipment and weapon items sold through Ship Outfitting.")
      ],
      settings: {
        marketplaceImage: setting("marketplaceImage") || "",
        adFolder: setting("adFolder") || "",
        dockSoundPath: setting("dockSoundPath") || "",
        starportLoadSoundPath: setting("starportLoadSoundPath") || "",
        forienShowSoundEnabled: !!setting("forienShowSoundEnabled"),
        forienShowSoundPath: setting("forienShowSoundPath") || "",
        forienShowSoundVolume: Number(setting("forienShowSoundVolume") ?? 0.8).toFixed(2),
        poisonMovementSoundPath: setting("poisonMovementSoundPath") || "",
        poisonMovementSoundVolume: Number(setting("poisonMovementSoundVolume") ?? 0.8).toFixed(2),
        warezMarketHackEnabled: !!setting("warezMarketHackEnabled"),
        illegalCargoStealthChecksEnabled: !!setting("illegalCargoStealthChecksEnabled"),
        warezTecDc: Number(setting("warezTecDc") || 16),
        warezDiscountTier0: Number(setting("warezDiscountTier0") ?? 25),
        warezDiscountTier1: Number(setting("warezDiscountTier1") ?? 50),
        warezDiscountTier2: Number(setting("warezDiscountTier2") ?? 75),
        warezDiscountTier3: Number(setting("warezDiscountTier3") ?? 90),
        warezDiscountTier4: Number(setting("warezDiscountTier4") ?? 100),
        illegalCargoStealthDc: Number(setting("illegalCargoStealthDc") || 14),
        warezHackSoundPath: setting("warezHackSoundPath") || "",
        warezHackSoundVolume: Number(setting("warezHackSoundVolume") ?? 0.8).toFixed(2),
        vehicleLabel: setting("vehicleLabel") || "Vessel",
        repairCostPerHp: Number(setting("repairCostPerHp") || 0),
        repairCostPerShieldPoint: Number(setting("repairCostPerShieldPoint") || 0),
        shipUpkeepPercent: shipUpkeepPercent(),
        stockMin: Number(setting("stockMin") || 0),
        stockMax: Number(setting("stockMax") || 0),
        maxPriceChangePercent: Number(setting("maxPriceChangePercent") || 0),
        maxShortagePriceIncreasePercent: Number(setting("maxShortagePriceIncreasePercent") || 57),
        enableTradeRumours: !!setting("enableTradeRumours"),
        launchOnDock: !!setting("launchOnDock"),
        requireConsumableForPlayerRest: !!setting("requireConsumableForPlayerRest"),
        showVehicleSheetTools: !!setting("showVehicleSheetTools"),
        showGmBar: !!setting("showGmBar"),
        capital: Number(data.capital || 0),
        newsJournalUuid: tradeHubNewsJournal()?.uuid || ""
      },
      restSupplyUsers: restSupplyActors
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
    html.find("[data-volume-output]").on("input change", ev => {
      html.find(`#${ev.currentTarget.dataset.volumeOutput}`).text(Number(ev.currentTarget.value || 0).toFixed(2));
    });
    html.find("[data-open-news]").on("click", async ev => {
      const doc = await fromUuid(ev.currentTarget.dataset.openNews);
      doc?.sheet?.render(true);
    });
  }

  async _updateObject(_event, formData) {
    const data = getData();
    const rawForm = _event?.target ? new FormData(_event.target) : null;
    const keys = [
      "tradeGoodsPack", "tradeGoodsFolderPath",
      "ammoRestockPack", "ammoRestockFolderPath",
      "vehicleConsumablesPack", "vehicleConsumablesFolderPath",
      "shipyardPack", "shipyardFolderPath",
      "shipyardModulesPack", "shipyardModulesFolderPath",
      "marketplaceImage", "adFolder", "dockSoundPath", "starportLoadSoundPath", "forienShowSoundPath", "poisonMovementSoundPath", "warezHackSoundPath", "vehicleLabel"
    ];
    for (const key of keys) await setSetting(key, formData[key] ?? "");
    await setSetting("forienShowSoundEnabled", !!formData.forienShowSoundEnabled);
    await setSetting("forienShowSoundVolume", Math.max(0, Math.min(1, Number(formData.forienShowSoundVolume ?? 0.8))));
    await setSetting("poisonMovementSoundVolume", Math.max(0, Math.min(1, Number(formData.poisonMovementSoundVolume ?? 0.8))));
    await setSetting("warezMarketHackEnabled", !!formData.warezMarketHackEnabled);
    await setSetting("illegalCargoStealthChecksEnabled", !!formData.illegalCargoStealthChecksEnabled);
    await setSetting("warezTecDc", Math.max(1, Number(formData.warezTecDc || 16)));
    await setSetting("warezDiscountTier0", clampPercent(formData.warezDiscountTier0 ?? 25));
    await setSetting("warezDiscountTier1", clampPercent(formData.warezDiscountTier1 ?? 50));
    await setSetting("warezDiscountTier2", clampPercent(formData.warezDiscountTier2 ?? 75));
    await setSetting("warezDiscountTier3", clampPercent(formData.warezDiscountTier3 ?? 90));
    await setSetting("warezDiscountTier4", clampPercent(formData.warezDiscountTier4 ?? 100));
    await setSetting("illegalCargoStealthDc", Math.max(1, Number(formData.illegalCargoStealthDc || 14)));
    await setSetting("warezHackSoundVolume", Math.max(0, Math.min(1, Number(formData.warezHackSoundVolume ?? 0.8))));
    await setSetting("repairCostPerHp", Number(formData.repairCostPerHp || 0));
    await setSetting("repairCostPerShieldPoint", Number(formData.repairCostPerShieldPoint || 0));
    await setSetting("shipUpkeepPercent", Math.max(0, Number(formData.shipUpkeepPercent ?? 0.2)));
    await setSetting("stockMin", Number(formData.stockMin || 0));
    await setSetting("stockMax", Number(formData.stockMax || 0));
    await setSetting("maxPriceChangePercent", Number(formData.maxPriceChangePercent || 0));
    await setSetting("maxShortagePriceIncreasePercent", Math.max(0, Number(formData.maxShortagePriceIncreasePercent || 0)));
    await setSetting("enableTradeRumours", !!formData.enableTradeRumours);
    await setSetting("launchOnDock", !!formData.launchOnDock);
    await setSetting("requireConsumableForPlayerRest", !!formData.requireConsumableForPlayerRest);
    await setSetting("showVehicleSheetTools", !!formData.showVehicleSheetTools);
    await setSetting("restConsumableExcludedUsers", rawForm ? rawForm.getAll("restConsumableExcludedUsers") : []);
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

function actorForUserId(userId) {
  const user = game.users.get(userId);
  if (user?.character) return user.character;
  const ownerLevel = CONST.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? CONST.DOCUMENT_PERMISSION_LEVELS?.OWNER ?? 3;
  return game.actors.contents.find(actor => actor.type !== "vehicle" && Number(actor.ownership?.[userId] || 0) >= ownerLevel) || null;
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
  static show(prefill = {}) {
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
	    const selectedActor = game.actors.get(prefill.actorId) || canvas.tokens?.controlled?.[0]?.actor;
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
	        if (prefill.crime) {
	          html.find("#fine-crime").val(prefill.crime);
	          html.find("#fine-description").val(prefill.description || prefill.crime);
	          html.find("#fine-amount").val(Math.max(0, Number(prefill.fineAmount || 0)));
	        }
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
		      <button title="Character Status"><i class="fas fa-skull-crossbones"></i></button>
		      <button title="Fines"><i class="fas fa-ticket-alt"></i></button>
		      <button title="Banking"><i class="fas fa-wallet"></i></button>
		      <button title="Settings"><i class="fas fa-cog"></i></button>`;
		    document.body.appendChild(bar);
		    const [dock, meetNpc, meetSystem, market, heroes, damage, fines, bank, config] = bar.querySelectorAll("button");
		    dock.addEventListener("click", () => DockingPage.showDockingPage());
		    meetNpc.addEventListener("click", () => MeetNpcPage.show());
		    meetSystem.addEventListener("click", () => MeetSystemPage.show());
		    market.addEventListener("click", () => SplashPage.showSplash());
		    heroes.addEventListener("click", () => HeroesForHirePage.show());
		    damage.addEventListener("click", () => CharacterStatusPage.show());
	    fines.addEventListener("click", () => FinesPage.show());
	    bank.addEventListener("click", () => BankingPage.show());
	    config.addEventListener("click", () => ConfigPage.show());
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
    const rows = await marketRows(location, { buyDiscount: true });
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
    data.capital = Math.max(0, Number(data.capital || 0) - total);
    syncShipDirectory(data);
    await setSetting("data", data);
    await chatReceipt("Cargo Purchased by", userId, receipt, `Total Cost of Goods: ${formatGp(total)}`, `TradeHub Capital: ${formatGp(bankBalance())}`, "Funds transferred from TradeHub capital, thank you for shopping with TradeHub(TM)");
    broadcastRefresh();
    SplashPage.refreshSplash();
  }

  static async sellGoods({ shipId, location, items, checks = {} }, userId) {
    const ship = game.actors.get(shipId);
    const rows = await marketRows(location);
    const data = getData();
    let total = 0;
    let forfeitedIllegalTotal = 0;
    let illegalFine = 0;
    const receipt = [];
    const soldLines = [];
    const soldWarez = [];
    const soldIllegal = [];
    const userName = checks.actorName || actorNameForUser(userId);
    const checkActor = marketCheckActorFromChecks(checks, userId);
    for (const entry of items) {
      const row = rows.find(r => r.name === entry.name);
      const item = ship.items.getName(entry.name);
      if (!row || !item) continue;
      const qty = Math.min(Number(entry.quantity), Number(item.system.quantity || 0));
      if (qty <= 0) continue;
      const lineTotal = qty * row.price;
      const warez = isWarezGood(row.name);
      const illegal = isIllegalGood(row.name);
      if (warez) soldWarez.push({ row, qty, lineTotal });
      if (illegal) soldIllegal.push({ row, qty, lineTotal });
      soldLines.push({ row, qty, lineTotal, warez, illegal });
      const remaining = Number(item.system.quantity || 0) - qty;
      if (remaining <= 0 && row.name.toLowerCase() !== "hydrogen fuel") await item.delete();
      else await item.update({ "system.quantity": Math.max(0, remaining) });
      data.markets[location][row.name].stock = Number(data.markets[location][row.name].stock || 0) + qty;
      data.markets[location][row.name].lastPaid = row.price;
    }
    const stealthDc = Number(checks.illegalStealthDc || illegalCargoStealthDc());
    const stealthTotal = Number(checks.illegalStealthTotal || 0);
    const stealthFailure = setting("illegalCargoStealthChecksEnabled") && soldIllegal.length && stealthTotal < stealthDc;
    for (const { row, qty, lineTotal, illegal } of soldLines) {
      if (stealthFailure && illegal) {
        forfeitedIllegalTotal += lineTotal;
        receipt.push(`${row.name} x ${qty} @ ${row.price.toFixed(2)} GP each. <span class="thm-red">Illegal sale detected; proceeds forfeited.</span>`);
      } else {
        total += lineTotal;
        receipt.push(`${row.name} x ${qty} @ ${row.price.toFixed(2)} GP each.`);
      }
    }
    if (setting("warezMarketHackEnabled") && soldWarez.length) {
      const tecDc = Number(checks.warezTecDc || warezTecDc());
      const discount = warezDiscountForRoll(checks.warezTecTotal, tecDc);
      if (discount > 0) {
        data.marketDiscounts ||= {};
        data.marketDiscounts[location] = { percent: discount, expiresAt: Date.now() + 10 * 60 * 1000, userId };
        await ChatMessage.create({ content: `<strong>${escapeHtml(userName)} has used illegal Warez to favorably crash the market!</strong><br>Prices are <strong>${discount}% off</strong> at ${escapeHtml(location)} for the next 10 minutes.` });
      } else {
        await ChatMessage.create({
          whisper: ChatMessage.getWhisperRecipients("GM").map(user => user.id),
          content: `<strong>TradeHub Smuggling Alert</strong><br>${escapeHtml(userName)} sold illegal Warez at ${escapeHtml(location)} and failed the TEC check. No market discount was applied.`
        });
      }
    }
    if (stealthFailure) {
      const illegalItemCount = new Set(soldIllegal.map(entry => entry.row.name)).size;
      illegalFine = illegalItemCount * 2000;
      receipt.push(`<span class="thm-red">Smuggling fine assessed: ${formatGp(illegalFine)}</span>`);
      if (checkActor) await setActorWanted(checkActor, true);
    }
    data.capital = Math.max(0, Number(data.capital || 0) + total - illegalFine);
    syncShipDirectory(data);
    await setSetting("data", data);
    if (stealthFailure) {
      await ChatMessage.create({
        content: `<strong>TradeHub Illegal Cargo Sale</strong><br>${escapeHtml(userName)} failed a Stealth check while selling illegal cargo at ${escapeHtml(location)}.<br>Illegal sale completed, but ${formatGp(forfeitedIllegalTotal)} was forfeited and a ${formatGp(illegalFine)} fine was taken from TradeHub capital.<br><strong>[Wanted]</strong> status issued.<br><strong>TradeHub Capital:</strong> ${formatGp(bankBalance())}`
      });
    }
    await chatReceipt("Cargo Sold by", userId, receipt, `Total Gain of Goods: ${formatGp(total)}`, `TradeHub Capital: ${formatGp(bankBalance())}`, "Funds added to TradeHub capital, thank you for trading with TradeHub(TM)", userName);
    broadcastRefresh();
    SplashPage.refreshSplash();
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
    for (const entry of repairs) await restoreModuleHp(entry.item, Number(entry.hp.max || entry.hp.value || 0));
    const actorHp = await syncVehicleHpFromModules(ship);
    await refreshShipTokenEffects(ship);
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
      supplyRestock: payload.supplyRestock !== false,
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
    if (payload.supplyRestock === false) services.push(`<span style="color: gray;"><b>- Supply Restock</b></span>`);
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

  static async outfitShip({ shipId, items, tradeModuleIds }, userId) {
    if (!serviceState().shipyard) throw new Error("Ship Outfitting is not available at this location.");
    const ship = game.actors.get(shipId);
    if (!ship || ship.type !== "vehicle") throw new Error("Selected craft was not found.");
    const owner = CONST.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? CONST.DOCUMENT_PERMISSION_LEVELS?.OWNER ?? 3;
    const user = game.users.get(userId);
    const ownership = ship.ownership || {};
    if (!user?.isGM && Number(ownership[userId] ?? ownership.default ?? 0) < owner) throw new Error("You do not own the selected craft.");
    const configured = await getShipyardModules();
    const available = new Map(configured.map(module => [module.uuid, module]));
    const requested = [];
    const requestedUuids = new Set();
    for (const entry of items || []) {
      const module = available.get(entry.uuid);
      if (!module || requestedUuids.has(entry.uuid)) continue;
      requestedUuids.add(entry.uuid);
      requested.push({ module, quantity: 1 });
    }
    const installedModules = shipyardEquipmentItems(ship);
    const validTradeIds = new Set(installedModules.map(item => item.id));
    const selectedTradeIds = [...new Set(Array.isArray(tradeModuleIds) ? tradeModuleIds : [])].filter(id => validTradeIds.has(id));
    const sellsCargoBay = installedModules.some(item => selectedTradeIds.includes(item.id) && isCargoBayModule(item));
    const cargoItems = sellsCargoBay ? Array.from(ship.items).filter(item => ["loot", "consumable"].includes(item.type)) : [];
    if (!requested.length && !selectedTradeIds.length) throw new Error("No modules were selected for purchase or trade-in.");
    const capacity = shipyardModuleCapacity(ship);
    if (capacity) {
      const traded = new Set(selectedTradeIds);
      const retained = installedModules.filter(item => !traded.has(item.id));
      const equipment = retained.filter(item => item.type === "equipment").reduce((sum, item) => sum + shipyardModuleSlotCount(item), 0)
        + requested.filter(entry => entry.module.type === "equipment").reduce((sum, entry) => sum + entry.quantity, 0);
      const weapons = retained.filter(item => item.type === "weapon").reduce((sum, item) => sum + shipyardModuleSlotCount(item), 0)
        + requested.filter(entry => entry.module.type === "weapon").reduce((sum, entry) => sum + entry.quantity, 0);
      if (equipment > capacity.equipment || weapons > capacity.weapon) {
        throw new Error(`You cannot buy this module, as your vehicle only supports ${capacity.label} Modules`);
      }
    }
    const purchaseTotal = requested.reduce((sum, entry) => sum + entry.module.price * entry.quantity, 0);
    const tradeCredit = shipyardModuleTradeValue(ship, selectedTradeIds);
    const netCost = purchaseTotal - tradeCredit;
    if (netCost > bankBalance()) throw new Error("Not enough TradeHub capital for this outfitting order.");
    const createData = [];
    for (const entry of requested) {
      const source = await fromUuid(entry.module.uuid);
      if (!source) continue;
      for (let i = 0; i < entry.quantity; i += 1) {
        const itemData = duplicateDoc(source);
        delete itemData._id;
        if (foundry.utils.hasProperty(itemData, "system.quantity")) foundry.utils.setProperty(itemData, "system.quantity", 1);
        foundry.utils.setProperty(itemData, "system.equipped", true);
        foundry.utils.setProperty(itemData, `flags.${MODULE_ID}.destroyedUnequipped`, false);
        createData.push(itemData);
      }
    }
    if (requested.length && !createData.length) throw new Error("The selected module documents could not be loaded.");
    let created = [];
    try {
      if (createData.length) created = await ship.createEmbeddedDocuments("Item", createData);
      const deleteIds = [...selectedTradeIds, ...cargoItems.map(item => item.id)];
      if (deleteIds.length) await ship.deleteEmbeddedDocuments("Item", [...new Set(deleteIds)]);
    } catch (error) {
      if (created.length) await ship.deleteEmbeddedDocuments("Item", created.map(item => item.id));
      throw error;
    }
    await updateBank(bankBalance() - netCost);
    const purchases = requested.map(entry => `${escapeHtml(entry.module.name)} x ${entry.quantity} @ ${formatGp(entry.module.price)}`).join("<br>") || "None";
    const online = created.map(item => escapeHtml(item.name)).join("<br>") || "None";
    const traded = installedModules
      .filter(item => selectedTradeIds.includes(item.id))
      .map(item => `${escapeHtml(item.name)}: ${formatGp(Math.floor(shipyardEquipmentValue(item) * 0.75))} credit`)
      .join("<br>") || "None";
    await ChatMessage.create({
      user: userId,
      content: `<strong>Ship Outfitting Complete</strong><br><strong>${escapeHtml(ship.name)}</strong><br><br><strong>Systems Online:</strong><br>${online}<br><br><strong>Modules Purchased:</strong><br>${purchases}<br><br><strong>Modules Traded In:</strong><br>${traded}${cargoItems.length ? `<br><br><strong class="thm-red">Cargo discarded:</strong> ${cargoItems.map(item => escapeHtml(item.name)).join(", ")}` : ""}<br><br><strong>Purchase Total:</strong> ${formatGp(purchaseTotal)}<br><strong>Trade-In Credit:</strong> ${formatGp(tradeCredit)}<br><strong>${netCost < 0 ? "Credit Received" : "Net Cost"}:</strong> ${formatGp(Math.abs(netCost))}<br><strong>TradeHub Capital:</strong> ${formatGp(bankBalance())}`
    });
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
    const availableModules = shipyardEquipmentItems(selected);
    const validModuleIds = new Set(availableModules.map(item => item.id));
    const requestedIds = Array.isArray(payload.tradeModuleIds) ? payload.tradeModuleIds : availableModules.map(item => item.id);
    const soldModuleIds = payload.tradeModules ? requestedIds.filter(id => validModuleIds.has(id)) : [];
    let trade = 0;
    if (selected && payload.tradeShip) trade += Math.floor(parseNumber(selected.system?.traits?.dimensions || 0) * 0.75);
    if (selected && soldModuleIds.length) trade += shipyardModuleTradeValue(selected, soldModuleIds);
    const total = price - trade;
    if (total > bankBalance()) throw new Error("Not enough capital.");
    await updateBank(bankBalance() - total);
    const newShip = await Actor.create(newData);
    let discardedCargo = [];
    if (selected) {
      ({ discardedCargo } = await transferShipItems(selected, newShip, {
        soldModuleIds,
        transferModules: !!payload.transferModules,
        tradeShip: !!payload.tradeShip
      }));
    }
    if (selected && payload.tradeShip) await selected.delete();
    const soldNames = availableModules.filter(item => soldModuleIds.includes(item.id)).map(item => escapeHtml(item.name));
    await ChatMessage.create({ content: `<strong>${game.users.get(userId)?.name || "A player"}</strong> purchased <strong>${newShip.name}</strong>.${soldNames.length ? `<br><strong>Equipment sold:</strong> ${soldNames.join(", ")}` : ""}${discardedCargo.length ? `<br><strong class="thm-red">Cargo discarded:</strong> ${discardedCargo.map(name => escapeHtml(name)).join(", ")}` : ""}<br><strong>TradeHub Capital:</strong> ${formatGp(bankBalance())}` });
    const data = getData();
    syncShipDirectory(data);
    await setSetting("data", data);
    broadcastRefresh();
  }

  static async shipyardSell({ shipId, tradeModules, tradeModuleIds }, userId) {
    const ship = game.actors.get(shipId);
    if (!ship) throw new Error("Selected ship not found.");
    const modules = shipyardEquipmentItems(ship);
    const validIds = new Set(modules.map(item => item.id));
    const requestedIds = Array.isArray(tradeModuleIds) ? tradeModuleIds : modules.map(item => item.id);
    const soldModuleIds = tradeModules ? requestedIds.filter(id => validIds.has(id)) : [];
    const hullValue = Math.floor(parseNumber(ship.system?.traits?.dimensions || 0) * 0.75);
    const moduleValue = shipyardModuleTradeValue(ship, soldModuleIds);
    const value = hullValue + moduleValue;
    const discardsCargo = modules.some(item => soldModuleIds.includes(item.id) && isCargoBayModule(item));
    const discardedCargo = discardsCargo ? Array.from(ship.items).filter(item => ["loot", "consumable"].includes(item.type)).map(item => item.name) : [];
    await updateBank(bankBalance() + value);
    await ship.delete();
    const soldNames = modules.filter(item => soldModuleIds.includes(item.id)).map(item => escapeHtml(item.name));
    await ChatMessage.create({ content: `<strong>${game.users.get(userId)?.name || "A player"}</strong> sold <strong>${ship.name}</strong> for ${formatGp(value)}.${soldNames.length ? `<br><strong>Equipment included:</strong> ${soldNames.join(", ")}` : ""}${discardedCargo.length ? `<br><strong class="thm-red">Cargo discarded:</strong> ${discardedCargo.map(name => escapeHtml(name)).join(", ")}` : ""}<br><strong>TradeHub Capital:</strong> ${formatGp(bankBalance())}` });
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

}

async function transferShipItems(oldShip, newShip, { soldModuleIds = [], transferModules = false, tradeShip = false } = {}) {
  const sold = new Set(soldModuleIds);
  const sellsCargoBay = Array.from(oldShip.items).some(item => sold.has(item.id) && isCargoBayModule(item));
  const moving = [];
  const deleting = [];
  const discardedCargo = [];
  for (const item of oldShip.items) {
    const isModule = ["equipment", "weapon"].includes(item.type);
    const isCargo = ["loot", "consumable"].includes(item.type);
    if (isModule && sold.has(item.id)) {
      deleting.push(item);
      continue;
    }
    if (isCargo && sellsCargoBay) {
      deleting.push(item);
      discardedCargo.push(item.name);
      continue;
    }
    if ((tradeShip && (isModule || isCargo)) || (!tradeShip && transferModules && isModule)) {
      moving.push(duplicateDoc(item));
      if (!tradeShip) deleting.push(item);
    }
  }
  if (moving.length) await newShip.createEmbeddedDocuments("Item", moving);
  for (const item of deleting) await item.delete();
  if (tradeShip) {
    await newShip.update({
      "system.cargo.crew": clone(oldShip.system?.cargo?.crew || []),
      "system.cargo.passengers": clone(oldShip.system?.cargo?.passengers || [])
    });
  }
  return { discardedCargo };
}

async function chatReceipt(title, userId, lines, total, balance, footer, actorName = "") {
  if (!lines.length) return;
  await ChatMessage.create({
    content: `<strong>${title}:</strong><br>${escapeHtml(actorName || actorNameForUser(userId))}<br><br><strong>Receipt:</strong><br>${lines.join("<br>")}<br><br><strong>${total}</strong><br>(Rounded Down)<br><br><strong>${balance}</strong><br><em>${footer}</em>`
  });
}
