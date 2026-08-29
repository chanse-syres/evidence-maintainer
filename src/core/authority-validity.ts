import { readFactPath } from "./fact-path.ts";
import type {
  AuthorityValidity,
  PolicyV4,
  SourceObservation,
} from "./schemas.ts";

export interface AuthorityValidityResult {
  validObservationIds: string[];
  violations: string[];
}

function timestamp(value: string): number {
  return new Date(value).getTime();
}

function prefix(rule: AuthorityValidity): string {
  return `${rule.mode}:${rule.sourceId}:${rule.authorityScope}`;
}

function hasApplicabilityBinding(value: unknown): boolean {
  return value !== null && value !== false && value !== "";
}

function scopedObservations(
  rule: AuthorityValidity,
  observations: readonly SourceObservation[],
): SourceObservation[] {
  return observations.filter((observation) =>
    observation.sourceId === rule.sourceId
    && observation.authorityScope.includes(rule.authorityScope),
  );
}

function selectLatestPerSubject(
  candidates: readonly SourceObservation[],
  eventTime: (observation: SourceObservation) => number,
): SourceObservation[] {
  const bySubject = new Map<string, SourceObservation[]>();
  for (const observation of candidates) {
    const subject = observation.subjectId!;
    const group = bySubject.get(subject) ?? [];
    group.push(observation);
    bySubject.set(subject, group);
  }

  const selected: SourceObservation[] = [];
  for (const group of bySubject.values()) {
    const latest = Math.max(...group.map(eventTime));
    selected.push(...group.filter((observation) => eventTime(observation) === latest));
  }
  return selected;
}

export function evaluateAuthorityValidity(
  policy: PolicyV4,
  observations: readonly SourceObservation[],
): AuthorityValidityResult {
  const cutoff = timestamp(policy.cutoff);
  const validIds = new Set<string>();
  const violations = new Set<string>();

  for (const rule of policy.authorityValidity) {
    const candidates = scopedObservations(rule, observations);
    const label = prefix(rule);

    if (candidates.length === 0) {
      violations.add(`${label}:no matching observations`);
      continue;
    }

    if (rule.mode === "SNAPSHOT_MAX_AGE") {
      const earliest = cutoff - rule.maxAgeMinutes * 60_000;
      for (const observation of candidates) {
        const observedAt = timestamp(observation.observedAt);
        if (observedAt > cutoff) {
          violations.add(`${label}:${observation.id} is after the cutoff`);
        } else if (observedAt < earliest) {
          violations.add(`${label}:${observation.id} exceeds max age`);
        } else {
          validIds.add(observation.id);
        }
      }
      continue;
    }

    if (rule.mode === "EFFECTIVE_UNTIL_SUPERSEDED") {
      const applicable: SourceObservation[] = [];
      for (const observation of candidates) {
        if (observation.subjectId === null) {
          violations.add(`${label}:${observation.id} lacks a subject binding`);
          continue;
        }
        const binding = readFactPath(observation, rule.applicabilityFactPath);
        if (!binding.found || !hasApplicabilityBinding(binding.value)) {
          violations.add(`${label}:${observation.id} lacks an applicability binding`);
          continue;
        }
        if (observation.effectiveAt === null) {
          violations.add(`${label}:${observation.id} lacks an effective time`);
          continue;
        }
        if (timestamp(observation.effectiveAt) > cutoff) {
          violations.add(`${label}:${observation.id} becomes effective after the cutoff`);
          continue;
        }
        applicable.push(observation);
      }
      for (const observation of selectLatestPerSubject(
        applicable,
        (entry) => timestamp(entry.effectiveAt!),
      )) {
        validIds.add(observation.id);
      }
      continue;
    }

    const applicable: SourceObservation[] = [];
    for (const observation of candidates) {
      if (observation.subjectId === null) {
        violations.add(`${label}:${observation.id} lacks a subject binding`);
        continue;
      }
      const event = readFactPath(observation, rule.eventFactPath);
      if (!event.found) {
        violations.add(`${label}:${observation.id} lacks the declared event fact`);
        continue;
      }
      const eventAt = timestamp(observation.effectiveAt ?? observation.observedAt);
      if (eventAt > cutoff) {
        violations.add(`${label}:${observation.id} occurs after the cutoff`);
        continue;
      }
      applicable.push(observation);
    }
    for (const observation of selectLatestPerSubject(
      applicable,
      (entry) => timestamp(entry.effectiveAt ?? entry.observedAt),
    )) {
      validIds.add(observation.id);
    }
  }

  return {
    validObservationIds: [...validIds].sort(),
    violations: [...violations].sort(),
  };
}
