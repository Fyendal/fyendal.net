import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { GameView } from "@fyendal/shared";
import { describe, expect, it } from "vitest";
import { GameOver } from "./GameOver.js";

function finishedView(): GameView {
  return {
    gameId: "game-over-test",
    turn: 2,
    phase: "game-over",
    activePlayer: 1,
    priorityPlayer: 1,
    players: [
      { seat: 0, heroName: "Dash I/O", life: 0 },
      { seat: 1, heroName: "Gravy Bones", life: 13 },
    ],
    chain: [],
    stack: [],
    pendingDecision: null,
    winner: 1,
    log: [],
    gameStats: { turns: [] },
  } as unknown as GameView;
}

describe("GameOver player statistics", () => {
  it("presents heroes as a switcher and labels the single selected stats panel", () => {
    const view = finishedView();
    const html = renderToStaticMarkup(createElement(GameOver, {
      view,
      seat: 0,
      spectating: false,
      recordedViews: [view],
      onWatchReplay: null,
      onDownloadReplay: null,
      onBackToLobby: () => undefined,
      onClose: () => undefined,
    }));

    expect(html).toContain("View statistics for");
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("Showing stats for");
    expect(html).toContain('id="gameover-selected-player">Dash I/O</strong>');
    expect(html).toContain("Back to lobby");
    expect(html).toContain('class="btn-primary"');
  });
});
