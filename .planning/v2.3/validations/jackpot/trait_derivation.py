"""Pure-Python derivation of jackpot winning traits from ``finalWord``.

Mirrors ``JackpotBucketLib.getRandomTraits`` at
``degenerus-audit/contracts/libraries/JackpotBucketLib.sol:281-286``:

    w[0] = uint8(rw & 0x3F);                         // Quadrant 0: 0-63
    w[1] = 64  + uint8((rw >> 6)  & 0x3F);           // Quadrant 1: 64-127
    w[2] = 128 + uint8((rw >> 12) & 0x3F);           // Quadrant 2: 128-191
    w[3] = 192 + uint8((rw >> 18) & 0x3F);           // Quadrant 3: 192-255

Bonus traits apply the same unpack to a keccak-salted randWord
(``DegenerusGameJackpotModule.sol:1884-1894``)::

    r = uint256(keccak256(abi.encodePacked(randWord, BONUS_TRAITS_TAG)))

where ``BONUS_TRAITS_TAG = keccak256("BONUS_TRAITS")``
(``JackpotModule.sol:164``).

NOTE: ``_rollWinningTraits`` also applies ``_applyHeroOverride`` in-contract,
which may replace ONE quadrant's trait. This module returns the BASE
derivation; hero override is handled (inferentially) by validators.
"""

from __future__ import annotations

from eth_utils import keccak


BONUS_TRAITS_TAG: bytes = keccak(text="BONUS_TRAITS")


def expected_main_traits(final_word: int) -> tuple[int, int, int, int]:
    """Return the 4 base trait IDs derived from ``final_word``.

    Returns a 4-tuple (quadrant 0..3 traits, 0-255 range).
    """
    final_word = int(final_word)
    w0 = final_word & 0x3F
    w1 = 64 + ((final_word >> 6) & 0x3F)
    w2 = 128 + ((final_word >> 12) & 0x3F)
    w3 = 192 + ((final_word >> 18) & 0x3F)
    return (w0, w1, w2, w3)


def expected_bonus_traits(final_word: int) -> tuple[int, int, int, int]:
    """Return the 4 bonus trait IDs derived from ``final_word``.

    Applies ``keccak256(abi.encodePacked(randWord, BONUS_TRAITS_TAG))``
    to produce the salted entropy, then the same 6-bit unpack.
    """
    final_word = int(final_word)
    # abi.encodePacked(uint256, bytes32) = 32 + 32 bytes, big-endian.
    packed = final_word.to_bytes(32, "big") + BONUS_TRAITS_TAG
    salted = int.from_bytes(keccak(packed), "big")
    return expected_main_traits(salted)


def quadrant_of(trait_id: int) -> int:
    """Return the quadrant (0..3) a trait ID belongs to."""
    return (int(trait_id) >> 6) & 0x3
