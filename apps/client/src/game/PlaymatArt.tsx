import { useState } from "react";
import { playmatArt, type PlaymatId } from "../playmats.js";

/** Full-bleed painting fixed under the board; the scrim and cloth weave are
 * painted by the stylesheet so the art never changes layout. */
export function PlaymatArt({ playmat }: { playmat: PlaymatId }) {
  const [loaded, setLoaded] = useState(false);
  const art = playmatArt(playmat);
  if (!art) return null;
  return (
    <div className="playmat-art" aria-hidden="true" data-loaded={loaded ? "true" : "false"}>
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
