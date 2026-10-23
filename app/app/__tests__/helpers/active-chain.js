// Active chain for tests, derived from the app's chain config so tests survive chain moves.
import { CHAIN } from '../../chain-config.js';

export const ACTIVE_CHAIN_ID = CHAIN.id;
export const ACTIVE_CHAIN_HEX = CHAIN.hexId;
