import {
  RiAlignItemBottomLine,
  RiAlignItemHorizontalCenterLine,
  RiAlignItemLeftLine,
  RiAlignItemRightLine,
  RiAlignItemTopLine,
  RiAlignItemVerticalCenterLine,
  RiSplitCellsHorizontal,
  RiSplitCellsVertical
} from "@remixicon/react";
import type { RemixiconComponentType } from "@remixicon/react";
import { alignSelection, distributeSelection } from "../editor-commands";

type ArrangeCommandContext = Parameters<typeof alignSelection>[0];

export type MultiArrangeAction = {
  id:
    | "align-left"
    | "align-center"
    | "align-right"
    | "align-top"
    | "align-middle"
    | "align-bottom"
    | "distribute-horizontal"
    | "distribute-vertical";
  group: "align" | "distribute";
  label: string;
  icon: RemixiconComponentType;
  run: (context: ArrangeCommandContext) => void;
};

export const MULTI_ARRANGE_ACTIONS: readonly MultiArrangeAction[] = [
  {
    id: "align-left",
    group: "align",
    label: "Align left",
    icon: RiAlignItemLeftLine,
    run: (context) => {
      alignSelection(context, "left");
    }
  },
  {
    id: "align-center",
    group: "align",
    label: "Align center",
    icon: RiAlignItemHorizontalCenterLine,
    run: (context) => {
      alignSelection(context, "center");
    }
  },
  {
    id: "align-right",
    group: "align",
    label: "Align right",
    icon: RiAlignItemRightLine,
    run: (context) => {
      alignSelection(context, "right");
    }
  },
  {
    id: "align-top",
    group: "align",
    label: "Align top",
    icon: RiAlignItemTopLine,
    run: (context) => {
      alignSelection(context, "top");
    }
  },
  {
    id: "align-middle",
    group: "align",
    label: "Align middle",
    icon: RiAlignItemVerticalCenterLine,
    run: (context) => {
      alignSelection(context, "middle");
    }
  },
  {
    id: "align-bottom",
    group: "align",
    label: "Align bottom",
    icon: RiAlignItemBottomLine,
    run: (context) => {
      alignSelection(context, "bottom");
    }
  },
  {
    id: "distribute-horizontal",
    group: "distribute",
    label: "Distribute horizontally",
    icon: RiSplitCellsHorizontal,
    run: (context) => {
      distributeSelection(context, "horizontal");
    }
  },
  {
    id: "distribute-vertical",
    group: "distribute",
    label: "Distribute vertically",
    icon: RiSplitCellsVertical,
    run: (context) => {
      distributeSelection(context, "vertical");
    }
  }
];
