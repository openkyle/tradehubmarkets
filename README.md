# TradeHub Markets

TradeHub Markets is a Foundry VTT v11 / DnD5e 2.4.1 module rewrite of the original TradeHub macro suite.

## Setup

1. Enable the module.
2. Open **Configure Settings > Module Settings > TradeHub Markets**.
3. Set the compendium pack for **Trade Goods**.
4. Optionally set a compendium folder path inside that pack, such as `Food / Staples`.
5. Set **Ammunition Restock** to the dedicated supply/restock compendium.
6. Set **Vehicle Consumables** for vehicle equipment/repair references.
7. Set **Shipyard Vehicles** to the compendium containing purchasable vehicle actors.
8. Set **Advertisement Folder** to a Foundry FilePicker path or folder URL. Each player client randomly pulls an ad when their market opens.
9. Set **TradeHub Capital** in the floating GM gear menu. TradeHub manages capital internally and no longer requires a Bank of Holding actor after initial migration.
10. Optional: create a visible journal named **TradeHub News Stories**. Use pages named after locations, or a folder named **TradeHub News Stories** containing location journals. Each line is eligible for the market ticker.

The old macros still work:

```js
game.tradehub.SplashPage.showSplash();
game.tradehub.DockingPage.showDockingPage();
```

The module also ships with a macro compendium named **TradeHub Markets Macros**.

The GM floating bar provides quick buttons for Docking, Market, Banking, and Settings. Banking edits TradeHub's internal capital directly and can optionally record a player withdrawal to a player-owned actor.

## Data Model

Location, capital, and market state are stored in world settings controlled by the GM. Players request transactions over the module socket; the GM client performs actor and currency updates, then broadcasts a refresh to all open TradeHub windows.

If an old **Bank of Holding** actor exists and internal capital is still 0, the GM client seeds TradeHub capital from that actor once. Ongoing purchases, sales, restocks, repairs, and shipyard transactions use the internal balance.

## Revision Notes

- Starport Services only lists world actor vehicles with Owner permission for the current player. GM views show vehicles owned by at least one non-GM player.
- Buy, sell, restock, and repair tables are sortable.
- Quantity controls clamp against available capital and cargo capacity.
- Emergency docking marks normal buy cargo as `EMRG`, allows selling, and keeps illegal-market buying available.
- Sell-page items with no last-paid cost basis display as `100% Profit`.
- Supply Restock shows a running supply total and remaining TradeHub capital.
- Shipyard cards restore full size labels, class tier, speed units, cargo capacity, and module capacity from vehicle actor data.
- Docking supports an **Uninhabited** market state that greys out market services while still tracking party travel.
- Docking can delete custom locations, clear the current party location, and retain last-paid market values for future recreation.
- Docking locations are fully configurable normal locations; legacy hardcoded Space, Unknown, and In the Wild states are no longer seeded as system options.
- Locations can choose whether TradeHub should describe activity as happening `in` the location instead of `on` it for news rumours and docking chat cards.
- Market windows show a small TradeHub News ticker from journal lines and hidden predictive trade rumours.
- Docking maintains a pool of predictive rumours that can secretly influence future market stock and price generation.
- TradeHub News displays on Starport Services and Browse Goods, but not Sell Cargo.
- TradeHub News reads folder `TradeHubMarkets`, journal `TradeHubNews`, and location-named pages such as `Looterra`.
- Predictive rumours are settings-controlled wildcard hints, limited to one or two per location.
- Six ticker headlines are selected per location on Dock / Travel and stored so all players see the same ticker set until the party leaves and returns; display order is shuffled whenever Starport Services or Browse Goods opens.
- Starport Services can play a configurable local load sound from the Visuals settings tab.
- Predictive shortage price increases are capped by the **Max Shortage %** setting, default 57%; the GM may set any higher value intentionally.
- TradeHub Settings are organized into tabs for Compendiums, Visuals, Capital, and Market Math.
- TradeHub Settings include a Help tab with concise setup and workflow tips for compendiums, markets, vehicles, capital, repairs, combat, news, and GM controls.
- TradeHub Settings now open as a larger configuration window with scrollable tab content.
- Shipyard purchase options are ordered by parsed purchase price and shipyard action buttons align across the lower panels.
- Quantity fields use typed values plus Clear/Max controls, without extra arrow stepper buttons.
- Starport Services updates its displayed capital in-place after buy/sell transactions and uses a centered vessel selector layout.
- Docking uses a Market State dropdown and a Dock / Travel submit button.
- Starport preloads its splash image with a small loading bar and reserves image space to prevent first-open layout collapse.
- TradeHub Settings are available from Foundry Configure Settings and the GM gear button, using one stable settings form with locked compendium dropdowns and optional folder dropdowns.
- Ship Tools are integrated behind a rocket button and bundled as a player macro.
- Combat Damage is integrated behind an explosion button and bundled as a macro, with shield-first damage, hull protection, module AC filtering, fuel scooping, mining damage, and heat-sink thermal carryover handling.
- Combat Damage now displays the Shield Generator as the selected channel while shields are up, matching the shield-first damage rule shown in the transaction result.
- Evenly distributed combat damage now plans a fair split across all AC-eligible modules and reports one aggregated chat line per module hit.
- Heat sinks now prompt players in chat before being consumed; pressing Deploy Heat Sink spends one heat sink and posts the avoided thermal damage.
- Heat sink prompts include a No option; declining keeps the heat sink and resolves the queued overage damage or cargo loss.
- Cargo hold failure uses the same heat-sink choice card style, allowing a heat sink to protect cargo before jettison occurs.
- Combat damage chat cards now list all damage results first and move unresolved heat-sink/cargo choices to the bottom.
- Fuel Scooping damage defaults to and directly damages the Fuel Scoop module, bypassing shields and hull protection.
- Mining Damage defaults to and directly damages the Refinery module before any carryover.
- Mining Damage now falls back to shields, then hull protection, then vulnerable modules when no Refinery is installed.
- Combat Damage includes a Repair Ship tab for Ability Check Repair, paid Full Service Repair, and Make Pristine recalculation.
- Full Service Repair and Replace uses the configured normal HP and shield HP repair costs, bills TradeHub Capital, resyncs derived vehicle stats, and reports the rates in chat.
- Vehicle actors automatically synchronize HP, max HP, AC, module value, jump data, and biography when equipment or weapon modules are added, removed, or edited. This preserves existing damage; use Make Pristine when the craft should be fully restored.
- Only equipped vehicle equipment and weapon modules contribute HP, max HP, AC, shields, jump data, pristine totals, repairs, and combat damage targeting.
- HyperDrive jump distance is read from the HyperDrive item's Custom Label, falling back to item text or tier defaults only when needed.
- Dock / Travel can optionally broadcast a configured sound effect to all players.
- Market price/profit columns use smart opportunity sorting for buy and sell pages.
- Repairs can price normal HP and shield generator HP with separate settings.
- Repairs are staged like Supply Restock, with running repair total, remaining capital, and a Confirm button before changes apply.
- Repair rows preview the restored green HP bar immediately when selected and return to the damaged bar when cleared; Confirm now closes the active repair window without reopening another copy.
- Confirmed repairs resync the vehicle actor HP to the combined current HP of all repaired modules.
