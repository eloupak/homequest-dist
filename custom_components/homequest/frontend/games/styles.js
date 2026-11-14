export const CSS = `
:host { display: block; position: relative; height: 100vh; height: 100dvh; overflow: hidden; background: #1c1a2e; color: #f3ecd8; font-family: system-ui, sans-serif; }
.bar { position: absolute; top: 0; left: 0; right: 0; height: 52px; display: flex; align-items: center; gap: 10px; padding: 0 8px; background: #2a2742; }
.bar b { font-size: 16px; }
.bar .stat { margin-left: auto; font-size: 12px; opacity: .75; }
.body { position: absolute; top: 52px; left: 0; right: 0; bottom: 0; overflow: auto; }
button { font: inherit; }
.btn { background: #e0b040; color: #2a1d05; border: 0; border-radius: 10px; padding: 12px 18px; font-weight: 700; font-size: 16px; min-height: 44px; }
.btn.ghost { background: #3a3658; color: #f3ecd8; }
.btn:disabled { opacity: .45; }
.lobby { max-width: 560px; margin: 0 auto; padding: 16px; display: flex; flex-direction: column; gap: 14px; }
.card { background: #2a2742; border-radius: 14px; padding: 14px; }
.card h2 { margin: 0 0 8px; font-size: 18px; }
.muted { opacity: .7; font-size: 13px; }
.pl { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px solid #3a3658; }
.pl:last-child { border: 0; }
.pl .nm { flex: 1; font-weight: 700; }
.row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
select, input { font: inherit; padding: 10px; border-radius: 8px; border: 1px solid #5a5680; background: #1c1a2e; color: #f3ecd8; min-height: 44px; }
.dg { position: absolute; inset: 0; display: flex; flex-direction: column; gap: 6px; padding: 6px; touch-action: manipulation; user-select: none; -webkit-user-select: none; }
.dg-top { display: flex; align-items: center; gap: 10px; min-height: 30px; }
.hpbar { flex: 1; height: 16px; border-radius: 8px; background: #3a3658; overflow: hidden; }
.hpbar i { display: block; height: 100%; background: #6fc06a; transition: width .2s; }
.hpbar.low i { background: #d0603a; }
.dg-dbg { font-size: 11px; opacity: .7; white-space: pre-wrap; }
.dg-lanes { display: flex; flex-direction: column; gap: 8px; }
.dg-hint { text-align: center; font-size: 14px; opacity: .8; padding: 6px; }
.lane { position: relative; flex: none; height: clamp(64px, 11vh, 96px); background: #34305a; border-radius: 10px; overflow: hidden; }
.lane.own { height: clamp(150px, 30vh, 230px); background: #3d3868; outline: 2px solid #e0b040; }
.lane .zone { position: absolute; top: 0; bottom: 0; background: rgba(224, 176, 64, .22); border-left: 2px dashed rgba(224, 176, 64, .7); pointer-events: none; }
.lane .wall { position: absolute; right: 0; top: 0; bottom: 0; width: 26px; background: repeating-linear-gradient(0deg, #7a5a3a 0 14px, #6a4c30 14px 16px); border-left: 3px solid #4a3220; }
.lane.shake .wall { animation: dg-shake .25s; }
.lane .lbl { position: absolute; left: 8px; top: 4px; font-size: 12px; font-weight: 700; opacity: .85; pointer-events: none; }
.hero { position: absolute; right: 28px; bottom: 0; height: 100%; aspect-ratio: 1 / 1; pointer-events: none; transform-origin: 70% 80%; }
.hero.swing { animation: dg-swing .28s ease-out; }
.hero .guest { position: absolute; inset: 18%; border-radius: 50%; background: #8a86b8; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 22px; }
.orc { position: absolute; bottom: 8%; height: 46%; aspect-ratio: 1 / 1; border-radius: 45% 45% 35% 35%; background: #5aa84a; border: 2px solid #2f6a2a; pointer-events: none; will-change: transform, opacity; }
.orc::before, .orc::after { content: ""; position: absolute; top: 28%; width: 16%; height: 16%; border-radius: 50%; background: #fff; box-shadow: inset 0 0 0 3px #222; }
.orc::before { left: 24%; } .orc::after { right: 24%; }
.orc.runner { background: #a8603a; border-color: #6a3a1e; aspect-ratio: 0.8 / 1; }
.hp-cracks { position: absolute; right: 0; top: 0; bottom: 0; width: 26px; background: rgba(0,0,0,.0); pointer-events: none; }
.over { position: absolute; inset: 0; z-index: 7; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; background: rgba(20, 18, 40, .55); pointer-events: none; text-align: center; }
.over.res { background: rgba(20, 18, 40, .82); pointer-events: auto; }
.over .big { font-size: 96px; font-weight: 900; color: #e0b040; }
.over .res-t { font-size: 30px; font-weight: 800; }
@keyframes dg-swing { 0% { transform: rotate(0) translateX(0); } 40% { transform: rotate(-38deg) translateX(-14px); } 100% { transform: rotate(0) translateX(0); } }
@keyframes dg-shake { 0%, 100% { transform: translateX(0); } 30% { transform: translateX(4px); } 60% { transform: translateX(-3px); } }
@media (prefers-reduced-motion: reduce) { .hero.swing, .lane.shake .wall { animation: none; } }
`;

