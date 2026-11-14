/* HomeQuest theme: dark fantasy parchment. Own backgrounds, independent of the HA theme. */

export const CSS = `
:host {
  --bg: var(--hq-night, #1C1A2E);
  --bg2: var(--hq-night-2, #2A2742);
  --panel: var(--hq-night-2, #2A2742);
  --stage: #3a3656;
  --parch: var(--hq-parchment, #F3E6C8);
  --parch-dark: var(--hq-parchment-dark, #E2CC9C);
  --ink: var(--hq-ink, #2B1D14);
  --ink-soft: #5b4630;
  --gold: var(--hq-gold, #E8B33A);
  --gold-dark: var(--hq-gold-deep, #B7812A);
  --green: var(--hq-forest, #3E7D4F);
  --green-dark: #2d5e3b;
  --red: var(--hq-crimson, #C2413B);
  --blue: var(--hq-sky, #4C8DCB);
  --purple: var(--hq-royal, #7B4FB3);
  --common: var(--hq-rarity-common, #9A8F7E);
  --tap: 56px;
  display: block;
  position: relative;
  height: 100vh;
  height: 100dvh;
  max-height: 100%;                    /* never taller than the space HA gives the panel: the menu below stays on screen */
  overflow: hidden;
  overscroll-behavior: none;
  color: var(--hq-text-light, #FBF5E6);
  background: radial-gradient(ellipse at top, #34305a 0%, var(--bg) 60%);
  font-family: var(--hq-font-body, "Trebuchet MS", system-ui, sans-serif);
  font-size: 17px;
  line-height: 1.25;
  -webkit-tap-highlight-color: transparent;
}
/* On a phone (HA says narrow) the panel is pinned to the visible area: as tall as the visual viewport (set by the panel in --hq-vh), so the
   menu is not pushed under the bars of iOS (100vh is the LARGE viewport there) and the page behind it cannot scroll away. */
:host([fixed]) { position: fixed; left: 0; top: 0; width: 100%; height: var(--hq-vh, 100dvh); max-height: none; z-index: 0; }
* { box-sizing: border-box; }
.app { position: absolute; inset: 0; display: flex; flex-direction: column; overflow: hidden; }
h1, h2, h3 { font-family: var(--hq-font-heading, Georgia, serif); font-weight: 700; margin: 0; }
button { font: inherit; color: inherit; cursor: pointer; border: 0; }
ha-icon { --mdc-icon-size: 28px; }
.coin { width: 1.15em; height: 1.15em; vertical-align: -0.2em; }
.coin-wrap { display: inline-block; line-height: 1; }

/* ---- layout ---- */
header {
  flex: none; display: flex; align-items: center; gap: 10px; padding: calc(8px + env(safe-area-inset-top, 0px)) 12px 8px;
  background: linear-gradient(#34305a, var(--hq-night-2, #2A2742)); border-bottom: 3px solid var(--gold-dark);
  min-height: 56px; flex-wrap: wrap; row-gap: 6px;   /* the child switch moves to its own row when it does not fit (narrow phone) */
}
header h1 { font-size: 22px; color: var(--gold); letter-spacing: 0.5px; text-shadow: 0 2px 0 #000a; }
.titlegroup { display: flex; flex-direction: column; justify-content: center; min-width: 0; flex: 0 1 auto; line-height: 1.1; }
.playername { display: block; min-width: 0; max-width: 44vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--parch); font-weight: 700; font-size: 13px; margin-top: 1px; }
.envbadge { flex: none; background: var(--red); color: #fff; font-weight: 800; font-size: 15px; letter-spacing: 1.5px; padding: 3px 10px; border-radius: 8px; border: 2px solid #fff6; text-shadow: none; }
.envbadge[data-env="clean"] { background: #2563eb; }   /* trial install: blue, so it is never mistaken for TEST */
header ha-menu-button { color: var(--parch); }
.spacer { flex: 1; }
.kidswitch { display: flex; gap: 6px; flex: none; margin-left: auto; }
.soundbtn { display: inline-flex; align-items: center; justify-content: center; width: 44px; min-width: 44px; padding: 0; margin: 0 6px; flex: none; }
.soundbtn[aria-pressed="false"] { opacity: 0.6; }
/* hidden layout overview (triple tap on the title, or ?debug=layout): a screenshot from the phone tells how the visible area is measured */
.layoutdebug { position: absolute; left: 6px; right: 6px; top: 70px; z-index: 90; background: #000f; color: #9fff9f; font: 11px/1.35 ui-monospace, Menlo, monospace; padding: 8px 10px; border-radius: 8px; white-space: pre-wrap; word-break: break-all; pointer-events: auto; }
.layoutdebug b { color: #ffd34d; }
.chip {
  min-height: 44px; padding: 6px 14px; border-radius: 22px; background: var(--panel);
  border: 2px solid var(--gold-dark); color: var(--parch); font-weight: bold;
}
.chip[aria-pressed="true"] { background: var(--gold); color: var(--ink); }
main { flex: 1; overflow-y: auto; padding: 14px 12px 24px; -webkit-overflow-scrolling: touch; }
nav {
  flex: none; display: flex; background: var(--hq-night-2, #2A2742); border-top: 3px solid var(--gold-dark);
  padding-bottom: max(env(safe-area-inset-bottom, 0px), var(--hq-safe-bottom, 0px));
}
nav button {
  flex: 1; min-height: 64px; background: transparent; color: var(--parch-dark);
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
  font-size: 13px; position: relative;
}
nav button[aria-current="page"] { color: var(--gold); background: #34305a; }
nav button ha-icon { --mdc-icon-size: 28px; }
.badge {
  position: absolute; top: 6px; right: calc(50% - 26px); min-width: 20px; height: 20px; padding: 0 5px;
  border-radius: 10px; background: var(--red); color: #fff; font-size: 12px; font-weight: bold;
  display: flex; align-items: center; justify-content: center;
}

/* ---- cards & buttons ---- */
.card {
  background: var(--parch); color: var(--ink); border-radius: 14px; padding: 12px;
  border: 3px solid var(--parch-dark); box-shadow: 0 3px 0 #0006;
}
.card + .card, .card + .section, .section + .card { margin-top: 12px; }
.section { margin-top: 18px; }
.section > h2 { font-size: 20px; color: var(--gold); margin-bottom: 8px; }
.btn {
  min-height: var(--tap); padding: 10px 18px; border-radius: 14px; font-weight: bold; font-size: 18px;
  background: var(--green); color: #fff; border-bottom: 4px solid var(--green-dark);
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
}
.btn:active { transform: translateY(2px); border-bottom-width: 2px; }
.btn.gold { background: var(--gold); color: var(--ink); border-bottom-color: var(--gold-dark); }
.btn.red { background: var(--red); border-bottom-color: #8a2d28; }
.btn.ghost { background: transparent; color: var(--parch); border: 2px solid var(--parch-dark); }
.card .btn.ghost { color: var(--ink); border-color: var(--ink-soft); }
.btn[disabled] { opacity: 0.5; filter: grayscale(0.6); pointer-events: none; }
.btn.block { width: 100%; }
.muted { color: var(--ink-soft); }
.soft { color: var(--parch-dark); }
.row { display: flex; align-items: center; gap: 10px; }
.wrap { flex-wrap: wrap; }
.grow { flex: 1; min-width: 0; }
.big { font-size: 22px; font-weight: bold; }
.empty { padding: 20px; text-align: center; color: var(--parch-dark); }

/* ---- hero header / progress ---- */
.herohead { display: flex; align-items: center; gap: 12px; }
.avatar { width: 84px; height: 78px; border-radius: 12px; background: var(--stage); border: 3px solid var(--gold-dark); overflow: hidden; flex: none; }
.avatar canvas { width: 100%; height: 100%; image-rendering: pixelated; display: block; }
.herohead h2 { font-size: 22px; color: var(--ink); }
.coins { font-size: 26px; font-weight: bold; color: var(--ink); display: inline-flex; align-items: center; gap: 6px; }
.coins.bump { animation: bump 0.7s ease; }
@keyframes bump { 0% { transform: scale(1); } 30% { transform: scale(1.35); } 100% { transform: scale(1); } }
.progress { margin-top: 10px; }
.progress .bar { height: 16px; border-radius: 8px; background: #0003; overflow: hidden; border: 2px solid var(--ink-soft); }
.progress .bar > i { display: block; height: 100%; background: linear-gradient(var(--gold), var(--gold-dark)); transition: width 0.5s; }
.progress .label { font-size: 15px; margin-top: 4px; color: var(--ink-soft); font-weight: bold; }

/* ---- quests ---- */
.quest { display: flex; align-items: center; gap: 12px; min-height: 80px; }
.quest .qicon {
  width: 52px; height: 52px; border-radius: 50%; background: var(--gold); color: var(--ink);
  display: flex; align-items: center; justify-content: center; flex: none; border: 3px solid var(--gold-dark);
}
.quest .qicon ha-icon { --mdc-icon-size: 30px; }
.quest .qname { font-size: 19px; font-weight: bold; color: var(--ink); }
.quest .qreward { color: var(--ink-soft); font-weight: bold; margin-top: 2px; }
.quest.approved { opacity: 0.8; background: #cfe2b4; border-color: #9cc27a; }
.quest.approved .qicon { background: var(--green); color: #fff; border-color: var(--green-dark); }
.quest .qnote { color: var(--ink-soft); font-size: 14px; line-height: 1.25; margin-top: 2px; }
.holiday { display: flex; align-items: center; gap: 8px; justify-content: center; margin-top: 12px; padding: 6px 12px; border-radius: 12px; background: #d9eefc; color: #1f4e6b; font-weight: bold; border: 2px solid #8fc4e8; }
.status { display: flex; align-items: center; gap: 6px; font-weight: bold; font-size: 15px; text-align: center; }
.status.pending { color: #8a5f10; }
.status.done { color: var(--green-dark); }
.hint { text-align: center; padding: 22px 12px; font-size: 20px; color: var(--gold); font-family: var(--hq-font-heading, Georgia, serif); }

/* ---- hero screen ---- */
.stagebox { display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 12px; }
.slotcol { display: flex; flex-direction: column; gap: 10px; }
.slot {
  width: 64px; min-height: 76px; border-radius: 12px; background: var(--panel); border: 3px solid var(--parch-dark);
  color: var(--parch); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; padding: 4px 2px;
  font-size: 12px;
}
.slot.has { background: var(--parch); color: var(--ink); }
.slot .thumb { width: 44px; height: 44px; }
.slot ha-icon { --mdc-icon-size: 30px; opacity: 0.7; }
.herostage { background: var(--stage); border: 4px solid var(--gold-dark); border-radius: 18px; padding: 10px; }
.herostage canvas { display: block; width: clamp(120px, calc(100vw - 230px), 200px); height: clamp(120px, calc(100vw - 230px), 200px); image-rendering: pixelated; }

/* ---- grids ---- */
.seg { display: flex; background: var(--panel); border-radius: 14px; padding: 4px; gap: 4px; border: 2px solid var(--gold-dark); }
.seg button { flex: 1; min-height: 48px; border-radius: 10px; background: transparent; color: var(--parch); font-weight: bold; font-size: 17px; }
.seg button[aria-pressed="true"] { background: var(--gold); color: var(--ink); }
.chips { display: flex; gap: 8px; overflow-x: auto; padding: 10px 0 4px; }
.chips .chip { flex: none; }
.grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-top: 12px; }
.icard {
  position: relative; background: var(--parch); color: var(--ink); border-radius: 14px; padding: 10px 8px; text-align: center;
  border: 4px solid var(--common); display: flex; flex-direction: column; align-items: center; gap: 4px; min-height: 148px;
}
.icard.r-common { border-color: var(--hq-rarity-common, #9A8F7E); }
.icard.r-rare { border-color: var(--hq-rarity-rare, #3E8EDB); box-shadow: 0 0 10px color-mix(in srgb, var(--hq-rarity-rare, #3E8EDB) 65%, transparent); }
.icard.r-epic { border-color: var(--hq-rarity-epic, #9B59D6); box-shadow: 0 0 12px color-mix(in srgb, var(--hq-rarity-epic, #9B59D6) 75%, transparent), inset 0 0 0 2px var(--gold); }
.icard.r-legendary { border-color: var(--hq-rarity-legendary, #F0A93A); box-shadow: 0 0 16px color-mix(in srgb, var(--hq-rarity-legendary, #F0A93A) 85%, transparent), inset 0 0 0 3px #fff4; }
.icard .thumb { width: 64px; height: 64px; image-rendering: pixelated; background: #0001; border-radius: 10px; }
.icard .iname { font-weight: bold; font-size: 16px; }
.icard .iprice { font-weight: bold; color: var(--ink-soft); }
.icard.locked { opacity: 0.6; }
.icard .tag {
  position: absolute; top: 6px; right: 6px; font-size: 12px; font-weight: bold; padding: 2px 8px; border-radius: 10px;
  background: var(--green); color: #fff;
}
.icard .tag.lock { background: #555; }
.swatches { display: flex; flex-wrap: wrap; gap: 10px; }
.swatch { width: 52px; height: 52px; border-radius: 50%; border: 4px solid #0006; }
.swatch[aria-pressed="true"] { border-color: var(--gold); box-shadow: 0 0 0 3px var(--ink); }
.choice {
  background: var(--parch); color: var(--ink); border: 4px solid var(--parch-dark); border-radius: 14px;
  padding: 6px; display: flex; flex-direction: column; align-items: center; gap: 2px; min-height: 120px; font-weight: bold;
}
.choice[aria-pressed="true"] { border-color: var(--gold); box-shadow: 0 0 0 3px var(--gold-dark); background: #fff3cf; }
.choice canvas { width: 96px; height: 90px; margin-bottom: 4px; image-rendering: pixelated; background: var(--stage); border-radius: 10px; }
.field {
  width: 100%; min-height: var(--tap); border-radius: 12px; border: 3px solid var(--gold-dark); padding: 8px 12px;
  font: inherit; font-size: 20px; background: #fff8e6; color: var(--ink);
}
/* a select's list (#137): a light list whatever theme HA has (a dark color-scheme painted the options dark under ink text), and readable rows
   on hover, keyboard focus and the chosen one; iOS Safari shows its own picker and ignores these */
select.field { color-scheme: light; }
select.field option { background: #fff8e6; color: var(--ink); }
select.field option:hover, select.field option:focus, select.field option:checked { background: var(--gold); color: var(--ink); }
/* a choice of one of a few on a parchment card (Kluk / Holka, #137): the chosen one gold with a tick, the others plain and quiet */
.opt {
  display: inline-flex; align-items: center; gap: 6px; min-height: var(--tap); padding: 6px 18px; border-radius: 999px;
  background: transparent; border: 2px solid #2b1d1455; color: var(--ink-soft); font-weight: 600;
}
.opt[aria-pressed="true"] { background: var(--gold); border-color: var(--gold-dark); color: var(--ink); font-weight: 800; box-shadow: 0 0 0 2px var(--gold-dark); }
.opt[aria-pressed="true"] ha-icon { --mdc-icon-size: 20px; }
.opt:focus-visible { outline: 3px solid var(--gold-dark); outline-offset: 2px; }
.opt[disabled] { opacity: 0.45; cursor: default; }

/* ---- quest giver: Quest tab and intro (scene at the fortress) ---- */
.giver { display: flex; align-items: center; gap: 14px; margin-top: 12px; }
.chapter p { margin: 8px 0 0; line-height: 1.4; }
.questscreen .btn.block { margin-top: 14px; }
.questscreen .btn.replay { justify-content: flex-start; text-align: left; }   /* icon + text from the left (#127) */
/* The scene picture (2:3) always covers its box, centred; the giver is placed in % of the picture, so it stands on the road at every crop. */
.scene-box { position: relative; overflow: hidden; container-type: size; border-radius: 16px; background: #14122a; }
.scene-box.tab { width: 100%; aspect-ratio: 1 / 1.1; border: 3px solid var(--gold-dark); }
.scene-box.full { position: absolute; inset: 0; border-radius: 0; }
.scene { position: absolute; left: 50%; top: 50%; width: max(100cqw, 66.667cqh); aspect-ratio: 2 / 3; transform: translate(-50%, -50%); background: linear-gradient(#7fb4ea 0 45%, #6d8f4e 45% 100%); }
.scene.nobg { background: linear-gradient(#7fb4ea 0 45%, #86a45f 45% 70%, #b49a6a 70% 100%); }
.scene-bg { position: absolute; inset: 0; width: 100%; height: 100%; }
.scene-bg.fade { opacity: 0; transition: opacity 1.3s ease-in-out; }
.scene-bg.fade.in { opacity: 1; }
@media (prefers-reduced-motion: reduce) { .scene-bg.fade { transition: none; } }
/* progress of the fortress */
.prog { height: 10px; border-radius: 6px; background: #0003; overflow: hidden; margin: 8px 0 4px; box-shadow: inset 0 0 0 1px #0002; }
.prog i { display: block; height: 100%; background: linear-gradient(90deg, var(--gold-dark), var(--gold)); border-radius: 6px; transition: width 0.7s ease-out; }
.fortstage h2 { margin-bottom: 2px; }
.fortbar { display: flex; align-items: center; gap: 8px; padding: 4px 14px 5px; background: #00000030; border-bottom: 1px solid #ffffff14; position: relative; cursor: pointer; font-size: 14px; color: var(--hq-text-light, #FBF5E6); }
.fortbar ha-icon { --mdc-icon-size: 20px; color: var(--gold); flex: none; }
.fortbar .ftxt { flex: none; font-weight: 700; letter-spacing: 0.2px; }
.fortbar .prog { flex: 1; margin: 0; height: 7px; background: #ffffff22; }
.fortbar.bump .prog i { animation: hq-pulse 0.9s ease-out 1; }
.fortbar .plus { position: absolute; right: 14px; top: -2px; font-weight: 800; color: var(--gold); text-shadow: 0 1px 3px #000a; animation: hq-plus 1.6s ease-out both; pointer-events: none; }
@keyframes hq-pulse { 0% { filter: brightness(1); } 30% { filter: brightness(1.9) saturate(1.4); } 100% { filter: none; } }
@keyframes hq-plus { 0% { opacity: 0; transform: translateY(8px) scale(0.8); } 20% { opacity: 1; transform: translateY(0) scale(1.15); } 100% { opacity: 0; transform: translateY(-18px) scale(1); } }
@media (prefers-reduced-motion: reduce) { .fortbar.bump .prog i, .fortbar .plus { animation: none; } .prog i { transition: none; } }
.giver-pos { position: absolute; left: var(--gx); top: var(--gy); width: var(--gw); height: var(--gh); transform: translate(-50%, -100%); }
.giver-walk, .giver-bob, .giver-breath { width: 100%; height: 100%; }
.giver-breath { transform-origin: 50% 100%; }
.npc-fig { width: 100%; height: 100%; object-fit: contain; display: block; filter: drop-shadow(0 3px 4px #0006); }
.npc-placeholder { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; border: 3px dashed var(--gold-dark); border-radius: 16px; background: #ffffff33; color: var(--ink); font-size: 14px; text-align: center; padding: 6px; box-sizing: border-box; }
/* motion: walk in (shift + a little bobbing), breathe while standing, walk away after the last paragraph */
.story-overlay[data-state="arriving"] .giver-walk { animation: hq-walk-in 1.4s ease-out both; }
.story-overlay[data-state="arriving"] .giver-bob { animation: hq-bob 0.28s ease-in-out 5 alternate both; }
.story-overlay[data-state="talking"] .giver-breath, .scene-box.idle .giver-breath { animation: hq-breath 3.2s ease-in-out infinite; }
.story-overlay[data-state="leaving"] .giver-walk { animation: hq-walk-out 1s ease-in both; }
.story-overlay[data-state="leaving"] .giver-bob { animation: hq-bob 0.28s ease-in-out 4 alternate both; }
@keyframes hq-walk-in { from { transform: translateX(var(--gstart)); } to { transform: none; } }
@keyframes hq-walk-out { from { transform: none; } to { transform: translateX(var(--gstart)); } }
@keyframes hq-bob { from { transform: translateY(0) rotate(-1.2deg); } to { transform: translateY(-2.5%) rotate(1.2deg); } }
@keyframes hq-breath { 0%, 100% { transform: scaleY(1); } 50% { transform: scaleY(1.018); } }
@media (prefers-reduced-motion: reduce) { .giver-walk, .giver-bob, .giver-breath { animation: none !important; } }
.story-overlay { position: fixed; inset: 0; z-index: 70; background: #14122a; overflow: hidden; }
/* rebuilding of the fortress (views/transition.js): the old picture darkens, dust + splinters, hammer blows (shaking), the new one is uncovered from the bottom, the windows brighten */
.rebuild-stage { position: absolute; inset: 0; animation: hq-shake 3.2s linear 0.5s both; }
.rebuild .scene-bg { object-fit: cover; }
.rebuild .scene-bg.old { animation: hq-darken 0.9s ease-out both; }
/* the new picture is uncovered by a feathered mask (a tall gradient strip slid over it: ~9% of the height of soft edge), never by a hard cut */
.rebuild .scene-bg.new { -webkit-mask-image: linear-gradient(to top, #000 0%, #000 48%, transparent 51%); mask-image: linear-gradient(to top, #000 0%, #000 48%, transparent 51%); -webkit-mask-size: 100% 300%; mask-size: 100% 300%; -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat; -webkit-mask-position: 0 22%; mask-position: 0 22%; animation: hq-uncover 2.5s cubic-bezier(.45,.05,.4,1) 1.1s forwards, hq-windows 1.1s ease-in-out 3.5s both; }
.rebuild .edge-dust { position: absolute; left: -5%; right: -5%; height: 26%; top: 110%; pointer-events: none; opacity: 0; animation: hq-edge 2.5s cubic-bezier(.45,.05,.4,1) 1.1s both; filter: blur(5px);
  background: radial-gradient(ellipse 18% 38% at 8% 50%, #e2d3b4dd, #e2d3b400), radial-gradient(ellipse 22% 46% at 27% 42%, #d6c5a2cc, #d6c5a200), radial-gradient(ellipse 18% 40% at 46% 58%, #e8dbbfdd, #e8dbbf00), radial-gradient(ellipse 24% 46% at 66% 44%, #d9c9a8cc, #d9c9a800), radial-gradient(ellipse 18% 38% at 88% 54%, #e2d3b4dd, #e2d3b400); }
.rebuild .edge-dust::after { content: ""; position: absolute; inset: 0; filter: blur(0); background: radial-gradient(circle at 12% 30%, #5c3f1c 0 2px, #0000 3px), radial-gradient(circle at 34% 64%, #5c3f1c 0 2.5px, #0000 3.5px), radial-gradient(circle at 57% 36%, #6b4a24 0 2px, #0000 3px), radial-gradient(circle at 73% 70%, #5c3f1c 0 3px, #0000 4px), radial-gradient(circle at 90% 40%, #6b4a24 0 2px, #0000 3px); animation: hq-edge-chips 0.5s linear infinite; }
.rebuild .dust-layer, .rebuild .debris-layer, .rebuild .glow { position: absolute; inset: 0; pointer-events: none; }
.rebuild .dust { position: absolute; left: var(--x); bottom: var(--b); width: calc(var(--s) * 1.6); height: calc(var(--s) * 1.6); margin-left: calc(var(--s) * -0.8); border-radius: 50%; background: radial-gradient(circle, #e2d3b4dd 0%, #cdbb94b0 42%, #cdbb9400 72%); opacity: 0; animation: hq-dust 3.6s ease-out var(--d) both; }
.rebuild .chip-debris { position: absolute; left: var(--x); top: 38%; width: var(--w); height: calc(var(--w) * 2.4); background: #5c3f1c; border-radius: 1px; opacity: 0; animation: hq-debris 1.3s ease-in var(--d) both; }
.rebuild .glow { background: radial-gradient(circle at 50% 55%, #ffd98055, #ffd98000 65%); opacity: 0; animation: hq-glow 1.2s ease-in-out 3.5s both; }
@keyframes hq-darken { to { filter: brightness(0.55); } }
@keyframes hq-uncover { from { -webkit-mask-position: 0 22%; mask-position: 0 22%; } to { -webkit-mask-position: 0 78%; mask-position: 0 78%; } }
@keyframes hq-edge { 0% { top: 95%; opacity: 0; } 8% { opacity: 1; } 90% { opacity: 1; } 100% { top: -16.5%; opacity: 0; } }
@keyframes hq-edge-chips { 0% { transform: translateY(0); } 100% { transform: translateY(14px); } }
@keyframes hq-windows { 0%, 100% { filter: brightness(1); } 45% { filter: brightness(1.28) saturate(1.1); } }
@keyframes hq-glow { 0%, 100% { opacity: 0; } 45% { opacity: 1; } }
@keyframes hq-dust { 0% { opacity: 0; transform: translateY(0) scale(0.4); } 25% { opacity: 0.95; } 70% { opacity: 0.7; } 100% { opacity: 0; transform: translate(var(--dx), -140%) scale(1.8); } }
@keyframes hq-debris { 0% { opacity: 1; transform: translateY(-30px) rotate(0); } 100% { opacity: 0; transform: translateY(260px) rotate(var(--r)); } }
@keyframes hq-shake { 0%, 100% { transform: none; } 6% { transform: translate(-3px, 2px); } 12% { transform: translate(3px, -2px); } 18% { transform: translate(-1px, 1px); } 26% { transform: translate(-4px, 3px); } 32% { transform: translate(4px, -3px); } 40% { transform: translate(-1px, 0); } 50% { transform: translate(-3px, 2px); } 56% { transform: translate(3px, -2px); } 66% { transform: translate(-3px, 3px); } 72% { transform: translate(2px, -2px); } 84% { transform: translate(-2px, 1px); } 90% { transform: translate(1px, 0); } }
.rebuild.quick .rebuild-stage { animation: none; }
.rebuild.quick .scene-bg.old { animation: none; }
.rebuild.quick .scene-bg.new { -webkit-mask-image: none; mask-image: none; opacity: 0; animation: hq-fadein 0.8s ease-in-out both; }
.rebuild.quick .dust-layer, .rebuild.quick .debris-layer, .rebuild.quick .edge-dust, .rebuild.quick .glow { display: none; }
@keyframes hq-fadein { to { opacity: 1; } }
/* the gift of the castellan: coins fly into the purse (top right) */
.coin-gift { position: fixed; inset: 0; z-index: 71; pointer-events: none; overflow: hidden; }
.coin-gift .gift-text { position: absolute; left: 50%; top: 42%; transform: translate(-50%, -50%); font: 700 34px var(--hq-font-heading, Georgia, serif); color: #fff3b8; text-shadow: 0 2px 0 #8a5f10, 0 0 12px #000a; animation: hq-gifttext 1.9s ease-out both; }
.coin-gift .flycoin { position: absolute; left: 50%; top: 48%; width: 36px; height: 36px; margin: -18px 0 0 -18px; opacity: 0; animation: hq-flycoin 1.15s cubic-bezier(.5,0,.8,.4) var(--dl) both; }
.coin-gift .flycoin .coin { width: 100%; height: 100%; }
@keyframes hq-gifttext { 0% { opacity: 0; transform: translate(-50%, -30%) scale(0.6); } 20% { opacity: 1; transform: translate(-50%, -50%) scale(1.1); } 70% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%, -80%) scale(1); } }
@keyframes hq-flycoin { 0% { opacity: 0; transform: translate(var(--dx), 20px) scale(0.5); } 15% { opacity: 1; } 100% { opacity: 0; transform: translate(calc(40vw - 20px), -48vh) scale(0.45); } }
.coin-gift.quick .flycoin { display: none; }
@media (prefers-reduced-motion: reduce) { .coin-gift .gift-text { animation: none; } }
.story-ui { position: absolute; left: 0; right: 0; top: 0; display: flex; flex-direction: column; align-items: center; gap: 10px; padding: calc(14px + env(safe-area-inset-top)) 14px 0; transition: opacity 0.35s; }
.story-overlay:not([data-state="talking"]) .story-ui { opacity: 0; pointer-events: none; }
.bubble { position: relative; width: 100%; max-width: 520px; background: var(--parch); color: var(--ink); border: 4px solid var(--gold); border-radius: 20px; padding: 14px 16px; box-shadow: 0 6px 18px #000a; }
.bubble::after { content: ""; position: absolute; bottom: -14px; left: 50%; margin-left: -12px; border: 12px solid transparent; border-bottom: 0; border-top-color: var(--gold); }
.bubble .who { font-family: var(--hq-font-heading, Georgia, serif); font-weight: 700; margin-bottom: 4px; color: var(--gold-dark); }
.bubble p { margin: 0; font-size: 18px; line-height: 1.4; }
.dots { display: flex; gap: 8px; padding: 5px 9px; border-radius: 12px; background: #0008; }
.dots i { width: 10px; height: 10px; border-radius: 50%; background: #ffffff44; }
.dots i.on { background: var(--gold); }
.story-overlay .btn { min-width: 180px; }

/* ---- the hero on the whole screen (tap on a hero) ---- */
.hero-zoom { position: fixed; inset: 0; z-index: 80; background: var(--bg); display: flex; align-items: center; justify-content: center; container-type: size; padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); box-sizing: border-box; cursor: zoom-out; animation: hq-zoom-in 0.2s ease-out both; transform-origin: var(--ox, 50%) var(--oy, 50%); -webkit-tap-highlight-color: transparent; }
.hero-zoom .zoomstage { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; }
.hero-zoom .hq-hero { width: min(100cqw, 100cqh); max-width: none; height: auto; }
.hero-zoom canvas { width: min(100cqw, 100cqh); height: min(100cqw, 100cqh); image-rendering: pixelated; }
@keyframes hq-zoom-in { from { opacity: 0; transform: scale(0.35); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .hero-zoom { animation: none; } }
.herostage .hq-hero, .avatar.zoomable, .dyewrap .hq-hero { cursor: zoom-in; }

/* ---- sheet / toast ---- */
.overlay { position: fixed; inset: 0; background: #000a; display: flex; align-items: flex-end; justify-content: center; z-index: 50; }
.sheet {
  width: 100%; max-width: 520px; max-height: 88%; overflow-y: auto; background: var(--parch); color: var(--ink);
  border-radius: 22px 22px 0 0; padding: 18px 16px calc(18px + env(safe-area-inset-bottom)); border-top: 5px solid var(--gold);
}
.sheet h2 { font-size: 22px; margin-bottom: 8px; }
.sheet .btn.ghost { color: var(--ink); border-color: var(--ink-soft); }
.sheet .actions { display: flex; gap: 10px; margin-top: 16px; }
.sheet .actions .btn { flex: 1; }
.sheet .center { text-align: center; }
.toasts { position: fixed; left: 0; right: 0; bottom: 96px; display: flex; flex-direction: column; align-items: center; gap: 8px; z-index: 60; pointer-events: none; }
.toast {
  background: var(--panel); color: var(--parch); border: 3px solid var(--gold); border-radius: 14px; padding: 10px 16px;
  font-weight: bold; max-width: 90%; box-shadow: 0 4px 12px #0008; animation: toast 3s ease forwards;
}
.toast.error { border-color: var(--red); }
@keyframes toast { 0% { opacity: 0; transform: translateY(10px); } 10% { opacity: 1; transform: none; } 85% { opacity: 1; } 100% { opacity: 0; } }
.coinpop {
  position: fixed; left: 50%; top: 40%; z-index: 70; pointer-events: none; font-size: 54px; font-weight: bold; color: var(--gold);
  text-shadow: 0 3px 0 #000a; display: flex; align-items: center; gap: 8px; animation: coinpop 1.6s ease-out forwards;
}
.coinpop .coin { width: 60px; height: 60px; animation: spin 0.8s linear 2; }
@keyframes coinpop { 0% { opacity: 0; transform: translate(-50%, 20px) scale(0.5); } 20% { opacity: 1; transform: translate(-50%, 0) scale(1.1); } 100% { opacity: 0; transform: translate(-50%, -140px) scale(1); } }
@keyframes spin { to { transform: rotateY(360deg); } }

/* ---- parent ---- */
.kidtag { display: inline-block; padding: 2px 10px; border-radius: 10px; background: var(--ink); color: var(--gold); font-weight: bold; font-size: 14px; }
.tadmin .trow { padding: 10px 0; border-top: 1px solid #0002; }
.tadmin .trow:first-of-type { border-top: 0; }
.tadmin .checks { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px; }
.tgl { display: inline-flex; align-items: center; gap: 6px; min-height: var(--tap); padding: 6px 16px; border-radius: 999px; font: inherit; font-size: 17px; font-weight: bold; cursor: pointer; }
.tgl.on { background: var(--green); color: #fff; border: 2px solid var(--green-dark); }
.tgl.off { background: var(--parch); color: var(--ink); border: 2px solid var(--parch-dark); }
.tgl ha-icon { --mdc-icon-size: 20px; }
.tadmin .tpl { display: flex; align-items: center; gap: 8px; padding: 6px 0; }
.tadmin .tpl .btn { min-height: var(--tap); padding: 6px 12px; font-size: 16px; }
.tadmin .oneoff { padding: 8px 0; border-top: 1px solid #0002; }
.tadmin .oneoff:first-of-type { border-top: 0; }
.pend { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.pend .btn { min-height: var(--tap); padding: 8px 14px; font-size: 16px; }
.adj { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
.adj .btn { min-width: 60px; padding: 8px 12px; }
.hist { font-size: 15px; padding: 6px 0; border-bottom: 1px dashed var(--parch-dark); display: flex; gap: 8px; }
.hist .t { color: var(--ink-soft); flex: none; width: 92px; }

/* ---- illustrated hero (lib/layers.js adds the animation CSS) ---- */
.hq-hero { width: 240px; }
.hq-hero.portrait { width: 96px; }
.herostage .hq-hero:not(.portrait) { width: clamp(150px, calc(100vw - 208px), 280px); }
.avatar .hq-hero { width: 100%; height: 100%; aspect-ratio: auto; }
.choice .hq-hero.portrait { width: 96px; margin-bottom: 4px; border-radius: 10px; background: var(--stage); }
.icard .thumb, .slot .thumb { object-fit: contain; image-rendering: auto; }
.thumb-missing { opacity: 0.25; }
/* pouring the dye over the hero after the purchase */
.pour { position: absolute; left: 50%; top: 4%; width: 0; height: 0; pointer-events: none; }
.pour .bottle { position: absolute; left: 18px; top: -6px; width: 38px; height: 46px; border-radius: 12px 12px 16px 16px; border: 3px solid #ffffffcc; background: linear-gradient(var(--dye) 0 65%, #ffffff44 65%); transform-origin: 20% 10%; animation: hq-tilt 1.6s ease-in-out both; }
.pour .bottle::before { content: ""; position: absolute; left: 9px; top: -11px; width: 14px; height: 10px; border-radius: 3px; background: #b9874f; }
.pour .stream { position: absolute; left: 6px; top: 20px; width: 6px; height: 0; border-radius: 3px; background: var(--dye); animation: hq-stream 1.6s ease-in-out both; }
@keyframes hq-tilt { 0% { transform: translate(30px, -20px) rotate(0); opacity: 0; } 20% { transform: translate(0, 0) rotate(-20deg); opacity: 1; } 45%, 70% { transform: translate(0, 0) rotate(-115deg); opacity: 1; } 100% { transform: translate(30px, -20px) rotate(0); opacity: 0; } }
@keyframes hq-stream { 0%, 30% { height: 0; opacity: 0; } 45% { height: 70px; opacity: 1; } 70% { height: 70px; opacity: 1; } 85%, 100% { height: 0; opacity: 0; transform: translateY(70px); } }
@media (prefers-reduced-motion: reduce) { .pour .bottle, .pour .stream { animation-duration: 0.01s; } }
/* the siege of the fortress (#118): the preparation, the castellan in a hurry, the choice of the amulet, the gifts on the hero tab */
nav:empty { display: none; }
.siege-prep { padding-bottom: 84px; }
.siege-head h2 { margin: 0 0 4px; padding-right: 48px; }
.siege-prep { position: relative; }
.siege-x { position: absolute; top: 6px; right: 6px; z-index: 4; width: 48px; height: 48px; border: 0; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: rgba(28, 26, 46, .75); color: #fff; box-shadow: 0 2px 6px rgba(0,0,0,.35); touch-action: manipulation; }   /* the cross of the siege (#118) */
.siege-go { position: sticky; bottom: 0; padding: 10px 0 4px; background: linear-gradient(transparent, var(--hq-night, #1C1A2E) 35%); z-index: 3; }
.btn.big { font-size: 22px; min-height: 60px; }
.btn.block { width: 100%; }
.story-overlay.hurry[data-state="arriving"] .giver-walk { animation-duration: .7s; }
.story-overlay.hurry[data-state="arriving"] .giver-bob { animation-duration: .14s; animation-iteration-count: 6; }
.bubble.shake { animation: hq-bubble-shake .45s ease-in-out; }
@keyframes hq-bubble-shake { 0%, 100% { transform: translateX(0); } 20% { transform: translateX(-6px) rotate(-1deg); } 40% { transform: translateX(5px) rotate(1deg); } 60% { transform: translateX(-4px); } 80% { transform: translateX(3px); } }
.amulet-choice { display: flex; flex-direction: column; background: radial-gradient(circle at 50% 40%, #3a3360, #14122a 75%); }
.amulet-ui { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 14px; padding: calc(14px + env(safe-area-inset-top)) 14px calc(14px + env(safe-area-inset-bottom)); overflow-y: auto; }
.amulets { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; width: 100%; max-width: 440px; }
@media (orientation: landscape) and (min-width: 700px) { .amulets { grid-template-columns: repeat(4, minmax(0, 1fr)); max-width: 760px; } }
.amulet { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 8px; border-radius: 16px; border: 3px solid transparent; background: #2a2742cc; color: var(--parch); font-weight: 700; }
.amulet img { width: 100%; aspect-ratio: 1; object-fit: contain; }
.amulet.mine { border-color: var(--gold); box-shadow: 0 0 18px #e8b33a88; }
.amulets.chosen .amulet:not(.mine) { opacity: .45; }
.amulet-foot { min-height: 48px; }
.amulet-zoom { position: absolute; inset: 0; z-index: 2; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 20px; background: #14122af2; }
.amulet-zoom[hidden] { display: none; }
.amulet-big { width: min(80vw, 60vh, 520px); aspect-ratio: 1; object-fit: contain; }
.amulet-big.fly { animation: hq-amulet-fly .9s ease-in forwards; }
@keyframes hq-amulet-fly { 0% { transform: none; opacity: 1; } 100% { transform: translateY(45vh) scale(.15); opacity: 0; } }
.amulet-name { font: 700 22px var(--hq-font-heading, Georgia, serif); color: var(--parch); }
.amulet-x { position: absolute; top: calc(10px + env(safe-area-inset-top)); right: 10px; width: 56px; height: 56px; border-radius: 50%; border: 3px solid var(--parch); background: #2a2742; color: var(--parch); font-size: 28px; line-height: 1; }
`;
