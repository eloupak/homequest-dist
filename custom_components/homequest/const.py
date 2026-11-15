"""Constants for HomeQuest."""

DOMAIN = "homequest"
VERSION = "0.1.0"
# #175: "Nahlásit problém" opens a new issue here unless the parent sets another GitHub repository (Nastavení hry → Kam hlásit problémy)
REPORT_REPO_DEFAULT = "eloupak/homequest-dist"

STORAGE_KEY = "homequest.state"
STORAGE_VERSION = 1

# relative to the HA config dir
DATA_DIR = "homequest"
CATALOG_FILE = "catalog.yaml"
STORY_FILE = "story.yaml"
DRAFTS_FILE = "catalog.drafts.yaml"   # written by tools/import_art.py; read ONLY on the test instance (env_test): the previews of new art in the shop
ASSETS_DIR = "assets"
ART_SUBDIR = "art"            # illustrated art (tools/import_art.py): art/manifest.json, layers/, ...

TEST_ENV_FLAG = "env_test"          # file in the data dir: this is the TEST instance (only tools/deploy.sh test writes it; production must never have it): red TEST badge
CLEAN_ENV_FLAG = "env_clean"        # file in the data dir: a trial install (only the trial install script writes it; production must never have it): CLEAN badge, nothing else changes
BUILD_FILE = "build"            # file in the data dir (TEST only, written by deploy.sh test): "<branch> <commit> <time>" for O hře
SETUP_MODE_FLAG = "setup_mode"      # file in the data dir (TEST only, with env_test): the setup guide (v1.6) works on a copy of the state, the children's data stay
DEV_PANELS_FLAG = "dev_panels"      # file in the data dir: register the development panels (3D, motion)
STATIC_URL = "/homequest_static"
ASSETS_URL = "/homequest_assets"

SLOTS = ("outfit", "hair", "ears", "head", "torso", "legs", "feet", "hands", "back", "neck", "belt", "weapon", "offhand")
# a consumable that unlocks something instead of being worn: a bottle of hair dye unlocks a hair colour for good (item.color)
DYE_SLOT = "hair_dye"
ITEM_SLOTS = SLOTS + (DYE_SLOT,)
# layered clothing replaced by whole-outfit sets (addendum 5): hidden from shop/inventory when sets are used
LAYERED_SLOTS = ("torso", "legs", "feet")
OUTFIT_STYLES = ("cloth", "light", "heavy", "robe")
RARITIES = ("common", "rare", "epic", "legendary")
PERIODS = ("daily", "weekly", "adhoc")
DEFAULT_REWARD = {"daily": 1, "weekly": 3, "adhoc": 3}
MATERIALS = ("cloth", "leather", "iron", "steel", "mithril", "wood", "magic")
TIERS = (0, 1, 2, 3, 4, 5)
DEFAULT_TIER = {"common": 1, "rare": 2, "epic": 3, "legendary": 5}
# default shop prices by rarity (inclusive ranges); the slot decides where in the range an item lands
PRICE_RANGE = {"common": (8, 12), "rare": (20, 30), "epic": (50, 70), "legendary": (120, 150)}
PRICE_STEP = {"common": 1, "rare": 5, "epic": 5, "legendary": 5}
SLOT_WEIGHT = {"outfit": 0.5, "ears": 0.4, "belt": 0.0, "head": 0.1, "hands": 0.1, "neck": 0.2, "feet": 0.4, "legs": 0.4, "back": 0.5, "offhand": 0.5, "torso": 1.0, "weapon": 1.0}
BODY_TYPES = ("male", "female")
DEFAULT_CLASS = "hero"        # hero classes are gone: one implicit class carries the starter items

HISTORY_LIMIT = 500
HERO_NAME_MAX = 20
NOTE_MAX = 100

EVENT_TASK_PENDING = "homequest_task_pending"
EVENT_TASK_APPROVED = "homequest_task_approved"
EVENT_TASK_COMPLETED = "homequest_task_completed"
EVENT_TASK_ASSIGNED = "homequest_task_assigned"
EVENT_PURCHASE = "homequest_purchase"
EVENT_ART_IMPORTED = "homequest_art_imported"

SIGNAL_UPDATED = "homequest_updated"

# Error codes returned to clients
ERR_NOT_FOUND = "not_found"
ERR_FORBIDDEN = "forbidden"
ERR_INSUFFICIENT_COINS = "insufficient_coins"
ERR_INVALID_STATE = "invalid_state"
ERR_INVALID_PARAMS = "invalid_params"
ERR_ALREADY_OWNED = "already_owned"
ERR_BODY_RESTRICTED = "body_restricted"      # an item (a hairstyle) for the other body
ITEM_BODIES = ("boy", "girl", "any")
BODY_OF_HERO = {"male": "boy", "female": "girl"}
UPDATE_URL = "https://api.github.com/repos/eloupak/homequest-dist/releases/latest"   # v1.7 (#141): a package install without HACS
