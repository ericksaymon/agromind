import type { Property } from "./generated/prisma/client";
import {
  defaultIntelligencePolicy,
  type AnalysisPolicy,
  type IntelligencePolicy,
} from "../../../packages/contracts/src/index";
export function propertyPolicy(p: Property): AnalysisPolicy {
  return {
    reorderDays: p.reorderDays,
    expiryWarningDays: p.expiryWarningDays,
    inactivityDays: p.inactivityDays,
    policyVersion: p.policyVersion,
    intelligence: {
      ...defaultIntelligencePolicy,
      ...(p.intelligencePolicy as Partial<IntelligencePolicy>),
    },
  };
}
