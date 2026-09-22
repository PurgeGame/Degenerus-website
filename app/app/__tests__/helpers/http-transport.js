// Opt in only for suites whose fetch stubs model the HTTP API. Deployment
// profiles can switch to native chain reads without sending fixture tests to RPC.
import { CHAIN } from '../../chain-config.js';
CHAIN.readMode = 'indexer';
