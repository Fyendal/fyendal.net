import type { ScriptCtx } from "@fyendal/engine";
import type { GameMessage } from "@fyendal/shared";
import { decisionMessage, decisionPrompt, localizedLog } from "./messages.js";

/** Per-card top/bottom option pairs tagged with their card instance, then "pass". */
function optOptions(ids: number[]): { options: string[]; cardOptions: (number | null)[] } {
  return {
    options: [...ids.flatMap((id) => [`top:${id}`, `bottom:${id}`]), "pass"],
    cardOptions: [...ids.flatMap((id) => [id, id]), null],
  };
}

function optOptionMessages(ids: number[]): Readonly<Record<string, GameMessage>> {
  return {
    ...Object.fromEntries(
      ids.flatMap((id) => [
        [`top:${id}`, decisionMessage("common.option.top")],
        [`bottom:${id}`, decisionMessage("common.option.bottom")],
      ]),
    ),
    pass: decisionMessage("common.option.pass"),
  };
}

/** Opt N; delegate `onChoose` to `optOnChoose`. "pass" leaves the rest on top. "optc" hooks charge Blaze, Firemind. */
export function optN(ctx: ScriptCtx, n: number): void {
  const p = ctx.player(ctx.seat);
  const looked = p.deck.slice(0, n).map((c) => c.instanceId);
  if (looked.length === 0) return;
  const { options, cardOptions } = optOptions(looked);
  const chargesBlaze = ctx.cardData(p.heroCardId).name === "Blaze, Firemind" && !ctx.heroAbilitiesDisabled(ctx.seat);
  ctx.requestChoice(
    `${chargesBlaze ? "optc" : "opt"}:${looked.length}:${looked.join(",")}`,
    decisionPrompt(`${ctx.data.name}: Opt ${looked.length}`, "card.common.opt", {
      values: { card: { kind: "card", cardId: ctx.self.cardId }, count: looked.length },
      optionMessages: optOptionMessages(looked),
    }),
    options,
    undefined,
    cardOptions,
    "pass",
  );
}

/** Answers `optN` one card at a time; true when `hook` was an opt hook. */
export function optOnChoose(ctx: ScriptCtx, hook: string, option: string, onComplete?: () => void): boolean {
  const m = /^(optc?):(\d+):([\d,]+)$/.exec(hook);
  if (!m) return false;
  const charge = m[1] === "optc";
  const total = Number(m[2]);
  const ids = m[3]!.split(",").map(Number);
  const finish = (): void => {
    ctx.logPublic(
      localizedLog(`${ctx.data.name}: opt ${total}`, "card.log.common.opt.completed", {
        card: { kind: "card", cardId: ctx.self.cardId },
        count: total,
      }),
    );
    if (charge && total > 0) {
      const hero = ctx.player(ctx.seat).hero;
      const n = (hero.counters?.energy ?? 0) + total;
      ctx.setCardCounter(hero.instanceId, "energy", n);
      ctx.logPublic(
        localizedLog(
          `${ctx.cardData(hero.cardId).name} gets ${total} energy counter(s) (${n})`,
          "card.log.common.energy.counters.gained",
          {
            card: { kind: "card", cardId: hero.cardId },
            amount: total,
            count: n,
          },
        ),
      );
    }
    onComplete?.();
  };
  if (option === "pass") {
    finish();
    return true;
  }
  // A bare "top"/"bottom" assigns the first remaining card.
  const pm = /^(top|bottom)(?::(\d+))?$/.exec(option);
  const id = pm?.[2] ? Number(pm[2]) : ids[0]!;
  if (!pm || !ids.includes(id)) return true;
  if (pm[1] === "bottom") ctx.putOnDeckBottom(id);
  else ctx.putOnDeckTop(id);
  const rest = ids.filter((x) => x !== id);
  if (rest.length > 0) {
    const { options, cardOptions } = optOptions(rest);
    ctx.requestChoice(
      `${m[1]}:${total}:${rest.join(",")}`,
      decisionPrompt(`${ctx.data.name}: Opt ${total} · ${rest.length} left`, "card.common.opt.remaining", {
        values: {
          card: { kind: "card", cardId: ctx.self.cardId },
          count: total,
          remaining: rest.length,
        },
        optionMessages: optOptionMessages(rest),
      }),
      options,
      undefined,
      cardOptions,
      "pass",
    );
    return true;
  }
  finish();
  return true;
}
