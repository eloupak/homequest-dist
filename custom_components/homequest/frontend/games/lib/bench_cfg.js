/* The performance test (#174): the rules of Obrana brány v2 (game/configs/defend_gate_v2.yaml; tests/test_bench_cfg.py keeps them equal)
 * with a short countdown and one dense wave of every orc type, played locally (no server, nothing stored). Shipped in production. */
export const BENCH_CFG = {
 "countdown_ms": 1000,
 "step_ms": 50,
 "grace_ms": 250,
 "hero_gap": 180,
 "spawn_gap": 620,
 "engage_gap": 120,
 "hold_gap": 45,
 "throw_gap": 420,
 "cooldown_ms": 350,
 "shake_cd_ms": 120,
 "jump_ms": 650,
 "jump_gap_ms": 150,
 "hit_stun_ms": 500,
 "knock": 60,
 "flee_ms": 900,
 "flee_speed": 300,
 "lives": 5,
 "stagger_ms": 1500,
 "weapons": {
  "default": {
   "reach": 330
  }
 },
 "types": {
  "basic": {
   "behavior": "melee",
   "hp": 1,
   "speed": 110,
   "windup_ms": 800,
   "period_ms": 1400,
   "gem_pm": 350
  },
  "armored": {
   "behavior": "melee",
   "hp": 2,
   "speed": 85,
   "windup_ms": 900,
   "period_ms": 1500,
   "gem_pm": 700,
   "helmet": true
  },
  "scout": {
   "behavior": "melee",
   "hp": 1,
   "speed": 230,
   "windup_ms": 500,
   "period_ms": 1000,
   "gem_pm": 250
  },
  "thrower": {
   "behavior": "thrower",
   "hp": 1,
   "speed": 100,
   "windup_ms": 800,
   "period_ms": 1400,
   "gem_pm": 500,
   "throws": 3,
   "throw_windup_ms": 900,
   "throw_period_ms": 2200,
   "stone_ms": 1100
  },
  "grabber": {
   "behavior": "grabber",
   "hp": 1,
   "speed": 120,
   "windup_ms": 700,
   "period_ms": 1400,
   "gem_pm": 500,
   "shake_count": 6,
   "shake_ms": 3500
  }
 },
 "waves": [
  {
   "start_ms": 800,
   "count": 12,
   "gap_ms": 1300,
   "jitter_ms": 300,
   "types": [
    [
     "basic",
     3
    ],
    [
     "scout",
     1
    ],
    [
     "armored",
     1
    ],
    [
     "thrower",
     1
    ],
    [
     "grabber",
     1
    ]
   ]
  }
 ]
};
