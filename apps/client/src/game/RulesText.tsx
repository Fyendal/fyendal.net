import { Fragment } from "react";

const SYMBOL_ICONS: Readonly<Record<string, string>> = {
  p: "/icons/attack.png",
  r: "/icons/resource.png",
  d: "/icons/defence.png",
  h: "/icons/life.png",
  i: "/icons/intellect.png",
};

/** Printed rules text, one paragraph per line, with its symbols drawn as icons. */
export function RulesText({ text, className }: { text: string; className?: string }) {
  return (
    <>
      {text.split("\n").map((paragraph, index) => (
        <p key={index} className={className}>
          {paragraph.split(/(\{[a-z]\})/g).map((part, partIndex) => {
            const icon = part.startsWith("{") ? SYMBOL_ICONS[part.slice(1, -1)] : undefined;
            return icon ? (
              <img key={partIndex} className="rules-symbol" src={icon} alt="" draggable={false} />
            ) : (
              <Fragment key={partIndex}>{part}</Fragment>
            );
          })}
        </p>
      ))}
    </>
  );
}
