/**
 * The bots used by the balance runs (Task 5). Each call returns a fresh controller, since bots
 * remember things (roles, sightings, layouts) for the one game they play.
 */
import type { Controller } from '../run';
import type { StrategyName } from './strategy';
import { createBot, doNothing } from './bot';
import { economyFirst } from './economyFirst';
import { fortress } from './fortress';
import { createSignalBot } from './signal';
import { nestRaider } from './nestRaider';

export type BotName = 'doNothing' | StrategyName;
export const BOT_NAMES: readonly BotName[] = ['doNothing', 'economy', 'raider', 'fortress', 'signal'];
/** The four strategies the balance targets are about (doNothing is the baseline). */
export const STRATEGY_BOTS: readonly StrategyName[] = ['economy', 'raider', 'fortress', 'signal'];

export function createController(name: BotName): Controller {
  switch (name) {
    case 'doNothing':
      return doNothing;
    case 'economy':
      return createBot(economyFirst());
    case 'raider':
      return createBot(nestRaider());
    case 'signal':
      return createSignalBot();
    case 'fortress':
      return createBot(fortress());
  }
}
