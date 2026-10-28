import { useState } from "react";
import { playmatArt, type PlaymatId } from "../playmats.js";

/** One player's painting, laid under their half of the board up to the
 * seam; the scrim and cloth weave are painted by the stylesheet. */
export function PlaymatArt({ side, playmat }: { side: "own" | "opp"; playmat: PlaymatId }) {
  const [loaded, setLoaded] = useState(false);
  const art = playmatArt(playmat);
  if (!art) return null;
  return (
    <div
      className={`playmat-art playmat-art-${side}`}
      aria-hidden="true"
      data-loaded={loaded ? "true" : "false"}
    >
      <img
        className="playmat-art-image"
        src={art.url}
        alt=""
        decoding="async"
        style={{ objectPosition: art.focus }}
        onLoad={() => setLoaded(true)}
      />
    </div>
  );
}
