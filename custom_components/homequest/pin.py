"""Optional parent PIN (pure Python): stored only as a salted PBKDF2 hash, checked on the server, unlocks a session for a while."""

from __future__ import annotations

import hashlib
import hmac
import secrets
from typing import Any

ITERATIONS = 150_000
PIN_MIN, PIN_MAX = 4, 8
UNLOCK_S = 300            # a correct PIN unlocks the parent functions of that connection for 5 minutes (renewed by every use)
MAX_FAILS = 5
LOCK_S = 60               # after 5 wrong tries the PIN is refused for a minute
ERR_PIN_REQUIRED = "pin_required"
ERR_PIN_WRONG = "pin_wrong"
ERR_PIN_LOCKED = "pin_locked"
ERR_PIN_INVALID = "invalid_params"


class PinError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def hash_pin(pin: str, salt: bytes | None = None) -> dict[str, Any]:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", pin.encode(), salt, ITERATIONS)
    return {"salt": salt.hex(), "hash": digest.hex(), "iter": ITERATIONS}


def check_pin(pin: str, record: dict[str, Any]) -> bool:
    digest = hashlib.pbkdf2_hmac("sha256", pin.encode(), bytes.fromhex(record["salt"]), int(record["iter"]))
    return hmac.compare_digest(digest.hex(), record["hash"])


def valid_pin(pin: Any) -> bool:
    return isinstance(pin, str) and pin.isascii() and pin.isdigit() and PIN_MIN <= len(pin) <= PIN_MAX


class PinGuard:
    """The PIN of the parent. `holder` is a dict (the game state): the hash lives in holder["parent_pin"] and nowhere else."""

    def __init__(self, holder: dict[str, Any]) -> None:
        self.holder = holder
        self._sessions: dict[Any, float] = {}
        self._fails = 0
        self._locked_until = 0.0

    @property
    def enabled(self) -> bool:
        return bool(self.holder.get("parent_pin"))

    def unlocked(self, session: Any, now: float) -> bool:
        """True when no PIN is set, or the session entered it lately (and renews the window)."""
        if not self.enabled:
            return True
        until = self._sessions.get(session)
        if until is None or until < now:
            self._sessions.pop(session, None)
            return False
        self._sessions[session] = now + UNLOCK_S
        return True

    def require(self, session: Any, now: float) -> None:
        if not self.unlocked(session, now):
            raise PinError(ERR_PIN_REQUIRED, "enter the parent PIN")

    def verify(self, session: Any, pin: Any, now: float) -> None:
        if not self.enabled:
            return
        if now < self._locked_until:
            raise PinError(ERR_PIN_LOCKED, f"too many wrong tries, wait {int(self._locked_until - now) + 1} s")
        if not isinstance(pin, str) or not check_pin(pin, self.holder["parent_pin"]):
            self._fails += 1
            if self._fails >= MAX_FAILS:
                self._fails = 0
                self._locked_until = now + LOCK_S
            raise PinError(ERR_PIN_WRONG, "wrong PIN")
        self._fails = 0
        self._sessions[session] = now + UNLOCK_S

    def lock(self, session: Any) -> None:
        self._sessions.pop(session, None)

    def set(self, session: Any, new_pin: Any, now: float) -> None:
        """Set, change or (new_pin None) remove the PIN. Changing or removing needs the current one to be entered in this session."""
        self.require(session, now)
        if new_pin is None:
            self.holder.pop("parent_pin", None)
            self._sessions.clear()
            return
        if not valid_pin(new_pin):
            raise PinError(ERR_PIN_INVALID, f"the PIN is {PIN_MIN}-{PIN_MAX} digits")
        self.holder["parent_pin"] = hash_pin(new_pin)
        self._sessions[session] = now + UNLOCK_S
