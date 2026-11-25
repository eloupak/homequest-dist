export const CSS_L = `
.body.playing { overflow: hidden; }
.tabs { margin-bottom: 4px; }
.ops { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.op { position: relative; min-height: 88px; border: 0; border-radius: 14px; background: #3d3868; color: #f3ecd8; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; font-weight: 700; }
.op:disabled { opacity: .4; }
.op .sym { font-size: 34px; line-height: 1; color: #e0b040; }
.op .nm { font-size: 15px; }
.op .done { position: absolute; top: 6px; right: 8px; font-style: normal; color: #7be07b; font-size: 20px; }
.op.ground { min-height: 104px; overflow: hidden; background: #3d3868 var(--gbg, none) center / cover no-repeat; text-shadow: 0 1px 3px #000c; }
.op.ground::before { content: ""; position: absolute; inset: 0; background: linear-gradient(#14122ab3, #14122a33 42%, #0000 55%, #14122acc); pointer-events: none; }
.op.ground { justify-content: flex-start; padding: 10px 6px 26px; }
.op.ground > * { position: relative; }
.op.ground > .done { position: absolute; }
.op.ground > small { position: absolute; left: 4px; right: 4px; bottom: 6px; }
.op .gname { font-size: 20px; color: #fff; text-shadow: 0 0 2px #000, 0 1px 3px #000, 0 0 8px #000c; }   /* readable over a bright sky */
.op.ground .sym { font-size: 26px; text-shadow: 0 0 2px #000, 0 1px 3px #000, 0 0 8px #000c; }
.ov-op { padding: 8px 0; border-bottom: 1px solid #3a3658; }
.ov-op:last-child { border: 0; }
.ov-op h3 { margin: 0 0 4px; font-size: 16px; }
.ov-row { padding: 3px 0; font-size: 15px; }
.tag { font-style: normal; font-size: 11px; margin-left: 6px; padding: 1px 7px; border-radius: 8px; background: #6a3a3a; }
.tag.slow { background: #5a4a1a; }
.res-big { font-size: 22px; }
.res-big b { font-size: 40px; color: #e0b040; }

/* the hunt: the scene above (~55 %), our own pad below; on a phone turned on its side they stand next to each other */
.hn { --sat: env(safe-area-inset-top, 0px); --sar: env(safe-area-inset-right, 0px); position: absolute; inset: 0; display: flex; flex-direction: column; touch-action: manipulation; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; background: #1c1a2e; }
.hn-top { --qx: max(6px, var(--sar)); position: relative; flex: 1 1 0; min-height: 0; display: flex; justify-content: center; align-items: flex-start; overflow: hidden; }
.hn-scene { flex: 1 1 auto; align-self: stretch; display: flex; justify-content: center; align-items: flex-start; min-width: 0; min-height: 0; }
.hn-bottom { flex: 0 0 max(45%, 276px); padding: 6px; box-sizing: border-box; background: #2a2742; }
.hn-hud { position: absolute; top: calc(6px + var(--sat)); left: max(6px, env(safe-area-inset-left, 0px)); display: flex; align-items: center; gap: 8px; z-index: 20; pointer-events: none; }
.hn-hud > * { pointer-events: auto; }
.hn-x { border: 0; border-radius: 10px; padding: 8px 12px; min-height: 36px; background: rgba(42, 39, 66, .85); color: #f3ecd8; font: inherit; font-weight: 700; font-size: 14px; }
/* addendum 7 (#189): the iOS status bar (clock, battery) lies over the top of the scene: the HUD, the hams, the problem and the cross sit below
   it (--sat); the cross ends the round now (hams so far, the ground counts as used), top right, left of it the hams */
.hn-quit { position: absolute; z-index: 21; top: calc(6px + var(--sat)); right: var(--qx); width: 44px; height: 44px; border: 0; border-radius: 50%; padding: 0;
  display: flex; align-items: center; justify-content: center; background: rgba(42, 39, 66, .88); color: #f3ecd8; font-size: 26px; line-height: 1; touch-action: manipulation; }
.hn-left { font-size: 13px; background: rgba(42, 39, 66, .85); padding: 6px 10px; border-radius: 10px; }
@media (orientation: landscape) and (max-height: 560px) {
  .hn { flex-direction: row; }
  .hn-bottom { flex: 0 0 min(42%, 360px); padding-right: max(6px, var(--sar)); }
  /* addendum 13: on the side the scene does not reach the right edge of the screen (the pad does): the cross keeps 6 px, the iOS side inset
     goes to the pad (before, the inset pushed the cross over the hams) */
  .hn-top { --qx: 6px; }
}
.np { display: grid; grid-template-columns: repeat(3, 1fr); grid-template-rows: repeat(4, minmax(60px, 1fr)); gap: 6px; height: 100%; }
.np-k { border: 0; border-radius: 14px; background: #4a4578; color: #fff; font: inherit; font-size: 30px; font-weight: 800; min-height: 60px; touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
.np-k:active { background: #6a64a8; }
.np-k.ok { background: #e0b040; color: #2a1d05; }
.np-k.back { background: #5a4660; font-size: 26px; }
.np.locked .np-k { opacity: .55; }

.sc { position: relative; overflow: hidden; border-radius: 0 0 14px 14px; background: linear-gradient(var(--sky-a), var(--sky-b) var(--horizon)); flex: none; }
.sc-sky { position: absolute; inset: 0; }
.sc-trees { position: absolute; left: 0; right: 0; top: 0; height: calc(var(--horizon) + 3%); pointer-events: none; }
.sc-tree { position: absolute; bottom: 0; width: 15%; height: calc(100% * var(--s)); transform: translateX(-50%); background: linear-gradient(#2f7040, #1f4d2b); clip-path: polygon(50% 0, 88% 62%, 70% 62%, 100% 100%, 0 100%, 30% 62%, 12% 62%); }
.sc-ground { position: absolute; left: 0; right: 0; bottom: 0; top: var(--horizon); background: linear-gradient(var(--gr-a), var(--gr-b)); }
.sc-photo { position: absolute; inset: 0; background: center bottom / cover no-repeat; display: none; pointer-events: none; }
.sc.photo .sc-photo { display: block; }
.sc.photo .sc-trees, .sc.photo .sc-sky, .sc.photo .sc-ground { display: none; }
.sc.photo-wait { background: #1d1b2e; }   /* #211: the ground's picture is loading: no drawn meadow in the meantime */
.sc.photo-wait .sc-trees, .sc.photo-wait .sc-sky, .sc.photo-wait .sc-ground { visibility: hidden; }
.sc-cover { position: absolute; z-index: 4; border-radius: 50% 50% 38% 38% / 62% 62% 38% 38%; background: radial-gradient(circle at 50% 30%, #5a9a44, #3b7430); box-shadow: inset 0 -6px 0 rgba(0, 0, 0, .15); pointer-events: none; }
.sc-cover .leaf { position: absolute; width: 38%; height: 52%; border-radius: 50%; background: #4a8c3a; opacity: .8; }
.sc.art-cover .sc-cover { border-radius: 0; background-color: transparent; box-shadow: none; }   /* #189: the bush picture (backgroundImage set by the scene) */
.sc.art-cover .sc-cover .leaf { display: none; }
.sc.art-arrow .sc-arrow > .sc-shape { display: none; }
.sc-bow image.art { display: none; }
.sc.art-bow .sc-bow image.art { display: inline; }
.sc.art-bow .sc-bow .arc { display: none; }
.sc-hero > [hidden] { display: none !important; }
.sc-cover .leaf.a { left: 4%; top: 18%; } .sc-cover .leaf.b { right: 6%; top: 8%; } .sc-cover .leaf.c { left: 32%; top: -6%; background: #67a84e; }
.sc-target { position: absolute; z-index: 5; overflow: hidden; pointer-events: none; }
.sc-tg { position: absolute; left: 50%; bottom: 0; will-change: transform; background-size: contain; background-repeat: no-repeat; background-position: center; }
.sc-tg[data-state="hidden"] { opacity: 0; }
.sc-tg.art .sc-shape { display: none; }                                              /* brief-021: the animal's art replaces the shape */
.sc-tg[data-state="wait"] .sc-shape { animation: sc-bob 1.4s ease-in-out infinite; }
@keyframes sc-bob { 50% { transform: translateY(-3%); } }
.sc-hero { position: absolute; z-index: 7; pointer-events: none; will-change: transform; }
.sc-hero.sc-fist { z-index: 8; }                                                     /* #226 point 2: the fist over the bow (the bow's SVG is between) */
.sc-hero .hq-hero, .sc-hero .guest { position: absolute; inset: 0; width: 100%; height: 100%; }
.sc-hero .guest { inset: 20%; width: auto; height: auto; border-radius: 50%; background: #8a86b8; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 30px; }
.sc-bow { position: absolute; left: 0; top: 0; z-index: 8; will-change: transform; pointer-events: none; overflow: visible; }
.sc-bow .arc { fill: none; stroke: #6b4423; stroke-width: 5; stroke-linecap: round; }
.sc-bow .string { fill: none; stroke: #f1ead8; stroke-width: 1.5; }
.sc-arrow { position: absolute; left: 0; top: 0; z-index: 9; opacity: 0; will-change: transform; pointer-events: none; }
.sc-loot { position: absolute; left: 0; top: 0; z-index: 10; opacity: 0; will-change: transform; pointer-events: none; }
.sc-score { position: absolute; top: calc(6px + var(--sat, 0px)); right: calc(var(--qx, 6px) + 50px);   /* addendum 13: always left of the cross (44 px + 6 px gap) */
   z-index: 20; display: flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: 12px; background: rgba(42, 39, 66, .88); font-size: 14px; }
.sc-score b { font-size: 22px; color: #e0b040; min-width: 1ch; text-align: right; }
.sc-score-icon { position: relative; width: 26px; height: 20px; }
.sc-eq { position: absolute; z-index: 15; top: calc(max(52px, 15%) + var(--sat, 0px)); left: 50%; transform: translateX(-50%); min-width: 46%; text-align: center; font-size: clamp(26px, 9vw, 46px); font-weight: 800; color: #2a2742; background: rgba(255, 255, 255, .9); border: 4px solid transparent; border-radius: 16px; padding: 4px 14px; white-space: nowrap; box-shadow: 0 2px 8px rgba(0, 0, 0, .25); }
.sc-eq[data-mode="idle"] { display: none; }
.sc-eq[data-mode="right"] { border-color: #46b04a; }
.sc-eq[data-mode="wrong"] { border-color: #d0503a; }
.sc-eq .a { color: #3a2fa0; }
.sc-eq .given { color: #c03a2a; margin-right: 10px; }
.sc-eq .ans { color: #2a8a3a; }
.sc-eq .caret { display: inline-block; width: 3px; height: .9em; background: #3a2fa0; margin-left: 2px; vertical-align: -.1em; animation: sc-blink 1s steps(2) infinite; }
@keyframes sc-blink { 50% { opacity: 0; } }

/* placeholders from CSS shapes (the finished art replaces them: cfg.sprites) */
.sc-shape { position: absolute; inset: 0; }
.sc-shape.hare i { position: absolute; display: block; }
.hare .body { left: 14%; bottom: 0; width: 62%; height: 54%; border-radius: 50%; background: #d9c3a0; }
.hare .head { left: 52%; bottom: 30%; width: 38%; height: 40%; border-radius: 50%; background: #e4d0ae; }
.hare .ear { bottom: 56%; width: 11%; height: 44%; border-radius: 50%; background: #d9c3a0; box-shadow: inset 0 0 0 3px #e8a8a0; }
.hare .ear.l { left: 58%; transform: rotate(-8deg); } .hare .ear.r { left: 72%; transform: rotate(12deg); }
.hare .eye { left: 76%; bottom: 52%; width: 7%; height: 7%; border-radius: 50%; background: #2a2742; }
.hare .tail { left: 6%; bottom: 14%; width: 18%; height: 22%; border-radius: 50%; background: #fff; }
.ham svg { display: block; width: 100%; height: 100%; }   /* UAT beta 2: the drawn ham (lib/dom.js HAM_SVG) */
.arrow .shaft { position: absolute; left: 0; right: 14%; top: 30%; height: 40%; background: #f2d9a0; border: 1px solid #5a3a14; border-radius: 3px; box-sizing: border-box; }
.arrow .head { position: absolute; right: 0; top: 0; bottom: 0; width: 16%; background: #cfd3da; clip-path: polygon(0 0, 100% 50%, 0 100%); }
.arrow .fletch { position: absolute; left: 0; top: 10%; bottom: 10%; width: 14%; background: #d9503a; clip-path: polygon(0 0, 100% 30%, 100% 70%, 0 100%); }

/* the aiming hunt (#188): pull with a finger, the dots show the start of the flight; the page must not move while the finger pulls */
.sc[data-aim] { touch-action: none; -ms-touch-action: none; overscroll-behavior: contain; cursor: crosshair; }
.sc-bow .dots circle { fill: rgba(255, 255, 255, .85); stroke: rgba(42, 39, 66, .35); stroke-width: 1; }
.sc-hint { position: absolute; z-index: 16; left: 50%; bottom: 6%; transform: translateX(-50%); max-width: 86%; padding: 8px 14px; border-radius: 14px; background: rgba(42, 39, 66, .88); color: #f3ecd8; font-size: clamp(15px, 4.2vw, 19px); font-weight: 700; text-align: center; pointer-events: none; animation: sc-hint 1.6s ease-in-out infinite; }
.sc-hint[hidden] { display: none; }
.sc-timer { position: absolute; z-index: 16; left: 50%; top: calc(54px + var(--sat, 0px)); width: 38%; height: 10px; transform: translateX(-50%); border-radius: 6px; background: rgba(42, 39, 66, .55); overflow: hidden; pointer-events: none; }
.sc-timer i { display: block; width: 100%; height: 100%; background: #e8b33a; transform-origin: 0 50%; }
.sc-timer[hidden] { display: none; }
@keyframes sc-hint { 50% { transform: translateX(-50%) translateY(-4px); } }
.sc-plus { position: absolute; left: 0; top: 0; z-index: 10; opacity: 0; pointer-events: none; font-size: clamp(24px, 7vw, 36px); font-weight: 800; color: #ffe08a; text-shadow: 0 2px 0 #8a5f10, 0 0 8px #0008; margin-left: -1ch; }
.deer i, .boar i { position: absolute; display: block; }
.deer .body { left: 8%; bottom: 0; width: 64%; height: 46%; border-radius: 46% 50% 40% 40%; background: #b9773e; }
.deer .neck { left: 60%; bottom: 30%; width: 14%; height: 34%; border-radius: 40%; background: #b9773e; transform: rotate(14deg); }
.deer .head { left: 64%; bottom: 56%; width: 28%; height: 22%; border-radius: 50% 60% 50% 40%; background: #c4844a; }
.deer .ear { bottom: 72%; width: 9%; height: 16%; border-radius: 50%; background: #a8693a; }
.deer .ear.l { left: 64%; transform: rotate(-24deg); } .deer .ear.r { left: 74%; transform: rotate(18deg); }
.deer .eye { left: 80%; bottom: 66%; width: 5%; height: 5%; border-radius: 50%; background: #2a1a10; }
.deer .rump { left: 4%; bottom: 18%; width: 14%; height: 20%; border-radius: 50%; background: #f3ead8; }
.boar .body { left: 4%; bottom: 0; width: 70%; height: 72%; border-radius: 52% 48% 40% 40%; background: #5a4232; }
.boar .mane { left: 22%; bottom: 62%; width: 44%; height: 14%; border-radius: 50%; background: #3e2c20; }
.boar .head { left: 58%; bottom: 10%; width: 34%; height: 52%; border-radius: 46% 40% 40% 50%; background: #66503e; }
.boar .snout { left: 84%; bottom: 14%; width: 14%; height: 18%; border-radius: 40%; background: #c99a8a; }
.boar .tusk { left: 82%; bottom: 30%; width: 6%; height: 12%; border-radius: 50% 50% 0 50%; background: #f6f0e0; transform: rotate(-20deg); }
.boar .ear { left: 64%; bottom: 56%; width: 10%; height: 16%; border-radius: 50% 50% 10% 10%; background: #3e2c20; transform: rotate(-18deg); }
.boar .eye { left: 74%; bottom: 40%; width: 5%; height: 6%; border-radius: 50%; background: #120a06; }
.sc-tg[data-state="wait"] .sc-shape.deer, .sc-tg[data-state="wait"] .sc-shape.boar { animation: sc-bob 1.4s ease-in-out infinite; }
`;
