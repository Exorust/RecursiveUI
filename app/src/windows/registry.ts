import type { ComponentType } from "react";
import { ReviewApp } from "./ReviewApp";
import { ShipApp } from "./ShipApp";
import { InvestigateApp } from "./InvestigateApp";
import { QAApp } from "./QAApp";
import { OfficeHoursApp } from "./OfficeHoursApp";

export interface SkillWindowProps {
  skillId: string;
}

// Hand-written layouts per skill. Slice 2 replaces this with the generation
// engine: skillId → compiled .tsx component instead of a static map.
const layouts: Record<string, ComponentType<SkillWindowProps>> = {
  "gstack-review": ReviewApp,
  "gstack-ship": ShipApp,
  "gstack-investigate": InvestigateApp,
  "gstack-qa": QAApp,
  "gstack-office-hours": OfficeHoursApp,
};

export function layoutFor(skillId: string): ComponentType<SkillWindowProps> {
  return layouts[skillId] || ReviewApp;
}
