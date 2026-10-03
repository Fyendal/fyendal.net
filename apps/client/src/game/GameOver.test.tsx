import { renderToStaticMarkup } from "react-dom/server";
import type { GameView } from "@fyendal/shared";
import { describe, expect, it } from "vitest";
import { TestI18nProvider } from "../i18n/TestI18nProvider.js";
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
  it("shows a draw without naming a winner", () => {
    const view = { ...finishedView(), winner: null };
    const html = renderToStaticMarkup(
      <TestI18nProvider>
        <GameOver
          view={view}
          seat={0}
          spectating={false}
          recordedViews={[view]}
          onWatchReplay={null}
          onDownloadReplay={null}
          onBackToLobby={() => undefined}
          onClose={() => undefined}
        />
      </TestI18nProvider>,
    );
    expect(html).toContain('class="gameover-headline">Draw</div>');
    expect(html).not.toContain("wins the game");
    expect(html).not.toContain('class="gameover-winner-tag"');
  });

  it("presents heroes as a switcher and labels the single selected stats panel", () => {
    const view = finishedView();
    view.gameStats = { turns: [{
      turn: 1,
      activePlayer: 0,
      attacks: [0, 0],
      threatened: [0, 0],
      blocked: [0, 0],
      damageDealt: [0, 0],
      allyAbsorbed: [4, 0],
    }] };
    const html = renderToStaticMarkup(
      <TestI18nProvider>
        <GameOver
          view={view}
          seat={0}
          spectating={false}
          recordedViews={[view]}
          onWatchReplay={null}
          onDownloadReplay={null}
          onBackToLobby={() => undefined}
          onClose={() => undefined}
        />
      </TestI18nProvider>,
    );

    expect(html).toContain('class="overlay gameover-overlay"');
    expect(html).toContain("View statistics for");
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("Showing stats for");
    expect(html).toContain('id="gameover-selected-player">Dash I/O</strong>');
    expect(html).toContain("Back to lobby");
    expect(html).toContain('class="btn-primary"');
    expect(html).toContain("<strong>4</strong><span>Damage absorbed by allies</span>");
    expect(html).toContain("<dt>Value per round</dt><dd>4</dd>");
    expect(html).toContain("<td>4</td></tr></tfoot>");
  });

  it("localizes the result actions and statistics in Chinese", () => {
    const view = finishedView();
    const html = renderToStaticMarkup(
      <TestI18nProvider locale="zh-Hans">
        <GameOver
          view={view}
          seat={1}
          spectating={false}
          recordedViews={[view]}
          onWatchReplay={() => undefined}
          onDownloadReplay={null}
          onBackToLobby={() => undefined}
          onClose={() => undefined}
        />
      </TestI18nProvider>,
    );

    expect(html).toContain("胜利");
    expect(html).toContain("观看回放");
    expect(html).toContain("返回大厅");
    expect(html).toContain("查看统计");
    expect(html).toContain("威胁伤害");
  });
});
