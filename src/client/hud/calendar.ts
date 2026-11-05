/**
 * Calendar strip view model: tonight plus the published preview nights (CALENDAR.previewNights),
 * read through the simulation's nightType, and the vision lost after a rust storm as the
 * simulation computes it (weatherVisionMultiplier, which already honours 雾气过滤).
 */
import { CALENDAR, NIGHT_TYPE_DESCRIPTIONS, NIGHT_TYPE_NAMES, TOTAL_NIGHTS, nightType, weatherVisionMultiplier, type Game, type NightType } from '../../sim';

export interface CalendarNightView {
  night: number;
  isTonight: boolean;
  type: NightType;
  name: string;
  /** Top line of the strip cell. */
  label: string;
  /** Heading of the night in the hover card. */
  title: string;
  description: string;
}

export interface CalendarStripModel {
  nights: CalendarNightView[];
  /** Vision lost today after last night's rust storm, in percent; 0 when there is no penalty. */
  postStormVisionLossPct: number;
}

function postStormVisionLossPct(game: Pick<Game, 'state' | 'modifiers'>): number {
  if (game.state.tick >= game.state.calendar.reducedVisionUntilTick) return 0;
  return Math.round((1 - weatherVisionMultiplier(game)) * 100);
}

export function calendarStripModel(game: Pick<Game, 'state' | 'modifiers'>): CalendarStripModel {
  const view = game.state;
  const tonight = view.clock.day;
  const nights: CalendarNightView[] = [];
  for (let night = tonight; night <= Math.min(TOTAL_NIGHTS, tonight + CALENDAR.previewNights); night++) {
    const type = nightType(view, night);
    if (type === null) continue;
    const isTonight = night === tonight;
    const name = NIGHT_TYPE_NAMES[type];
    nights.push({
      night,
      isTonight,
      type,
      name,
      label: isTonight ? '今晚' : `第${night}夜`,
      title: isTonight ? `今晚（第 ${night} 夜）· ${name}` : `第 ${night} 夜 · ${name}`,
      description: NIGHT_TYPE_DESCRIPTIONS[type],
    });
  }
  return { nights, postStormVisionLossPct: postStormVisionLossPct(game) };
}
