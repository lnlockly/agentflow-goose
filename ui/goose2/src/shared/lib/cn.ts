import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const customTwMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "display",
            "display-eyebrow",
            "heading-app",
            "heading-page",
            "heading-section",
            "heading-item",
            "body",
            "body-subtle",
            "bubble",
            "meta",
            "label",
            "pill",
            "chrome",
            "xxs",
          ],
        },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return customTwMerge(clsx(inputs));
}