export const CSS2 = `
.g2 { position: absolute; inset: 0; display: flex; flex-direction: column; gap: 4px; padding: 4px 6px 6px; touch-action: manipulation; user-select: none; -webkit-user-select: none; }
.g2-win { pointer-events: auto; min-height: 24px; padding: 2px 10px; font-size: 13px; background: #c2413b; color: #fff; }
.g2-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 26px; font-size: 14px; font-weight: 700; }
.g2-pl { white-space: nowrap; }
.g2-names { flex: 1 1 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.g2-wave { flex: 0 1 auto; display: flex; flex-direction: column; align-items: center; gap: 2px; white-space: nowrap; }
.g2-wbar { display: block; width: 100%; min-width: 90px; height: 4px; border-radius: 2px; background: rgba(200, 190, 210, .35); overflow: hidden; }
.g2-wbar-in { display: block; height: 100%; width: 0; background: #e0b040; transition: width .3s; }
.g2-ann { position: absolute; left: 0; right: 0; top: 30%; z-index: 5; text-align: center; font-size: 40px; font-weight: 900; color: #fff; text-shadow: 0 2px 6px rgba(0,0,0,.7); pointer-events: none; opacity: 0; }
.g2-ann.on { animation: g2-ann 1.8s ease-out forwards; }
@keyframes g2-ann { 0% { opacity: 0; transform: scale(.7); } 15% { opacity: 1; transform: scale(1.05); } 25% { transform: scale(1); } 80% { opacity: 1; } 100% { opacity: 0; } }
.g2-gems { flex: 1 1 0; justify-content: flex-end; display: flex; align-items: center; gap: 6px; font-size: 18px; }
.g2-rtt { font-size: 11px; font-weight: 600; opacity: .7; margin-left: 4px; }
.g2-gems.pop { animation: g2-pop .35s ease-out; }
.gem { display: inline-block; width: 14px; height: 14px; background: linear-gradient(135deg, #9ff0ff, #3aa6e0); transform: rotate(45deg) scale(.8); border-radius: 3px; box-shadow: 0 0 6px rgba(120, 220, 255, .7); }
.gem.big { width: 22px; height: 22px; margin-right: 10px; vertical-align: middle; }
/* the look of the scene, to tune in one place: the background picture (no dimming: as bright as the stage scenes of the Quest, #101),
   the dark outline of the figures and their shadow on the ground */
.g2-scene { --g2-bg-filter: none; --g2-outline: drop-shadow(1px 0 0 #2a1808) drop-shadow(-1px 0 0 #2a1808) drop-shadow(0 1px 0 #2a1808) drop-shadow(0 -1px 0 #2a1808);
  --g2-foot-shadow: radial-gradient(closest-side, rgba(20, 12, 4, .55), transparent); }
.g2-scene { --hero: 90px; --ground: 60px; position: relative; flex: 1 1 auto; min-height: 0; border-radius: 12px; overflow: hidden; background: linear-gradient(#7fb7e6 0%, #cfe7f5 62%, #cfe7f5 100%); }
.g2-hills { position: absolute; left: 0; right: 0; bottom: var(--ground); height: 34%; background: radial-gradient(ellipse 60% 100% at 18% 100%, #4f8a58 60%, transparent 61%), radial-gradient(ellipse 55% 100% at 80% 100%, #3f7a4c 60%, transparent 61%); }
.g2-ground { position: absolute; left: 0; right: 0; bottom: 0; height: var(--ground); background: linear-gradient(#6aa65a, #4d8a46); border-top: 3px solid #3d7438; }
.g2-fort { position: absolute; z-index: 1; max-width: none; pointer-events: none; user-select: none; filter: var(--g2-bg-filter); }   /* the fortress (size and place set by measure() / fortFit: covers the scene, foot on the ground line) */
.g2 > .over:empty { background: none; }   /* the overlay of the countdown / result is in the DOM all game long: empty it must not veil the scene (#101) */
.g2-ground { z-index: 2; }
.g2-scene:has(.g2-fort[data-ok]) .g2-hills, .g2-scene:has(.g2-fort[data-ok]) .g2-ground { display: none; }   /* the picture has its own ground */
.g2-hero.gone { display: none; }
.g2-hero.out .g2-hflip { opacity: .4; filter: grayscale(1) var(--g2-outline); transform-origin: 50% 100%; }
.g2-hero { position: absolute; left: 0; bottom: var(--ground); width: var(--hero); height: var(--hero); pointer-events: none; z-index: 3; will-change: transform; }
.g2-hflip { position: absolute; inset: 0; transform-origin: 50% 100%; filter: var(--g2-outline); }
.g2-hero::before, .g2-orcbox::before { content: ""; position: absolute; left: 22%; right: 22%; bottom: -5px; height: 10px; background: var(--g2-foot-shadow); pointer-events: none; }   /* the shadow under the feet */
.g2-hflip[data-side="r"] { transform: scaleX(-1); }   /* the drawn hero holds the weapon on the viewer's left: that is the outer side for the left lane, so only the right lane is mirrored */
.g2-hflip .hq-hero, .g2-hflip .guest { position: absolute; inset: 0; width: 100%; height: 100%; }
.g2-hero .guest { inset: 12%; width: auto; height: auto; border-radius: 50%; background: #8a86b8; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 22px; }
.g2-prev { position: absolute; right: 6px; bottom: 4px; z-index: 4; font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 8px; background: rgba(42,39,66,.55); color: #fff; pointer-events: none; }
.g2-hero .lbl { position: absolute; left: 0; right: 0; top: -14px; text-align: center; font-size: 11px; font-weight: 800; color: #2a2742; text-shadow: 0 0 3px #fff, 0 0 2px #fff, 0 0 1px #fff; }
.g2-hero.own .lbl { color: #5a3a00; }
.g2-hero.stagger .g2-hflip { animation: g2-wobble .35s infinite; filter: saturate(.5) brightness(.9) var(--g2-outline); }
.g2-hero.held .g2-hflip { animation: g2-struggle .16s infinite; }
.g2-slash { position: absolute; top: 14%; width: 70%; height: 70%; border-radius: 50%; border: 6px solid transparent; border-top-color: rgba(255, 255, 255, .95); opacity: 0; }
.g2-hero:has(.g2-hflip[data-side="l"]) .g2-slash { left: -40%; transform: rotate(-30deg); }
.g2-hero:has(.g2-hflip[data-side="r"]) .g2-slash { right: -40%; transform: rotate(30deg); }
.g2-slash.on { animation: g2-slash .26s ease-out; }
.g2-orcbox { position: absolute; left: 0; bottom: var(--ground); z-index: 3; pointer-events: none; will-change: transform; }
.g2-orc { position: absolute; inset: 0; --skin: #5aa84a; --skin-d: #2f6a2a; filter: var(--g2-outline); }
.g2-orc[data-side="l"] { transform: scaleX(1); }
.g2-orc[data-side="r"] { transform: scaleX(-1); }
.g2-orc.t-armored { --skin: #4a8a40; --skin-d: #28521f; }
.g2-orc.t-scout { --skin: #8ac24a; --skin-d: #4b7a22; }
.g2-orc.t-thrower { --skin: #8a9a3a; --skin-d: #566016; }
.g2-orc.t-grabber { --skin: #7a6a3a; --skin-d: #4a3e1c; }
.g2-orc .body { position: absolute; left: 10%; right: 10%; top: 12%; bottom: 0; background: var(--skin); border: 2px solid var(--skin-d); border-radius: 46% 46% 30% 30%; }
.g2-orc .eye { position: absolute; left: 52%; top: 30%; width: 22%; height: 16%; border-radius: 50%; background: #fff; box-shadow: inset -3px 0 0 #222; }
.g2-orc .hm, .g2-orc .sh { display: none; position: absolute; }
.g2-orc.t-armored .hm { display: block; left: 12%; right: 12%; top: 4%; height: 26%; background: #8b8f99; border: 2px solid #4f535b; border-radius: 50% 50% 8% 8%; }
.g2-orc.t-armored.nohelmet .hm { display: none; }
.g2-orc.t-armored .sh { display: block; right: -14%; top: 40%; width: 34%; height: 42%; background: #9b6a3a; border: 2px solid #5a3a1c; border-radius: 40%; }
.g2-orc .wp { position: absolute; right: -22%; top: 28%; width: 16%; height: 58%; background: #7a4e28; border: 2px solid #4a2e14; border-radius: 40% 40% 20% 20%; transform-origin: 50% 90%; transition: transform .1s; }
.g2-orc.t-scout .wp { width: 8%; height: 40%; background: #cfd4dc; border-color: #6a707a; }
.g2-orc.t-thrower .wp { width: 22%; height: 22%; border-radius: 50%; background: #8a8a8a; top: 20%; right: -26%; }
.g2-orc.t-grabber .wp { display: none; }
.g2-orc .arm { display: none; position: absolute; right: -26%; top: 36%; width: 40%; height: 16%; background: var(--skin); border: 2px solid var(--skin-d); border-radius: 8px; }
.g2-orc.t-grabber .arm { display: block; }
.g2-orc[data-pose="walk-a"] .body { transform: rotate(-3deg); }
.g2-orc[data-pose="walk-b"] .body { transform: rotate(3deg) translateY(-2%); }
.g2-orc[data-pose="raise"] .wp { transform: rotate(-70deg); }
.g2-orc[data-pose="raise"] .arm { transform: rotate(-35deg) translateY(-30%); }
.g2-orc[data-pose="ready"] .wp, .g2-orc[data-pose="walk-a"] .wp { transform: rotate(8deg); }
.g2-orc[data-pose="walk-b"] .wp { transform: rotate(-6deg); }
.g2-orc[data-pose="stun"] .body { transform: rotate(-14deg) scale(.92, 1.04); filter: brightness(1.4); }
.g2-orc[data-pose="hold"] .arm { transform: translateX(-18%); }
.g2-orc[data-pose="flee"] { animation: g2-flee .9s ease-in forwards; }
.g2-orc[data-pose="flee"] .body { transform: rotate(18deg); }
.g2-orc.art .spr { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; user-select: none; }   /* a sprite set: the canvas of the hero picture (feet on the same row) */
.g2-orc.art .spr.on { opacity: 1; }
.g2-orc.art[data-pose="stun"] .spr.on { filter: brightness(1.15); }
.g2-orc .stars { display: none; position: absolute; left: 20%; top: -12%; width: 60%; height: 20%; background: radial-gradient(circle, #ffd84a 0 28%, transparent 30%) 0 50% / 33% 100% repeat-x; animation: g2-spin .5s linear infinite; }
.g2-orc[data-pose="stun"] .stars, .g2-orc[data-pose="flee"] .stars { display: block; }
.g2-orc.art .stars { left: 38%; width: 34%; top: 28%; height: 9%; }
.g2-orc.art .gemdrop { left: 44%; top: 34%; width: 12%; height: 12%; }
.g2-orc .gemdrop { display: none; position: absolute; left: 36%; top: 10%; width: 22%; height: 22%; background: linear-gradient(135deg, #9ff0ff, #3aa6e0); transform: rotate(45deg); border-radius: 3px; box-shadow: 0 0 8px rgba(120, 220, 255, .9); }
.g2-orc[data-pose="flee"] .gemdrop { display: block; animation: g2-gem 1s ease-out forwards; }
.g2-stone { position: absolute; left: 0; bottom: var(--ground); width: 14px; height: 14px; border-radius: 40%; background: #8a8a8a; border: 2px solid #4a4a4a; z-index: 4; will-change: transform; }
.g2-ctl { display: flex; gap: 10px; flex: 0 0 76px; margin-bottom: max(2px, env(safe-area-inset-bottom)); }   /* portrait: a low strip under the scene */
.g2-ctl.watch { flex-basis: 32px; align-items: center; justify-content: center; opacity: .8; }
.g2-btn { position: relative; flex: 1; border: 0; border-radius: 16px; font-size: 22px; font-weight: 900; color: #2a1d05; touch-action: manipulation; box-shadow: 0 4px 0 rgba(0, 0, 0, .35); }
.g2-btn.swing { background: #e0b040; }
.g2-btn.jump { background: #6fc0e8; }
.g2-btn:active { transform: translateY(4px); box-shadow: 0 1px 0 rgba(0, 0, 0, .35); }
.g2-dbg { font-size: 11px; opacity: .7; white-space: pre-wrap; }
/* landscape (the main way to play): the scene over the whole panel, a thin HUD over its top edge, Švih / Skok as round see-through buttons in the
   bottom corners over the ground strip (measure() makes the strip high enough to keep them below the feet). The panel bar is hidden (:host([playing])). */
@media (orientation: landscape) {
  :host([playing]) .bar { display: none; }
  :host([playing]) .body { top: 0; }
  .g2 { padding: 0; gap: 0; }
  .g2-scene { position: absolute; inset: 0; border-radius: 0; }
  .g2-top { position: absolute; top: 0; left: 0; right: 0; z-index: 6; min-height: 26px; padding: 0 max(10px, env(safe-area-inset-right)) 0 max(10px, env(safe-area-inset-left)); background: rgba(28, 26, 46, .5); color: #fff; pointer-events: none; }
  .g2-gems { font-size: 16px; }
  .g2-ctl { position: absolute; left: 0; right: 0; bottom: 0; height: 0; margin: 0; z-index: 6; pointer-events: none; }
  .g2-btn { position: absolute; bottom: max(10px, env(safe-area-inset-bottom)); width: 80px; height: 80px; flex: none; border-radius: 50%; font-size: 16px; pointer-events: auto; opacity: .82; border: 3px solid rgba(255, 255, 255, .7); }
  .g2-btn::after { content: ""; position: absolute; inset: -14px; border-radius: 50%; }   /* a bigger touch area than the drawn button */
  .g2-btn.swing { left: max(14px, env(safe-area-inset-left)); }
  .g2-btn.jump { right: max(14px, env(safe-area-inset-right)); }
  .g2-prev { right: auto; left: 50%; bottom: max(6px, env(safe-area-inset-bottom)); transform: translateX(-50%); }   /* between the round buttons, not under one */
  .g2-ctl.watch { height: auto; bottom: 8px; left: 50%; right: auto; transform: translateX(-50%); padding: 4px 10px; border-radius: 10px; background: rgba(28, 26, 46, .6); }
  .g2-dbg { position: absolute; top: 28px; left: 8px; z-index: 6; pointer-events: none; color: #fff; text-shadow: 0 0 2px #000; }
}
@media (orientation: landscape) and (max-height: 340px) { .g2-btn { width: 72px; height: 72px; } }
.g2-pot { font-size: 20px; font-weight: 800; }
@keyframes g2-pop { 0% { transform: scale(1); } 40% { transform: scale(1.35); } 100% { transform: scale(1); } }
@keyframes g2-wobble { 0%, 100% { transform: rotate(-5deg); } 50% { transform: rotate(5deg); } }
@keyframes g2-struggle { 0%, 100% { translate: -3px 0; } 50% { translate: 3px 0; } }
@keyframes g2-slash { 0% { opacity: 1; scale: .6; } 100% { opacity: 0; scale: 1.15; } }
@keyframes g2-flee { 0% { opacity: 1; } 80% { opacity: 1; } 100% { opacity: 0; } }
@keyframes g2-gem { 0% { translate: 0 0; opacity: 1; } 100% { translate: 0 -90%; opacity: 0; } }
@keyframes g2-spin { to { background-position-x: 100%; } }
@media (prefers-reduced-motion: reduce) { .g2-hero.stagger .g2-hflip, .g2-hero.held .g2-hflip, .g2-slash.on, .g2-orc .stars { animation: none; } }
`;
