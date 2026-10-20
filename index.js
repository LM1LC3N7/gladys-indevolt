// -----------------------------------------------------------------------------
// Entry point: SDK wiring only. Every handler is registered BEFORE connect(),
// and delegates to the IndevoltApp (src/app.js). Read-only: no command
// handler, the batteries are never commanded (no charge, no discharge, no
// change of mode).
//
// Environment variables provided by the Gladys supervisor, read by the SDK:
// GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN, GLADYS_INTEGRATION_SELECTOR.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { IndevoltApp } from './src/app.js';
import { ACTIONS } from './src/constants.js';

const gladys = new GladysIntegration();
const app = new IndevoltApp({ gladys });

// --- Discovery -------------------------------------------------------------------
gladys.onScanRequest(() => app.scan());
// The device just created: its values are read now, not at the next read.
gladys.onDeviceCreated((device) => app.onDeviceCreated(device));
// Updated from Discovery: the new features get their values now.
gladys.onDeviceUpdated((device) => app.onDeviceUpdated(device));

// --- Configuration screen buttons -----------------------------------------------
gladys.onAction(ACTIONS.TEST, () => app.testConnection());
// The only way to take an index held back, in two clicks (a save of the form never does).
gladys.onAction(ACTIONS.ACCEPT_HELD, () => app.acceptHeldIndex());

// --- Configuration changed by the user ----------------------------------------
gladys.onConfigUpdated((config) => {
  logger.info('Configuration updated: restarting');
  return app.start(config, { fresh: true });
});

// --- Connection lifecycle ------------------------------------------------------
// Every connection (the first one and each reconnection) publishes the
// devices, the status and every value again.
gladys.on('connected', async () => {
  try {
    await app.start(await gladys.getConfig());
  } catch (err) {
    logger.error(`Start failed (${err?.name ?? 'Error'})`);
  }
});
gladys.on('disconnected', () => {
  app.stop().catch((err) => logger.error(`Stop failed (${err?.name ?? 'Error'})`));
});
gladys.handleShutdown(() => app.stop());

logger.info('Starting the Indevolt integration...');
gladys.connect().catch((err) => {
  logger.error(`Initial connection failed (${err?.name ?? 'Error'})`);
  process.exit(1);
});
