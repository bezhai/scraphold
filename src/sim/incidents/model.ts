/** Saved incident cards, consequences and map objectives. */
import type { IncidentChoice, IncidentId, IncidentTargetKind } from '../data/incidents';
import type { Effect } from '../modifiers';
import type { EntityId } from '../state';
export interface PreparedTarget {
  kind: IncidentTargetKind;
  tile: number;
  nestId: EntityId;
  /** Reserved top-left tile of the future 2x2 child nest; -1 for other objectives. */
  splitTile: number;
}
export interface PendingIncident {
  id: number;
  definitionId: IncidentId;
  raisedTick: number;
  deadlineTick: number;
  title: string;
  description: string;
  choices: (IncidentChoice & {
    description: string;
  })[];
  target: PreparedTarget | null;
}
export interface IncidentHistory {
  id: number;
  definitionId: IncidentId;
  raisedTick: number;
  resolvedTick: number;
  choiceId: string;
  automatic: boolean;
}
export interface IncidentTarget extends PreparedTarget {
  id: number;
  incidentId: number;
  title: string;
  createdTick: number;
  expiresTick: number;
  status: 'active' | 'completed' | 'expired';
  guardIds: EntityId[];
}
export interface IncidentState {
  nextId: number;
  pending: PendingIncident | null;
  history: IncidentHistory[];
  targets: IncidentTarget[];
  /** Scheduled days in the inclusive day 2–20 window. */
  eventDays: number[];
  northernDay: number;
  nextIncidentTick: number | null;
  lastIncidentDay: number;
  modifiers: {
    incidentId: number;
    effects: Effect[];
    startsTick: number;
    expiresTick: number | null;
  }[];
  isolatedSurvivors: {
    unitId: EntityId;
    expiresTick: number;
  }[];
  nightBudgetAdjustments: {
    night: number;
    budgetPct: number;
  }[];
  casualties: {
    incidentId: number;
    night: number;
    count: number;
  }[];
  fragmentIndex: number;
}
export function createIncidentState(): IncidentState {
  return {
    nextId: 1,
    pending: null,
    history: [],
    targets: [],
    eventDays: [],
    northernDay: 0,
    nextIncidentTick: null,
    lastIncidentDay: 0,
    modifiers: [],
    isolatedSurvivors: [],
    nightBudgetAdjustments: [],
    casualties: [],
    fragmentIndex: 0
  };
}
