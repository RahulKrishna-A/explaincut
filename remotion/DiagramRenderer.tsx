import React from "react";
import type { ResolvedDiagramPlan } from "@/types/diagramPlan";
import { FlowTemplate } from "./templates/FlowTemplate";
import { LayersTemplate } from "./templates/LayersTemplate";

export const DiagramRenderer: React.FC<{ plan: ResolvedDiagramPlan }> = ({ plan }) => {
  switch (plan.template) {
    case "flow":
      return <FlowTemplate plan={plan} />;
    case "layers":
      return <LayersTemplate plan={plan} />;
    default:
      return null;
  }
};
