import streamDeck from '@elgato/streamdeck';

import { NowPlayingAction } from './actions/now.playing.action.js';

/**
 * The plugin the Stream Deck app launches, as one ES module with no `node_modules` beside it.
 *
 * Everything is wired here rather than in decorators: an action is a thin shell over a plain class
 * that holds the decisions, and this file is where the two are joined and given what they need.
 */
streamDeck.logger.setLevel('info');
const logger = streamDeck.logger.createScope('bluos');

streamDeck.actions.registerAction(new NowPlayingAction());

await streamDeck.connect();
logger.info(`BluOS plugin ${streamDeck.info.plugin.version} connected; no player configured yet.`);
