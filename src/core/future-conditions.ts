import { readFactPath } from "./fact-path.ts";
import type { FutureCondition, SourceObservation } from "./schemas.ts";

function selectorMatches(condition: FutureCondition, observation: SourceObservation): boolean {
  const { selector } = condition;
  return observation.sourceId === selector.sourceId
    && observation.subjectId === selector.subjectId
    && (selector.kind === null || observation.kind === selector.kind);
}
function comparisonMatches(condition: FutureCondition, actual: unknown): boolean {
  switch (condition.operator) {
    case "EXISTS":
      return true;
    case "EQUALS":
      return Object.is(actual, condition.expectedValue);
    case "NOT_EQUALS":
      return !Object.is(actual, condition.expectedValue);
    case "GREATER_THAN_OR_EQUAL":
      return typeof actual === "number"
        && typeof condition.expectedValue === "number"
        && actual >= condition.expectedValue;
    case "LESS_THAN_OR_EQUAL":
      return typeof actual === "number"
        && typeof condition.expectedValue === "number"
        && actual <= condition.expectedValue;
  }
}

export function conditionMatches(
  condition: FutureCondition,
  observations: readonly SourceObservation[],
): boolean {
  return observations.some((observation) => {
    if (!selectorMatches(condition, observation)) {
      return false;
    }
    const fact = readFactPath(observation, condition.selector.factPath);
    return fact.found && comparisonMatches(condition, fact.value);
  });
}

export function evaluateFutureConditions(
  conditions: readonly FutureCondition[],
  observations: readonly SourceObservation[],
): { passed: boolean; matchedConditionIndexes: number[] } {
  const matchedConditionIndexes = conditions
    .map((condition, index) => conditionMatches(condition, observations) ? index : -1)
    .filter((index) => index >= 0);
  return {
    passed: matchedConditionIndexes.length === conditions.length,
    matchedConditionIndexes,
  };
}
