import React from "react";
import { Composition } from "remotion";
import { ExplainCutComposition, explainCutDefaultProps, calculateExplainCutMetadata } from "./ExplainCutComposition";

export const RemotionRoot: React.FC = () => {
  const plan = explainCutDefaultProps.renderPlan;
  return (
    <Composition
      id="ExplainCut"
      component={ExplainCutComposition}
      width={plan.width}
      height={plan.height}
      fps={plan.fps}
      durationInFrames={Math.max(1, Math.round(plan.durationSeconds * plan.fps))}
      defaultProps={explainCutDefaultProps}
      calculateMetadata={calculateExplainCutMetadata}
    />
  );
};
