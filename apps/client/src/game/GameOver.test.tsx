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
  it("shows achievements earned in the completed match", () => {
    const view = finishedView();
    const html = renderToStaticMarkup(
      <TestI18nProvider>
        <GameOver
          view={view}
          seat={1}
          spectating={false}
          recordedViews={[view]}
          onWatchReplay={null}
          onDownloadReplay={null}
          onBackToLobby={() => undefined}
          onClose={() => undefined}
          matchAchievements={["first-victory", "beat-ira"]}
          onViewAchievements={() => undefined}
        />
      </TestI18nProvider>,
    );
    expect(html).toContain("Achievements earned this match");
    expect(html).toContain("First Victory");
    expect(html).toContain("Beat Ira Bot");
    expect(html).toContain("View all achievements");
  });

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
    expect(html).toContain('class="gameover-headline">Draw</h2>');
    expect(html).toContain('class="gameover-eyebrow">Match complete</span>');
    expect(html).not.toContain("wins the game");
    expect(html).not.toContain('class="gameover-hero-portrait gameover-result-portrait"');
  });

  it("presents heroes as a switcher and labels the single selected stats panel", () => {
    const view = finishedView();
    view.gameStats = { turns: [
      {
        turn: 1, activePlayer: 0, attacks: [0, 0],
        threatened: [0, 0], blocked: [0, 0], damageDealt: [0, 0],
        allyAbsorbed: [4, 0],
      },
      {
        turn: 2, activePlayer: 1, attacks: [0, 1],
        threatened: [0, 4], blocked: [2, 0], damageDealt: [0, 2],
      },
      {
        turn: 3, activePlayer: 0, attacks: [1, 0],
        threatened: [6, 0], blocked: [0, 2], damageDealt: [4, 0],
      },
    ] };
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
    expect(html).toContain('class="gameover-switcher"');
    expect(html).toContain('class="gameover-switcher-label">Player stats</span>');
    expect(html).toContain("View statistics for");
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('class="gameover-hero-portrait gameover-result-portrait"');
    expect(html.match(/class="gameover-hero-portrait gameover-tab-portrait"/g)).toHaveLength(2);
    expect(html).toContain('src="https://content.fabrary.net/heroes/gravy-bones.webp"');
    expect(html).toContain('src="https://content.fabrary.net/heroes/dash-io.webp"');
    expect(html).not.toContain("Showing stats for");
    expect(html).toContain('aria-labelledby="gameover-player-tab-0"');
    expect(html).toContain("Back to lobby");
    expect(html).toContain('class="btn-primary"');
    expect(html).toContain('class="gameover-average-stats"');
    expect(html).toContain("<strong>8</strong><span>Average value per turn</span>");
    expect(html).toContain("<strong>6</strong><span>Damage threatened per turn</span>");
    expect(html).toContain("<strong>4</strong><span>Damage dealt per turn</span>");
    expect(html).toContain("<strong>2</strong><span>Damage blocked per turn</span>");
    expect(html).toContain('role="tooltip">Opening turn (0) is excluded from per-turn averages.');
    expect(html).toContain('class="gameover-match-strip"');
    expect(html).not.toContain("Opponent final life");
    expect(html).not.toContain(">Attacks<");
    expect(html).toContain('title="Damage absorbed by allies">Allies</th>');
    expect(html).toContain("<td>0 (opening)</td>");
    expect(html).toContain("<td>8</td></tr></tfoot>");
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
    expect(html).toContain("每回合平均价值");
  });
});
